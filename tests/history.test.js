/* tests/history.test.js — undo / redo: steps, bursts, guards, view state, import/plan/bulk, photos, limit, persistence */
const { open, check, summary, createRoute, mapClick, addPointViaClick, lines, lineClick } = require('./lib');
const fs = require('fs');
const os = require('os');
const path = require('path');
const depth = page => page.evaluate(() => App.history.depth());
const st = page => page.evaluate(() => ({ routes: App.state.routes.map(r => ({ n: r.name, pts: r.points.length, bends: r.bends.length, color: r.color, visible: r.visible })), markers: App.state.markers.length }));
const cyr = (page, shift = false) => page.evaluate(sh => document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyZ', key: 'я', ctrlKey: true, shiftKey: sh, bubbles: true, cancelable: true })), shift);
(async () => {
  const { browser, page, errors } = await open();
  page.on('dialog', d => d.accept(d.type() === 'prompt' ? 'План H' : undefined));
  await page.evaluate(() => { App.history.config.burstMs = 0; });
  console.log('--- Undo / Redo ---');
  check('buttons disabled on a fresh page', await page.$eval('#undoBtn', b => b.disabled) && await page.$eval('#redoBtn', b => b.disabled));
  await createRoute(page, 'R1', '#ff0000');
  await addPointViaClick(page, 49.5500, 25.5900, '10:00');
  await addPointViaClick(page, 49.5500, 25.5920, '10:10');
  await page.click('#stopAddBtn');
  await lineClick(page, 49.5500, 25.5910);     // bend
  check('4 undo steps recorded (route, 2 points, bend)', (await depth(page)).undo === 4, await depth(page));
  check('↶ enabled', await page.$eval('#undoBtn', b => !b.disabled));
  await page.keyboard.press('Control+z');
  check('Ctrl+Z removes the bend', (await st(page)).routes[0].bends === 0 && (await lines(page))[0].pts.length === 2);
  await page.keyboard.press('Control+z'); await page.keyboard.press('Control+z');
  check('2 more Ctrl+Z: no points left', (await st(page)).routes[0].pts === 0 && (await page.$$('.leaflet-marker-icon')).length === 0);
  await page.keyboard.press('Control+z');
  check('4th Ctrl+Z: route gone, no ghost line/markers', (await st(page)).routes.length === 0 && (await lines(page)).length === 0 && (await page.$$('.leaflet-marker-icon')).length === 0);
  check('sidebar list emptied', await page.$eval('#emptyMsg', e => getComputedStyle(e).display !== 'none'));
  await page.keyboard.press('Control+z');
  check('extra Ctrl+Z at the start is harmless', (await depth(page)).undo === 0 && (await st(page)).routes.length === 0);
  await page.keyboard.press('Control+y'); await page.keyboard.press('Control+y'); await page.keyboard.press('Control+y'); await page.keyboard.press('Control+y');
  const back = await st(page);
  check('4x Ctrl+Y restores route, 2 points, bend', back.routes.length === 1 && back.routes[0].pts === 2 && back.routes[0].bends === 1 && (await lines(page))[0].pts.length === 3, back);
  check('markers redrawn after redo', (await page.$$('.leaflet-marker-icon .pt-icon')).length === 2);
  // new change after undo drops the redo branch
  await page.keyboard.press('Control+z');
  check('redo available after undo', (await depth(page)).redo === 1);
  await page.click('[data-add]'); await addPointViaClick(page, 49.5510, 25.5930, '10:30'); await page.click('#stopAddBtn');
  check('a new change clears redo', (await depth(page)).redo === 0);
  // keyboard on a Ukrainian layout + Ctrl+Shift+Z
  await cyr(page);
  check('Ctrl+Z works on a Ukrainian layout (key "я")', (await st(page)).routes[0].pts === 2);
  await cyr(page, true);
  check('Ctrl+Shift+Z redoes', (await st(page)).routes[0].pts === 3);
  // guards
  const d0 = await depth(page);
  await page.focus('#routeName'); await page.keyboard.press('Control+z');
  check('Ctrl+Z inside a text field is left to the browser', JSON.stringify(await depth(page)) === JSON.stringify(d0));
  await page.evaluate(() => App.pointModal.openForAdd(null)); await page.keyboard.press('Control+z');
  check('Ctrl+Z ignored while a dialog is open', JSON.stringify(await depth(page)) === JSON.stringify(d0));
  await page.click('#ptCancel');
  // coalescing a burst (colour picker drag) into one step
  await page.evaluate(() => { App.history.config.burstMs = 500; });
  const before = (await depth(page)).undo;
  await page.evaluate(() => { const el = document.querySelector('[data-route-color]'); for (let i = 0; i < 30; i++) { el.value = '#' + (0x100000 + i * 5000).toString(16).padStart(6, '0'); el.dispatchEvent(new Event('input', { bubbles: true })); } });
  check('30 colour-picker events = 1 undo step', (await depth(page)).undo === before + 1, await depth(page));
  check('line recoloured and legend refreshed', (await lines(page))[0].color !== '#ff0000' && await page.$eval('.swatch-dot', e => e.style.background !== ''));
  await page.keyboard.press('Control+z');
  check('one Ctrl+Z restores the original colour', (await st(page)).routes[0].color === '#ff0000' && (await lines(page))[0].color === '#ff0000');
  await page.waitForTimeout(600); await page.evaluate(() => { App.history.config.burstMs = 0; });
  // view state (hidden routes) is not undone
  await createRoute(page, 'R2', '#00aa00'); await page.click('#stopAddBtn');
  await page.evaluate(() => { const b = document.querySelectorAll('[data-vis]')[1]; b.click(); });
  check('R2 hidden', (await st(page)).routes[1].visible === false);
  await page.evaluate(() => { const r = App.state.routes[0]; App.sidebar.deletePoint(r.id, r.points[0].id); });
  await page.keyboard.press('Control+z');
  const after = await st(page);
  check('undoing an unrelated edit keeps R2 hidden', after.routes[1].visible === false && after.routes[0].pts === 3, after);
  // delete route (undoable) + bulk import (undoable)
  await lineClick(page, 49.5500, 25.5911);   // give R1 a bend so its restoration can be checked
  check('R1 has a bend before deleting', (await st(page)).routes[0].bends === 1);
  await page.click('[data-del-route]'); // first route
  check('route deleted', (await st(page)).routes.length === 1);
  await page.keyboard.press('Control+z');
  check('undo restores the deleted route with its points and bends', (await st(page)).routes.length === 2 && (await st(page)).routes[0].pts === 3 && (await st(page)).routes[0].bends === 1);
  await page.fill('#bulkImportText', 'Маршрут,Широта,Довгота,Час\nBulk,49.56,25.60,11:00\nBulk,49.561,25.601,11:05');
  await page.click('#bulkImportBtn');
  check('bulk import added a route', (await st(page)).routes.length === 3);
  await page.keyboard.press('Control+z');
  check('undo reverts the bulk import (no ghost line)', (await st(page)).routes.length === 2 && (await lines(page)).length === 1, (await lines(page)).length);
  // JSON import replaces everything -> undo brings the old data back; no ghosts either way
  const jsonPath = path.join(os.tmpdir(), 'route-map-h-import.json');
  fs.writeFileSync(jsonPath, JSON.stringify({ routes: [{ id: 'imp1', name: 'Імп', type: 'vehicle', color: '#123456', points: [{ id: 'ip1', lat: 49.56, lng: 25.6, date: '2026-10-08', time: '09:00' }, { id: 'ip2', lat: 49.561, lng: 25.601, date: '2026-10-08', time: '09:10' }] }], markers: [] }));
  await page.setInputFiles('#fileInput', jsonPath); await page.waitForTimeout(200);
  check('JSON import: only imported route is drawn (old lines removed)', (await st(page)).routes.length === 1 && (await lines(page)).length === 1 && (await lines(page))[0].color === '#123456', await lines(page));
  await page.keyboard.press('Control+z');
  check('undo of JSON import restores previous routes, imported one is gone', (await st(page)).routes.length === 2 && (await lines(page)).every(l => l.color !== '#123456'));
  // photo identity survives snapshots (interning)
  const big = 'data:image/png;base64,' + 'A'.repeat(50000);
  await page.evaluate(b => { const r = App.state.routes[0]; r.points[0].photo = b; App.map.renderRoute(r); App.sidebar.render(); }, big);
  await page.evaluate(() => { const r = App.state.routes[0]; r.points[0].note = 'x'; App.sidebar.render(); });
  await page.keyboard.press('Control+z'); await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+y');
  check('photo string comes back identical after undo/redo', await page.evaluate(b => App.state.routes[0].points[0].photo === b, big));
  // ↶ ↷ buttons
  const dU = (await depth(page)).undo;
  await page.click('#undoBtn');
  check('↶ button undoes', (await depth(page)).undo === dU - 1);
  await page.click('#redoBtn');
  check('↷ button redoes', (await depth(page)).undo === dU);
  // limit
  await page.evaluate(async () => { for (let i = 0; i < 110; i++) { App.state.routes[0].tags = ['t' + i]; App.sidebar.render(); await new Promise(r => setTimeout(r, 2)); } });
  check('history is capped at 100 steps', (await depth(page)).undo === 100, await depth(page));
  // persistence after undo; history is not persisted
  await page.keyboard.press('Control+z'); const tagNow = await page.evaluate(() => App.state.routes[0].tags[0]);
  await page.waitForTimeout(900); await page.reload(); await page.waitForTimeout(600);
  check('undone state is what gets autosaved & restored on reload', await page.evaluate(t => App.state.routes[0].tags[0] === t, tagNow), tagNow);
  check('history starts empty after reload', JSON.stringify(await depth(page)) === '{"undo":0,"redo":0}' && await page.$eval('#undoBtn', b => b.disabled));
  check('no load-error banner', (await page.$('#loadBanner')) === null);
  console.log('page errors:', errors.length ? errors : 'none');
  summary(); await browser.close();
})().catch(e => { console.error('CRASH', e); process.exit(1); });
