// Post-upgrade smoke test. Run with:  npm run smoke
//
// Verifies, inside the REAL Electron runtime, that everything the DJ link and
// the NDI output depend on still loads. This exists because an Electron major
// bump silently breaks ABI-sensitive native modules: better-sqlite3 12.x failed
// to compile against Electron 42's V8 (v8::External::Value() and
// PropertyCallbackInfo::This() were removed), which killed rekordbox database
// access — and therefore track titles, artists and cover art — with nothing but
// a log line to show for it.
//
// Uses its own userData path so it can never take the single-instance lock away
// from a running TrueLazer instance.
const path = require('node:path');
const os = require('node:os');
const ROOT = path.join(__dirname, '..');
const { app } = require('electron');

app.setPath('userData', path.join(os.tmpdir(), 'tl-smoke-userdata'));

const results = [];
const rec = (name, pass, detail = '') => results.push({ name, pass, detail });

app.whenReady().then(async () => {
  // 1. better-sqlite3 — native. prolink-connect's ONLY sqlite surface is
  //    new Database / prepare / exec / close, so exercise exactly that, plus the
  //    row-iteration shapes a rekordbox metadata lookup performs.
  try {
    const Database = require(path.join(ROOT, 'node_modules', 'better-sqlite3'));
    const { mkdtempSync } = require('node:fs');
    const dbPath = path.join(mkdtempSync(path.join(require('node:os').tmpdir(), 'tl-sql-')), 'test.db');
    const db = new Database(dbPath);
    db.exec('create table content (id integer primary key, title text, artist text, bpm real)');
    const ins = db.prepare('insert into content (id, title, artist, bpm) values (?, ?, ?, ?)');
    const r = ins.run(467, 'Test Track', 'Test Artist', 128);
    ins.run(468, 'Second', 'Someone', 130);
    // Named parameters + iteration: the shape getMetadata() relies on.
    const rows = db.prepare('select id, title, artist, bpm from content where bpm >= @min order by id')
      .all({ min: 100 });
    const one = db.prepare('select title from content where id = ?').get(467);
    const pragma = db.pragma('journal_mode', { simple: true });
    db.close();
    const pass = r.changes === 1 && rows.length === 2 && rows[0].id === 467
      && one.title === 'Test Track' && typeof pragma === 'string';
    rec('better-sqlite3 (prolink-connect query surface)', pass,
      `changes=${r.changes} rows=${rows.length} first="${rows[0].title}" pragma=${pragma}`);
  } catch (e) {
    rec('better-sqlite3 (prolink-connect query surface)', false, String(e.message).split('\n')[0].slice(0, 110));
  }

  // 2. NDI addon — N-API, should be ABI-stable across majors.
  try {
    const ndi = require(path.join(ROOT, 'native', 'build', 'Release', 'ndi_wrapper.node'));
    rec('NDI ndi_wrapper.node (N-API)', true, `loaded, exports: ${Object.keys(ndi).slice(0, 6).join(',')}`);
  } catch (e) {
    rec('NDI ndi_wrapper.node (N-API)', false, String(e.message).split('\n')[0].slice(0, 110));
  }

  // 3. The patched DJ-link libraries must load and expose what main.js calls.
  try {
    const prolink = require(path.join(ROOT, 'node_modules', 'prolink-connect'));
    rec('prolink-connect loads', true, `exports: ${Object.keys(prolink).slice(0, 6).join(',')}`);
  } catch (e) {
    rec('prolink-connect loads', false, String(e.message).split('\n')[0].slice(0, 110));
  }
  try {
    const stagelinq = require(path.join(ROOT, 'node_modules', 'stagelinq'));
    rec('stagelinq loads', true, `exports: ${Object.keys(stagelinq).slice(0, 6).join(',')}`);
  } catch (e) {
    rec('stagelinq loads', false, String(e.message).split('\n')[0].slice(0, 110));
  }

  // 4. A BrowserWindow, to prove the renderer surface still initialises. It is
  //    deliberately kept alive: Electron quits once the last window closes, so
  //    destroying it here would kill the timers used by step 5.
  let browserWindow = null;
  try {
    const { BrowserWindow } = require('electron');
    browserWindow = new BrowserWindow({ show: false, width: 400, height: 300 });
    rec('BrowserWindow constructs', true, 'ok');
  } catch (e) {
    rec('BrowserWindow constructs', false, String(e.message).split('\n')[0].slice(0, 110));
  }

  // 5. System stats (app.getAppMetrics). This is the source of truth for the
  //    CPU/RAM readout, and three of its behaviours are easy to get wrong, so
  //    assert them explicitly rather than trusting a visual check:
  //      - memory is reported in KILOBYTES, not bytes;
  //      - cpu.percentCPUUsage is already a whole-machine percentage;
  //      - the first call after startup always returns 0.
  if (browserWindow) {
    try {
      const { app: electronApp } = require('electron');
      const first = electronApp.getAppMetrics();
      const firstAllZero = first.every(m => m.cpu.percentCPUUsage === 0);
      const self = first.find(m => m.pid === process.pid);
      const rssKB = Math.round(process.memoryUsage().rss / 1024);
      // Working set should track our own RSS closely and in the same unit.
      const unitsAreKB = self && Math.abs(self.memory.workingSetSize - rssKB) / rssKB < 0.25;
      const privateAvailable = first.every(m => typeof m.memory.privateBytes === 'number');
      const types = [...new Set(first.map(m => m.type))].join('/');

      rec('getAppMetrics first call is all-zero (CPU primed on 2nd)', firstAllZero,
        `n=${first.length} types=${types}`);
      rec('getAppMetrics memory units are KB (not bytes)', unitsAreKB,
        `workingSetSize=${self && self.memory.workingSetSize} vs rss/1024=${rssKB}`);
      rec('getAppMetrics privateBytes available (no shared-page double count)', privateAvailable,
        `self privateBytes=${self && self.memory.privateBytes}KB of ${rssKB}KB working set`);

      // And the aggregation main.js performs must produce sane display values.
      await new Promise(r => setTimeout(r, 600));
      const second = electronApp.getAppMetrics();
      let cpu = 0;
      let ramKB = 0;
      let allPrivate = true;
      for (const m of second) {
        const c = m.cpu.percentCPUUsage;
        if (typeof c === 'number' && c > 0) cpu += c; // clamp negatives
        if (typeof m.memory.privateBytes === 'number') ramKB += m.memory.privateBytes;
        else { allPrivate = false; ramKB += m.memory.workingSetSize || 0; }
      }
      const cpuStr = Math.min(100, cpu).toFixed(1);
      const ramStr = (ramKB / 1024).toFixed(0);
      const sane = cpuStr !== 'NaN' && ramStr !== 'NaN'
        && Number(cpuStr) >= 0 && Number(cpuStr) <= 100
        && Number(ramStr) > 0 && Number(ramStr) < 1024 * 64;
      rec('aggregated stats produce sane display values', sane,
        `CPU: ${cpuStr}%  RAM: ${ramStr}MB  (${allPrivate ? 'private bytes' : 'working set'}, ${second.length} procs)`);
    } catch (e) {
      rec('getAppMetrics system stats', false, String(e.message).split('\n')[0].slice(0, 110));
    }
  }

  if (browserWindow) browserWindow.destroy();

  console.log('\n===== SMOKE RESULTS =====');
  let failed = 0;
  for (const r of results) {
    if (!r.pass) failed++;
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}\n        ${r.detail}`);
  }
  console.log(`===== ${failed === 0 ? 'ALL PASS' : failed + ' FAILED'} =====\n`);
  app.exit(failed ? 1 : 0);
});

// A smoke test that dies quietly is worse than no smoke test: report the
// failure and the results gathered so far rather than exiting 0 with no output.
process.on('unhandledRejection', (err) => {
  rec('smoke harness completed', false, String((err && err.stack) || err).split('\n').slice(0, 3).join(' | ').slice(0, 200));
  console.log('\n===== SMOKE RESULTS (harness threw) =====');
  for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}\n        ${r.detail}`);
  console.log('===== FAILED =====\n');
  app.exit(1);
});
