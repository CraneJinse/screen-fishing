'use strict';

const path = require('node:path');

const PORTABLE_DIRECTORY_NAME = 'user-data';
const DEVELOPMENT_DIRECTORY_NAME = '.screen-fishing-dev';

function productionUserDataDirectory(executablePath) {
  if (typeof executablePath !== 'string' || !executablePath.trim()) {
    throw new TypeError('A valid executable path is required');
  }
  return path.join(path.dirname(path.resolve(executablePath)), PORTABLE_DIRECTORY_NAME);
}

function developmentUserDataDirectory(projectDirectory) {
  if (typeof projectDirectory !== 'string' || !projectDirectory.trim()) {
    throw new TypeError('A valid project directory is required');
  }
  return path.join(path.resolve(projectDirectory), DEVELOPMENT_DIRECTORY_NAME);
}

module.exports = {
  PORTABLE_DIRECTORY_NAME,
  DEVELOPMENT_DIRECTORY_NAME,
  productionUserDataDirectory,
  developmentUserDataDirectory
};
