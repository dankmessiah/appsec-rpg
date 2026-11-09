const { readFileSync } = require('node:fs');
const { join } = require('node:path');

function readBuildRevision() {
  let revision;
  try {
    revision = readFileSync(join(__dirname, '..', 'build-revision'), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return 'unknown';
    throw error;
  }

  if (revision.length !== 40 || /[^0-9a-f]/.test(revision)) {
    throw new Error('Invalid build revision metadata');
  }
  return revision;
}

module.exports = { buildRevision: readBuildRevision() };
