'use strict';

const cp = require('node:child_process');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const HOST = path.join(ROOT, 'native-host');

const mode = process.argv[2] ?? 'build';

if (mode === 'configure') {
  process.exit(0);
}

const args = ['build', '--release'];
const result = cp.spawnSync('cargo', args, { cwd: HOST, stdio: 'inherit', shell: true });
process.exit(result.status ?? 0);
