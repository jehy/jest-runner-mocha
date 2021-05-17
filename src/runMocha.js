'use strict';

const Mocha = require('mocha');
const { CoverageInstrumenter } = require('collect-v8-coverage');
const { fileURLToPath } = require('url');
const minimatch = require('minimatch');
const semver = require('semver');
const toTestResult = require('./utils/toTestResult');
const setupCollectCoverage = require('./utils/setupCollectCoverage');
const getMochaOptions = require('./utils/getMochaOptions');

async function runMocha({ config, testPath, globalConfig }) {
  let v8CoverageInstrumenter;
  let v8CoverageResult;
  async function collectV8Coverage() {
    if (!semver.satisfies(process.version, '>= 10.12.0')) {
      throw new Error(`Node version ${process.version} does not have coverage information!
    Please use node >= 10.12.0 or babel coverage.`);
    }
    v8CoverageInstrumenter = new CoverageInstrumenter();
    await v8CoverageInstrumenter.startInstrumenting();
  }

  async function stopCollectingV8Coverage() {
    if (!v8CoverageInstrumenter) {
      throw new Error('You need to call `collectV8Coverage` first.');
    }
    v8CoverageResult = await v8CoverageInstrumenter.stopInstrumenting();
  }
  function shouldInstrument(file) {
    return !(
      /node_modules/.test(file)
      || config.coveragePathIgnorePatterns.some(pattern => minimatch(file, pattern))
    );
  }
  function getAllV8CoverageInfoCopy() {
    if (!v8CoverageResult) {
      throw new Error('You need to `stopCollectingV8Coverage` first');
    }

    return v8CoverageResult
      .filter(res => res.url.startsWith('file://'))
      .map(res => ({ ...res, url: fileURLToPath(res.url) }))
      .filter(
        (res) => {
          // TODO: will this work on windows? It might be better if `shouldInstrument` deals with it anyways
          return res.url.startsWith(config.rootDir) && shouldInstrument(res.url);
          // this._fileTransforms.has(res.url) &&
          //  shouldInstrument(res.url, this._coverageOptions, this._config),
        },
      )
      .map((result) => {
        const transformedFile = result.url; // this._fileTransforms.get(result.url);

        return {
          codeTransformResult: transformedFile,
          result,
        };
      });
  }

  //  return new Promise(async (resolve, reject) => {
  const { cliOptions: mochaOptions, coverageOptions } = getMochaOptions(config);
  let clearMocks;

  class Reporter extends Mocha.reporters.Base {
    constructor(runner) {
      super(runner);
      const tests = [];
      const pending = [];
      const failures = [];
      const passes = [];

      runner.on('test end', test => tests.push(test));
      runner.on('pass', test => passes.push(test));
      runner.on('fail', (test, err) => {
        test.err = err; // eslint-disable-line no-param-reassign
        failures.push(test);
      });
      runner.on('pending', test => pending.push(test));
      // eslint-disable-next-line no-param-reassign
      runner.externalFinish = new Promise((resolve, reject) => {
        runner.on('suite end', (s) => {
          if (clearMocks) {
            try {
              clearMocks(s);
            } catch (err) {
              reject(err);
            }
          }
        });
        runner.on('end', async () => {
          let v8Coverage;
          try {
            if (
              globalConfig.collectCoverage
              && globalConfig.coverageProvider === 'v8'
            ) {
              await stopCollectingV8Coverage();
              v8Coverage = getAllV8CoverageInfoCopy();
            }
            const result = toTestResult({
              stats: this.stats,
              tests,
              pending,
              failures,
              passes,
              // eslint-disable-next-line no-underscore-dangle
              coverage: global.__coverage__,
              jestTestPath: testPath,
            });
            if (v8Coverage && v8Coverage.length > 0) {
              result.v8Coverage = v8Coverage;
            }
            resolve(result);
          } catch (e) {
            reject(e);
          }
        });
      });
    }
  }

  const mocha = new Mocha({
    reporter: Reporter,
    timeout: mochaOptions.timeout,
  });

  if (mochaOptions.compiler) {
    // eslint-disable-next-line import/no-dynamic-require, global-require
    require(mochaOptions.compiler);
  }

  if (globalConfig.collectCoverage) {
    if (globalConfig.coverageProvider === 'v8') {
      await collectV8Coverage();
    } else {
      setupCollectCoverage({
        filename: testPath,
        rootDir: config.rootDir,
        coveragePathIgnorePatterns: config.coveragePathIgnorePatterns,
        allowBabelRc: coverageOptions.useBabelRc,
      });
    }
  }

  if (config.setupFilesAfterEnv) {
    config.setupFilesAfterEnv.forEach((path) => {
      // eslint-disable-next-line global-require,import/no-dynamic-require
      const module = require(path);
      if (config.clearMocks && module.clearMocks) {
        clearMocks = module.clearMocks;
      }
    });
  }
  if (mochaOptions.file) {
    mochaOptions.file.forEach(file => mocha.addFile(file));
  }

  mocha.addFile(testPath);

  if (globalConfig.testNamePattern) {
    mocha.grep(globalConfig.testNamePattern);
  }

  let runner;
  if (mochaOptions.ui) {
    runner = mocha.ui(mochaOptions.ui).run();
  } else {
    runner = mocha.run();
  }
  return runner.externalFinish;
}

module.exports = runMocha;
