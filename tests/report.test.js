/* tests/report.test.js — Word report: map snapshot, docx content, offline fallback, cancel, empty case */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { open, check, summary, unzip } = require('./lib');
const tmp = f => path.join(os.tmpdir(), f);
(async () => {
  const { browser, page, errors } = await open();
  const dialogs = [];
  let promptAnswer = 'Справа №123/2026';
  page.on('dialog', d => { dialogs.push(d.type() + ': ' + d.message().slice(0, 90)); if (d.type() === 'prompt' && promptAnswer === null) d.dismiss(); else d.accept(d.type() === 'prompt' ? promptAnswer : undefined); });
  // our own "OpenStreetMap": plain tiles (alternating shade), drawn in the page
  const tileB64 = await page.evaluate(() => [0, 1].map(k => { const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
    g.fillStyle = k ? '#dfe8d5' : '#e9f0e0'; g.fillRect(0, 0, 256, 256); g.strokeStyle = '#fff'; g.lineWidth = 9; g.beginPath(); g.moveTo(0, 128); g.lineTo(256, 128); g.moveTo(128, 0); g.lineTo(128, 256); g.stroke();
    return c.toDataURL('image/png').split(',')[1]; }));
  let tileHits = 0, tilesOK = true;
  await page.route('**/tiles/**', async route => {
    tileHits++;
    if (!tilesOK) return route.fulfill({ status: 404, body: '' });
    const m = /tiles\/(\d+)\/(\d+)\/(\d+)\.png/.exec(route.request().url());
    route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from(tileB64[((+m[2]) + (+m[3])) % 2], 'base64') });
  });
  await page.evaluate(() => { App.report.config.docxUrls = ['/docx.iife.js']; App.report.config.tileUrl = '/tiles/{z}/{x}/{y}.png'; });

  console.log('--- Word report ---');
  // scenario data
  await page.evaluate(() => {
    const noise = (w, h, type) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d');
      const g = x.createLinearGradient(0, 0, w, h); g.addColorStop(0, '#2b6cb0'); g.addColorStop(1, '#e53e3e'); x.fillStyle = g; x.fillRect(0, 0, w, h);
      for (let i = 0; i < 2500; i++) { x.fillStyle = `hsl(${Math.random() * 360},70%,55%)`; x.fillRect(Math.random() * w, Math.random() * h, 12, 12); }
      x.fillStyle = '#fff'; x.font = `bold ${h / 6}px Arial`; x.fillText('ФОТО', w / 8, h / 2); return c.toDataURL(type); };
    const P = (id, lat, lng, time, src, note, photo) => ({ id, lat, lng, date: '2026-10-08', time, sourceType: src, note, photo: photo || null });
    App.state.routes = App.utils.normalizeRoutes([
      { id: 'r1', name: "Кур'єр-1", type: 'pedestrian', color: '#e63946', tags: ['Свідок', "Кур'єр"],
        points: [P('a1', 49.5535, 25.5948, '10:00', 'camera', 'виходить з під\u2019їзду'), P('a2', 49.5541, 25.5975, '10:07', 'dashcam', '', noise(2400, 1800, 'image/png')),
                 P('a3', 49.5552, 25.6010, '10:15', 'other', 'перетин вулиці Руської', noise(800, 600, 'image/webp')), P('a4', 49.5560, 25.6040, '10:22', 'camera', 'сідає в авто', '/missing.jpg')],
        bends: [{ id: 'b1', afterPointId: 'a2', lat: 49.5549, lng: 25.5990 }, { id: 'b2', afterPointId: 'a2', lat: 49.5551, lng: 25.6000 }] },
      { id: 'r2', name: 'Авто-7 (сірий седан)', type: 'vehicle', color: '#2a9d8f', tags: ['Водій'],
        points: [P('c1', 49.5500, 25.5900, '09:30', 'dashcam', 'старт'), P('c2', 49.5520, 25.5990, '09:40', 'other', ''), P('c3', 49.5575, 25.6075, '09:55', 'camera', 'зупинка')], bends: [] }
    ]);
    App.state.markers = [{ id: 'm1', icon: 'hazard', label: 'Знахідка', lat: 49.5545, lng: 25.6000, note: 'біля контейнера' }, { id: 'm2', icon: 'home', label: 'Адреса №2', lat: 49.5530, lng: 25.5930, note: '' }];
    App.map.renderAll(); App.poi.renderAll(); App.sidebar.render();
  });

  // 1) happy path
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.click('#wordReportBtn')]);
  const out = tmp('route-map-report.docx'); await dl.saveAs(out);
  check('download named zvit-YYYY-MM-DD.docx', /^zvit-\d{4}-\d{2}-\d{2}\.docx$/.test(dl.suggestedFilename()), dl.suggestedFilename());
  check('asked for the case title (prompt)', dialogs.some(d => d.startsWith('prompt')));
  check('map tiles were requested', tileHits > 4, tileHits);
  check('button restored after the build', await page.$eval('#wordReportBtn', b => !b.disabled && /Звіт у Word/.test(b.textContent)));
  check('docx is a zip with content (>20 KB)', fs.statSync(out).size > 20000 && fs.readFileSync(out).slice(0, 2).toString() === 'PK', fs.statSync(out).size);
  const parts = unzip(fs.readFileSync(out));
  const xml = parts['word/document.xml'].toString('utf8');
  const rels = parts['word/_rels/document.xml.rels'].toString('utf8');
  const text = xml.replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');   // XML escapes -> plain text
  const wanted = ['Звіт за маршрутами', 'Справа №123/2026', "Кур'єр-1", 'Авто-7 (сірий седан)', 'Знахідка', '49.553500', '08.10.2026'];
  const absent = wanted.filter(t => !text.includes(t));
  check('docx text: title, case number, both routes, marker, a coordinate, a date', absent.length === 0, absent);
  check('docx has 4 tables (legend, 2 routes, markers) and 3 pictures (map + 2 photos)', (xml.match(/<w:tbl>/g) || []).length === 4 && (xml.match(/<pic:pic /g) || []).length === 3, [(xml.match(/<w:tbl>/g) || []).length, (xml.match(/<pic:pic /g) || []).length]);
  check('the photo that is only a web link becomes a hyperlink', rels.includes('/missing.jpg'));
  check('page is A4 portrait', /w:w="11906"/.test(xml) && /w:h="16838"/.test(xml));
  // the map picture on its own, for a visual check
  const png = await page.evaluate(async () => { const rs = App.state.routes, pois = App.state.markers; const r = await App.report.renderMap(rs, pois); let s = ''; for (const b of r.bytes) s += String.fromCharCode(b); return { b64: btoa(s), loaded: r.tilesLoaded, total: r.tilesTotal }; });
  fs.writeFileSync(tmp('route-map-snapshot.png'), Buffer.from(png.b64, 'base64'));
  check('all map tiles loaded', png.loaded === png.total && png.total > 0, png);

  // 2) fallbacks
  tilesOK = false; dialogs.length = 0;
  const [dl2] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.click('#wordReportBtn')]);
  await dl2.saveAs(tmp('route-map-report-notiles.docx'));
  check('no tiles (offline): report still produced', fs.statSync(tmp('route-map-report-notiles.docx')).size > 15000);
  tilesOK = true;
  promptAnswer = null; dialogs.length = 0;
  const gotDownload = await Promise.all([page.waitForEvent('download', { timeout: 1500 }).then(() => true, () => false), page.click('#wordReportBtn')]).then(r => r[0]);
  check('cancelling the prompt produces no file', gotDownload === false);
  promptAnswer = '';
  await page.evaluate(() => { App.state.routes.forEach(r => r.visible = false); App.state.markers = []; });
  dialogs.length = 0; await page.click('#wordReportBtn'); await page.waitForTimeout(300);
  check('nothing to report: friendly message', dialogs.some(d => /Немає що вносити/.test(d)), dialogs);
  console.log('page errors:', errors.length ? errors : 'none');
  summary(); await browser.close();
})().catch(e => { console.error('CRASH', e); process.exit(1); });
