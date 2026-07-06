// register - bind .nlp files to nlpc compile on this machine
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ex = promisify(execFile);

export async function register() {
  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(here, '..');
  if (process.platform === 'win32') {
    const script = join(repoRoot, 'scripts', 'register-file-type.cmd');
    if (!existsSync(script)) throw new Error('missing ' + script);
    await ex('cmd', ['/c', script], { stdio: 'inherit' });
  } else {
    const script = join(repoRoot, 'scripts', 'register-file-type.sh');
    if (!existsSync(script)) throw new Error('missing ' + script);
    await ex('bash', [script], { stdio: 'inherit' });
  }
  return { ok: true };
}
