#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const SOURCE_DIR = path.join(DIST, 'wide-linux-x64');
const VERSION = require(path.join(ROOT, 'package.json')).version || '1.220926';

if (!fs.existsSync(SOURCE_DIR)) {
  console.log('[rpm] wide-linux-x64 bulunamadı, önce hazırlanıyor...');
  cp.execSync('node scripts/package-linux.cjs --dir-only', { stdio: 'inherit', cwd: ROOT });
}

console.log(`[rpm] RPM paketi hazırlanıyor (v${VERSION})...`);

const RPM_ROOT = path.join(DIST, '.rpm-staging');
fs.rmSync(RPM_ROOT, { recursive: true, force: true });
for (const sub of ['BUILD', 'RPMS', 'SOURCES', 'SPECS', 'SRPMS', 'rpmdb']) {
  fs.mkdirSync(path.join(RPM_ROOT, sub), { recursive: true });
}

fs.copyFileSync(path.join(ROOT, 'wide.desktop'), path.join(RPM_ROOT, 'wide.desktop'));
fs.copyFileSync(path.join(ROOT, 'assets', 'logo.png'), path.join(RPM_ROOT, 'logo.png'));

const specContent = `%define _build_id_links none
%define _dbpath %{_topdir}/rpmdb

Name:           wide-ide
Version:        ${VERSION}
Release:        1%{?dist}
Summary:        Security-first IDE for the web stack
License:        GPL-3.0-or-later
URL:            https://github.com/sl4de0day/wide
AutoReqProv:    no
Requires:       gtk3, nss, alsa-lib, libnotify, libsecret

%description
Wide provides real-time vulnerability detection, built-in Catcher proxy & Pitcher API client.

%prep

%build

%install
rm -rf %{buildroot}
mkdir -p %{buildroot}/opt/wide
mkdir -p %{buildroot}/usr/bin
mkdir -p %{buildroot}/usr/share/applications
mkdir -p %{buildroot}/usr/share/pixmaps
mkdir -p %{buildroot}/usr/share/icons/hicolor/512x512/apps

cp -r ${SOURCE_DIR}/* %{buildroot}/opt/wide/
chmod +x %{buildroot}/opt/wide/wide %{buildroot}/opt/wide/wide-launcher.sh
ln -sf /opt/wide/wide-launcher.sh %{buildroot}/usr/bin/wide

cp ${RPM_ROOT}/wide.desktop %{buildroot}/usr/share/applications/wide.desktop
cp ${RPM_ROOT}/logo.png %{buildroot}/usr/share/pixmaps/wide.png
cp ${RPM_ROOT}/logo.png %{buildroot}/usr/share/icons/hicolor/512x512/apps/wide.png

%files
/opt/wide
/usr/bin/wide
/usr/share/applications/wide.desktop
/usr/share/pixmaps/wide.png
/usr/share/icons/hicolor/512x512/apps/wide.png
`;

const specFile = path.join(RPM_ROOT, 'SPECS', 'wide.spec');
fs.writeFileSync(specFile, specContent.replace(/\r\n/g, '\n'), 'utf8');

const rpmbin = fs.existsSync('/tmp/rpm-root/usr/bin/rpmbuild')
  ? '/tmp/rpm-root/usr/bin/rpmbuild'
  : 'rpmbuild';

const env = {
  ...process.env,
  RPM_CONFIGDIR: '/tmp/rpm-root/usr/lib/rpm',
  LD_LIBRARY_PATH: `/tmp/rpm-root/usr/lib:${process.env.LD_LIBRARY_PATH || ''}`,
};

try {
  cp.execSync(`${rpmbin} -bb --define "_topdir ${RPM_ROOT}" --define "_target_os linux" --target x86_64 "${specFile}"`, {
    stdio: 'inherit',
    env,
  });

  const rpmsDir = path.join(RPM_ROOT, 'RPMS', 'x86_64');
  if (fs.existsSync(rpmsDir)) {
    const files = fs.readdirSync(rpmsDir).filter((f) => f.endsWith('.rpm'));
    for (const f of files) {
      const src = path.join(rpmsDir, f);
      const dest = path.join(DIST, f);
      fs.copyFileSync(src, dest);
      console.log(`✓ [rpm] Başarıyla üretildi: ${dest} (${(fs.statSync(dest).size / (1024 * 1024)).toFixed(1)} MB)`);
    }
  }
} finally {
  fs.rmSync(RPM_ROOT, { recursive: true, force: true });
}
