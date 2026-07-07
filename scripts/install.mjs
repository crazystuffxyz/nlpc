#!/usr/bin/env node
// thin wrapper so `node scripts/install.mjs ...` works.
// the real implementation lives in lib/install.mjs so it can be imported by tests.
import { main } from '../lib/install.mjs';
main().catch(e => { console.error('[nlpc-install]', e.message); process.exit(1); });
