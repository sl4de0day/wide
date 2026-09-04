'use strict';

const cp = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const HOST = path.join(ROOT, 'native-host');
const BUILD = path.join(HOST, 'build');

function findCMake() {
  const onPath = cp.spawnSync(process.platform === 'win32' ? 'where' : 'which', ['cmake'], {
    encoding: 'utf8',
  });
  if (onPath.status === 0) {
    const first = onPath.stdout.split(/\r?\n/).find(Boolean);
    if (first && fs.existsSync(first)) return first;
  }

  const bases = [
    process.env['ProgramFiles(x86)'],
    process.env.ProgramFiles,
  ].filter(Boolean);
  const editions = ['BuildTools', 'Community', 'Professional', 'Enterprise'];
  for (const base of bases) {
    for (const year of ['2022', '2019']) {
      for (const edition of editions) {
        const candidate = path.join(
          base, 'Microsoft Visual Studio', year, edition,
          'Common7', 'IDE', 'CommonExtensions', 'Microsoft', 'CMake', 'CMake', 'bin', 'cmake.exe',
        );
        if (fs.existsSync(candidate)) return candidate;
      }
    }
  }
  return null;
}

const cmake = findCMake();
if (!cmake) {
  console.error(
    'CMake was not found. Install Visual Studio Build Tools with the "Desktop development with C++" workload,\n' +
      'or put cmake on PATH.',
  );
  process.exit(1);
}

const mode = process.argv[2] ?? 'build';
const args =
  mode === 'configure'
    ? ['-S', HOST, '-B', BUILD, '-G', 'Visual Studio 17 2022', '-A', 'x64']
    : ['--build', BUILD, '--config', 'Release'];

const result = cp.spawnSync(cmake, args, { stdio: 'inherit' });
process.exit(result.status ?? 1);
