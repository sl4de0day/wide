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
    for (const year of ['2025', '2022', '2019']) {
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

const VS_GENERATORS = {
  15: 'Visual Studio 15 2017',
  16: 'Visual Studio 16 2019',
  17: 'Visual Studio 17 2022',
  18: 'Visual Studio 18 2026',
};

function knownGenerators() {
  const asked = cp.spawnSync(cmake, ['-E', 'capabilities'], { encoding: 'utf8' });
  try {
    const parsed = JSON.parse(asked.stdout);
    const names = (parsed.generators ?? []).map((item) => item.name).filter(Boolean);
    return names.length ? new Set(names) : null;
  } catch {
    return null;
  }
}

function installedVsMajors() {
  const base = process.env['ProgramFiles(x86)'] ?? process.env.ProgramFiles;
  if (!base) return [];
  const vswhere = path.join(base, 'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
  if (!fs.existsSync(vswhere)) return [];
  const found = cp.spawnSync(
    vswhere,
    [
      '-all',
      '-prerelease',
      '-products', '*',
      '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
      '-property', 'installationVersion',
    ],
    { encoding: 'utf8' },
  );
  const majors = String(found.stdout ?? '')
    .split(/\r?\n/)
    .map((line) => Number(line.trim().split('.')[0]))
    .filter((major) => Number.isInteger(major) && major > 0);
  return [...new Set(majors)].sort((a, b) => b - a);
}

function vsGenerator() {
  const known = knownGenerators();
  for (const major of installedVsMajors()) {
    const name = VS_GENERATORS[major];
    if (name && (!known || known.has(name))) return name;
  }
  return null;
}

const mode = process.argv[2] ?? 'build';

if (mode === 'configure') {
  const generator = vsGenerator();
  if (!generator) {
    console.error(
      'No Visual Studio installation matched a generator this CMake supports.\n' +
        'Install Visual Studio with the "Desktop development with C++" workload, or update CMake.',
    );
    process.exit(1);
  }
  console.log('configuring with ' + generator);
  const configured = cp.spawnSync(
    cmake,
    ['-S', HOST, '-B', BUILD, '-G', generator, '-A', 'x64'],
    { stdio: 'inherit' },
  );
  process.exit(configured.status ?? 1);
}

const args = ['--build', BUILD, '--config', 'Release'];

const result = cp.spawnSync(cmake, args, { stdio: 'inherit' });
process.exit(result.status ?? 1);
