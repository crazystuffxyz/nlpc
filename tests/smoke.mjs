// smoke test - runs all unit/integration/negative/security tests in sequence
import { spawn } from 'node:child_process';
console.log('smoke test runner - executes the full test suite');

const child = spawn(process.execPath, ['--test', '--test-reporter=spec', 'tests/unit', 'tests/integration', 'tests/negative', 'tests/security'], { stdio: 'inherit' });
child.on('exit', code => process.exit(code || 0));
