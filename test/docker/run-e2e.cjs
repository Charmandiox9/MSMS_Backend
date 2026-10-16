const { spawnSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const result = spawnSync('npm', ['run', 'test:e2e', '--', '--runInBand', '--json', '--outputFile=/tmp/e2e-result.json'], { stdio: 'ignore' });
const report = JSON.parse(readFileSync('/tmp/e2e-result.json', 'utf8'));
console.log(JSON.stringify({ suites: report.numTotalTestSuites, passed: report.numPassedTests, failed: report.numFailedTests }));
for (const suite of report.testResults) for (const test of suite.assertionResults) if (test.status === 'failed') console.log(test.fullName + '\n' + test.failureMessages.join('\n').slice(0, 1000));
process.exitCode = result.status ?? 1;
