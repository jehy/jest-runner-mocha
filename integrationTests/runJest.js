'use strict';

const { spawn } = require('child_process');
const path = require('path');
const stripAnsi = require('strip-ansi');

const rootDir = path.join(__dirname, '..');

function spawnPromise(program2, args, options) {
  return new Promise((resolve) => {
    const stdout = [];
    const stderr = [];
    const ps = spawn(program2, args, options);
    ps.stdout.on('data', (newData) => {
      stdout.push(newData);
    });

    ps.stderr.on('data', (newData) => {
      stderr.push(newData);
    });

    // eslint-disable-next-line no-unused-vars
    ps.on('close', () => {
      resolve({ stderr: stderr.join('\n'), stdout: stdout.join('\n') });
    });
  });
}

function normalize(output) {
  // to remove color codes which can not be disabled othervise
  return stripAnsi(output)
    .replace(/\(?\d*\.?\d+ ?m?s\)?/g, '')
    .replace(/, estimated/g, '')
    .replace(new RegExp(rootDir, 'g'), '/mocked-path-to-jest-runner-mocha')
    .replace(new RegExp('.*at .*\\n', 'g'), 'mocked-stack-trace')
    .replace(/.*at .*\\n/g, 'mocked-stack-trace')
    .replace(/(mocked-stack-trace)+/, '      at mocked-stack-trace')
    .replace(/ +\n/g, '\n')
    .replace(/\n+/g, '\n')
    .replace(/ +/g, ' ')
  // replace √ on windows with same as used on unix
    .replace(/√/g, '✓')
  // replace ✕ on windows with same as used on unix
    .replace(/×/g, '✕')
  // sometimes random spaces are being added to test output at the end, remove them
    .split('\n')
    .map(line => line.trim())
    .join('\n');
}
function runJest(project, options = []) {
  const projects = path.join(__dirname, '__fixtures__', project);
  const cmd = path.resolve('./node_modules/.bin/jest');
  const args = [
    '--useStderr',
    '--no-watchman',
    '--no-cache',
    '--no-colors',
    '--coverageReporters',
    'text',
    '--projects',
    `${projects}`,
  ].concat(options);
  return spawnPromise(cmd, args, {
    // return exec(`node ./node_modules/.bin/jest ${args}`, {
    env: {
      ...process.env,
      // for chalk whick is used in jest
      FORCE_COLOR: 0,
      // for node native asserts. does not quite work.
      NODE_DISABLE_COLORS: 1,
      NO_COLOR: 1,
    },
    shell: true,
  }).then(({ stdout, stderr }) => {
    return `${normalize(stderr)}\n${normalize(stdout)}`;
  });
}

module.exports = runJest;
