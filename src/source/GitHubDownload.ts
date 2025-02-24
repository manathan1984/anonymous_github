import { Octokit } from "@octokit/rest";
import config from "../../config";
import storage from "../storage";
import Repository from "../Repository";

import GitHubBase from "./GitHubBase";
import AnonymizedFile from "../AnonymizedFile";
import { SourceBase } from "../types";
import got from "got";
import * as stream from "stream";
import { OctokitResponse } from "@octokit/types";
import AnonymousError from "../AnonymousError";

export default class GitHubDownload extends GitHubBase implements SourceBase {
  constructor(
    data: {
      type: "GitHubDownload" | "GitHubStream" | "Zip";
      branch?: string;
      commit?: string;
      repositoryId?: string;
      repositoryName?: string;
      accessToken?: string;
    },
    repository: Repository
  ) {
    super(data, repository);
  }

  private async _getZipUrl(
    auth?: string
  ): Promise<OctokitResponse<unknown, 302>> {
    const octokit = new Octokit({ auth });
    return octokit.rest.repos.downloadTarballArchive({
      owner: this.githubRepository.owner,
      repo: this.githubRepository.repo,
      ref: this.branch?.commit || "HEAD",
      method: "HEAD",
    });
  }

  async download() {
    const fiveMinuteAgo = new Date();
    fiveMinuteAgo.setMinutes(fiveMinuteAgo.getMinutes() - 5);
    if (
      this.repository.status == "download" &&
      this.repository.model.statusDate > fiveMinuteAgo
    )
      throw new AnonymousError("repo_in_download", {
        httpStatus: 404,
        object: this.repository,
      });
    let response: OctokitResponse<unknown, number>;
    try {
      response = await this._getZipUrl(await this.getToken());
    } catch (error) {
      if (error.status == 401 && config.GITHUB_TOKEN) {
        try {
          response = await this._getZipUrl(config.GITHUB_TOKEN);
        } catch (error) {
          await this.repository.resetSate("error", "repo_not_accessible");
          throw new AnonymousError("repo_not_accessible", {
            httpStatus: 404,
            cause: error,
            object: this.repository,
          });
        }
      } else {
        await this.repository.resetSate("error", "repo_not_accessible");
        throw new AnonymousError("repo_not_accessible", {
          httpStatus: 404,
          object: this.repository,
          cause: error,
        });
      }
    }
    await this.repository.updateStatus("download");
    const originalPath = this.repository.originalCachePath;
    await storage.mk(originalPath);
    let progress = null;
    let progressTimeout;
    let inDownload = true;

    const that = this;
    async function updateProgress() {
      if (progress) {
        await that.repository.updateStatus(
          that.repository.status,
          progress.transferred
        );
      }
      if (inDownload) {
        progressTimeout = setTimeout(updateProgress, 1500);
      }
    }
    updateProgress();

    try {
      const downloadStream = got.stream(response.url);
      downloadStream.addListener("downloadProgress", (p) => (progress = p));
      await storage.extractTar(originalPath, downloadStream);
    } catch (error) {
      await this.repository.updateStatus("error", "unable_to_download");
      throw new AnonymousError("unable_to_download", {
        httpStatus: 500,
        cause: error,
        object: this.repository,
      });
    } finally {
      inDownload = false;
      clearTimeout(progressTimeout);
    }

    await this.repository.updateStatus("ready");
  }

  async getFileContent(file: AnonymizedFile): Promise<stream.Readable> {
    await this.download();
    // update the file list
    await this.repository.files({ force: true });
    return storage.read(file.originalCachePath);
  }

  async getFiles() {
    const folder = this.repository.originalCachePath;
    if (!(await storage.exists(folder))) {
      await this.download();
    }
    return storage.listFiles(folder);
  }
}
