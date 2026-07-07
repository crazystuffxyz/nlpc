#!/usr/bin/env node
// release.mjs - build a vX.Y.Z npm pack tarball + create the github release.
// usage: node scripts/release.mjs [--push] [--tag X.Y.Z]
//   --push: also push the tag and the release assets to github
//   --tag:  override the tag (default: package.json version, prefixed with v)
import { execSync, spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, statSync, createReadStream } from 'node:fs';
import { resolve, join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';

function sha256(path) {
  const h = createHash('sha256');
  h.update(readFileSync(path));
  return h.digest('hex');
}

const args = process.argv.slice(2);
const push = args.includes('--push');
const tagArg = args[args.indexOf('--tag') + 1];
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const tag = tagArg ? (tagArg.startsWith('v') ? tagArg : `v${tagArg}`) : `v${pkg.version}`;

const out = resolve('dist');
mkdirSync(out, { recursive: true });

// step 1: build the npm tarball via `npm pack`. includes everything in
// package.json's `files` array. run npm pack with cwd forced so the
// `dist` relative path doesn't get resolved against npm's own cwd.
console.log('[release] npm pack ->', out);
const tarball = execSync('npm pack', { encoding: 'utf8' }).trim();
const tarballName = basename(tarball);
console.log('[release] tarball:', tarballName);
// npm pack drops the tarball in the cwd by default. move it to dist/.
const src = join(process.cwd(), tarballName);
const stable = join(out, `nlpc-${pkg.version}.tgz`);
if (existsSync(stable)) rmSync(stable);
execSync(`move "${src}" "${stable}"`, { stdio: 'ignore' });
const hash = sha256(stable);
writeFileSync(`${stable}.sha256`, `${hash}  ${basename(stable)}\n`);
console.log('[release] sha256:', hash);

if (!push) {
  console.log(`[release] dry-run done. to push, run: node scripts/release.mjs --push`);
  process.exit(0);
}

// step 3: create + push the git tag.
console.log('[release] tagging', tag);
try { execSync(`git tag -d ${tag}`, { stdio: 'ignore' }); } catch {}
execSync(`git tag ${tag}`, { stdio: 'inherit' });
execSync(`git push origin ${tag} --force`, { stdio: 'inherit' });

// step 4: create the github release. we use the API directly (no `gh` CLI
// assumed) via curl. token comes from GITHUB_TOKEN env or Windows cred mgr.
const token = process.env.GITHUB_TOKEN ||
              (process.platform === 'win32'
                ? execSync('powershell -NoProfile -Command "[Net.NetworkCredential]::new(\'\', (Get-Credential -Message \'github token\' -UserName \'x\').GetNetworkCredential().Password).Password"', { encoding: 'utf8' }).trim()
                : '');

if (!token) {
  console.log('[release] no GITHUB_TOKEN env; skipping github release API. upload the tarball manually.');
  process.exit(0);
}

const repo = 'crazystuffxyz/nlpc';
const url = `https://api.github.com/repos/${repo}/releases`;

const body = JSON.stringify({
  tag_name: tag,
  name: `nlpc ${pkg.version}`,
  body: `nlpc v${pkg.version} - english-to-c++ compiler.

install:
\`\`\`
npm install -g crazystuffxyz/nlpc
\`\`\`

see README for usage.`,
  draft: false,
  prerelease: false,
});

const relRes = await fetch(url, {
  method: 'POST',
  headers: {
    'Authorization': `token ${token}`,
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'nlpc-release',
  },
  body,
});
if (!relRes.ok) {
  console.error('[release] github API failed:', relRes.status, await relRes.text());
  process.exit(1);
}
const release = await relRes.json();
console.log('[release] created release:', release.html_url);

// step 5: upload the tarball
const uploadUrl = release.upload_url.split('{')[0] + `?name=${basename(stable)}`;
const fileBytes = readFileSync(stable);
const upRes = await fetch(uploadUrl, {
  method: 'POST',
  headers: {
    'Authorization': `token ${token}`,
    'Accept': 'application/vnd.github+json',
    'Content-Type': 'application/gzip',
  },
  body: fileBytes,
});
if (!upRes.ok) {
  console.error('[release] upload failed:', upRes.status, await upRes.text());
  process.exit(1);
}
console.log('[release] uploaded', basename(stable));
console.log('[release] done. release:', release.html_url);
