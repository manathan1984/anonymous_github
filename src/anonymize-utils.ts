import config from "../config";
import Repository from "./Repository";
import GitHubBase from "./source/GitHubBase";
import { isText } from "istextorbinary";
import * as path from "path";

import * as stream from "stream";

const urlRegex =
  /<?\b((https?|ftp|file):\/\/)[-A-Za-z0-9+&@#/%?=~_|!:,.;]+[-A-Za-z0-9+&@#/%=~_|]\b\/?>?/g;

export function isTextFile(filePath, content) {
  const filename = path.basename(filePath);
  const extensions = filename.split(".").reverse();
  const extension = extensions[0].toLowerCase();
  if (config.additionalExtensions.includes(extension)) {
    return true;
  }
  if (isText(filename)) {
    return true;
  }
  return isText(filename, content);
}

export function anonymizeStream(filename: string, repository: Repository) {
  const ts = new stream.Transform();
  var chunks = [],
    len = 0,
    pos = 0;

  ts._transform = function _transform(chunk, enc, cb) {
    chunks.push(chunk);
    len += chunk.length;

    if (pos === 1) {
      let data: any = Buffer.concat(chunks, len);
      if (isTextFile(filename, data)) {
        data = anonymizeContent(data.toString(), repository);
      }

      chunks = [];
      len = 0;

      this.push(data);
    }

    pos = 1 ^ pos;
    cb(null);
  };

  ts._flush = function _flush(cb) {
    if (chunks.length) {
      let data: any = Buffer.concat(chunks, len);
      if (isText(filename, data)) {
        data = anonymizeContent(data.toString(), repository);
      }

      this.push(data);
    }

    cb(null);
  };
  return ts;
}

export function anonymizeContent(content: string, repository: Repository) {
  if (repository.options?.image === false) {
    // remove image in markdown
    content = content.replace(
      /!\[[^\]]*\]\((?<filename>.*?)(?=\"|\))(?<optionalpart>\".*\")?\)/g,
      ""
    );
  }

  if (!repository.options?.link) {
    // remove all links
    content = content.replace(urlRegex, config.ANONYMIZATION_MASK);
  }

  if (repository.source instanceof GitHubBase) {
    content = content.replace(
      new RegExp(
        `https://github.com/${
          repository.source.githubRepository.fullName
        }/blob/${repository.source.branch?.name || "HEAD"}\\b`,
        "gi"
      ),
      `https://${config.HOSTNAME}/r/${repository.repoId}`
    );
    content = content.replace(
      new RegExp(
        `https://github.com/${
          repository.source.githubRepository.fullName
        }/tree/${(repository.source as GitHubBase).branch?.name || "HEAD"}\\b`,
        "gi"
      ),
      `https://${config.HOSTNAME}/r/${repository.repoId}`
    );
    content = content.replace(
      new RegExp(
        `https://github.com/${repository.source.githubRepository.fullName}`,
        "gi"
      ),
      `https://${config.HOSTNAME}/r/${repository.repoId}`
    );
  }

  const terms = repository.options.terms || [];
  for (let i = 0; i < terms.length; i++) {
    const term = terms[i];
    if (term.trim() == "") {
      continue;
    }
    // remove whole url if it contains the term
    content = content.replace(urlRegex, (match) => {
      if (new RegExp(`\\b${term}\\b`, "gi").test(match))
        return config.ANONYMIZATION_MASK + "-" + (i + 1);
      return match;
    });

    // remove the term in the text
    content = content.replace(
      new RegExp(`\\b${term}\\b`, "gi"),
      config.ANONYMIZATION_MASK + "-" + (i + 1)
    );
  }
  return content;
}

export function anonymizePath(path: string, terms: string[]) {
  for (let i = 0; i < terms.length; i++) {
    const term = terms[i];
    if (term.trim() == "") {
      continue;
    }
    path = path.replace(
      new RegExp(term, "gi"),
      config.ANONYMIZATION_MASK + "-" + (i + 1)
    );
  }
  return path;
}
