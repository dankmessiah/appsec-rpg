const fs = require('node:fs');
const path = require('node:path');
const revision = '0123456789abcdef0123456789abcdef01234567';
const metadataPath = path.resolve(__dirname, '../../build-revision');

function readWithMetadata(content) {
  const readFileSync = fs.readFileSync;
  const read = jest.spyOn(fs, 'readFileSync').mockImplementation((filename, ...args) => {
    if (filename !== metadataPath) return readFileSync(filename, ...args);
    if (content !== undefined) return content;
    throw Object.assign(new Error('Missing test metadata'), { code: 'ENOENT' });
  });
  try {
    let buildRevision;
    jest.isolateModules(() => { ({ buildRevision } = require('../../server/build-info')); });
    return buildRevision;
  } finally {
    read.mockRestore();
  }
}

test('uses the fixed image metadata despite runtime environment changes', () => {
  const previous = process.env.BUILD_REVISION;
  process.env.BUILD_REVISION = 'f'.repeat(40);
  try {
    expect(readWithMetadata(revision)).toBe(revision);
    expect(readWithMetadata()).toBe('unknown');
  } finally {
    if (previous === undefined) delete process.env.BUILD_REVISION;
    else process.env.BUILD_REVISION = previous;
  }
});

test.each(['', 'unknown', 'F'.repeat(40), 'a'.repeat(39), revision + '\n'])(
  'rejects malformed image metadata (%j)',
  (content) => expect(() => readWithMetadata(content)).toThrow('Invalid build revision metadata'),
);
