'use strict';

const cp = require('node:child_process');
const path = require('node:path');

const ROOT = path.resolve(process.argv[2] ?? path.join(__dirname, '..'));
const SIDECAR = path.join(__dirname, '..', 'sidecar', 'sidecar.cjs');

const child = cp.spawn(process.execPath, [SIDECAR], { stdio: ['pipe', 'pipe', 'ignore'] });
let buf = '';
const replies = new Map();
child.stdout.on('data', (d) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i);
    buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    let m;
    try { m = JSON.parse(line); } catch { continue; }
    if (m.t === 'host') {
      send({
        t: 'hostReply',
        id: m.id,
        result: m.method === 'dialog:showOpenDialog'
          ? { canceled: false, filePaths: [ROOT] }
          : null,
      });
    } else if (m.type === 'reply') {
      const cb = replies.get(m.replyId);
      if (cb) { replies.delete(m.replyId); cb(m); }
    }
  }
});
const send = (o) => child.stdin.write(JSON.stringify(o) + '\n');
let seq = 1;
const invoke = (channel, args) =>
  new Promise((res) => { const id = seq++; replies.set(id, res); send({ t: 'invoke', id, channel, args }); });

const ms = (t0) => Number((Number(process.hrtime.bigint() - t0) / 1e6).toFixed(1));

async function time(label, fn) {
  const t0 = process.hrtime.bigint();
  const value = await fn();
  const took = ms(t0);
  console.log(`${label.padEnd(34)} ${String(took).padStart(8)} ms   ${value ?? ''}`);
  return took;
}

(async () => {
  await new Promise((r) => setTimeout(r, 1400));
  await invoke('dialog:openFolder', []);

  console.log(`project: ${ROOT}\n`);

  await time('fs:readDir (cold)', async () => {
    const r = await invoke('fs:readDir', [ROOT]);
    return `${r.result?.length ?? 0} entries`;
  });

  await time('fs:readDir (warm, x20 serial)', async () => {
    for (let i = 0; i < 20; i += 1) await invoke('fs:readDir', [ROOT]);
    return 'total for 20';
  });

  await time('project:files (full walk)', async () => {
    const r = await invoke('project:files', [ROOT]);
    return `${r.result?.files?.length ?? 0} files`;
  });

  await time('project:quickOpenPrepare', async () => {
    const r = await invoke('project:quickOpenPrepare', [ROOT]);
    return `${r.result?.count ?? 0} indexed`;
  });

  await time('project:quickOpenQuery x50', async () => {
    for (let i = 0; i < 50; i += 1) await invoke('project:quickOpenQuery', ['index', 30]);
    return 'total for 50';
  });

  await time('search:inFiles', async () => {
    const r = await invoke('search:inFiles', [ROOT, { query: 'function' }]);
    return `${r.result?.total ?? 0} hits`;
  });

  console.log('');
  await time('readDir DURING ts:projectDiagnostics', async () => {
    const heavy = invoke('ts:projectDiagnostics', [ROOT]);
    const t0 = process.hrtime.bigint();
    await invoke('fs:readDir', [ROOT]);
    const delay = ms(t0);
    await heavy;
    return `(the readDir itself took ${delay} ms)`;
  });

  child.kill();
  process.exit(0);
})();
