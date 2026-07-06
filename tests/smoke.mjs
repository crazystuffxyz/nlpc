// smoke test - runs all unit/integration/negative/security tests in sequence
import { spawn } from 'node:child_process'; // spawn
console.log('smoke test runner - executes the full test suite'); // log

const child = spawn(process.execPath, ['--test', '--test-reporter=spec', 'tests/unit', 'tests/integration', 'tests/negative', 'tests/security'], { stdio: 'inherit' }); // run
child.on('exit', code => process.exit(code || 0)); // exit
