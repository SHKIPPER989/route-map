/* tests/bends.test.js — bends: click on the route line, snapping, order along curved/hairpin streets, legacy data */

const { open, check, summary, createRoute, mapClick, addPointViaClick, lines, lineClick, dragMarker } = require('./lib');
(async () => {
  const { browser, page, errors } = await open();
  console.log('--- Bends: click on the line itself (no mode) ---');
  await createRoute(page, 'Вулиця', '#0000ff');
  await addPointViaClick(page, 49.5500, 25.5900, '10:00');   // A
  await addPointViaClick(page, 49.5500, 25.5920, '10:10');   // B
  check('no 📐 button any more', (await page.$('[data-bend]')) === null);
  // while "add point" mode is on, a click on the line must add a POINT (modal), not a bend
  await lineClick(page, 49.5500, 25.5910);
  check('add-point mode: click on line opens the point modal, no bend', await page.evaluate(() => document.getElementById('pointModalOverlay').style.display === 'flex' && App.state.routes[0].bends.length === 0));
  await page.click('#ptCancel');
  await page.click('#stopAddBtn');
  // mode off: click on the line adds exactly one bend, snapped onto the line
  await lineClick(page, 49.55004, 25.5910);   // ~4px off the centre line
  const b1 = await page.evaluate(() => App.state.routes[0].bends.map(b => [b.lat, b.lng]));
  check('exactly one bend added', b1.length === 1, b1);
  check('bend snapped onto the line (lat 49.55)', Math.abs(b1[0][0] - 49.55) < 1e-9 && Math.abs(b1[0][1] - 25.5910) < 1e-9, b1);
  check('click did not leak to the map (no modal, no point)', await page.evaluate(() => document.getElementById('pointModalOverlay').style.display !== 'flex' && App.state.routes[0].points.length === 2));
  check('line shape unchanged right after adding', JSON.stringify((await lines(page))[0].pts.map(p => p[0])) === '[49.55,49.55,49.55]');
  // drag it into a hairpin apex beyond B
  await dragMarker(page, '.bend-dot', 49.5497, 25.5934);
  check('dragged bend reshapes the path', JSON.stringify((await lines(page))[0].pts) === JSON.stringify([[49.55, 25.59], [49.5497, 25.5934], [49.55, 25.592]]), (await lines(page))[0].pts);
  // click on the return leg (apex -> B), then on the outgoing leg (A -> apex)
  await lineClick(page, 49.54985, 25.5927);
  await lineClick(page, 49.54985, 25.5917);
  const lngs = (await lines(page))[0].pts.map(p => p[1]);
  check('hairpin order: A, outgoing, apex, return, B', JSON.stringify(lngs) === JSON.stringify([25.59, 25.5917, 25.5934, 25.5927, 25.592]), lngs);
  // delete a bend through its popup
  await page.evaluate(() => { const el = [...document.querySelectorAll('.leaflet-marker-icon')].find(e => e.querySelector('.bend-dot')); el.click(); });
  await page.evaluate(() => window.__map._popupEl.querySelector('[data-del-bend]').click());
  check('bend deleted via popup', (await lines(page))[0].pts.length === 4);
  // old saves (numeric t) are converted to array order
  const conv = await page.evaluate(() => { const r = App.utils.normalizeRoutes([{ id: 'r', name: 'x', color: '#000', points: [{ id: 'p1', lat: 1, lng: 1, date: '2026-01-01', time: '01:00' }, { id: 'p2', lat: 1, lng: 2, date: '2026-01-01', time: '02:00' }], bends: [{ id: 'b2', afterPointId: 'p1', lat: 1, lng: 1.6, t: 0.6 }, { id: 'b1', afterPointId: 'p1', lat: 1, lng: 1.2, t: 0.2 }] }])[0]; return r.bends.map(b => b.id + ':' + ('t' in b)); });
  check('legacy bends (with t) converted to order, t dropped', JSON.stringify(conv) === JSON.stringify(['b1:false', 'b2:false']), conv);
  // hidden route + add-point mode shows it again
  await page.click('#stopAddBtn').catch(() => {});
  await page.click('[data-vis]'); check('hidden route has no line', (await lines(page)).length === 0);
  await page.click('[data-add]'); check('➕ on a hidden route re-shows it', (await lines(page)).length === 1);
  console.log('page errors:', errors.length ? errors : 'none');
  summary(); await browser.close();
})().catch(e => { console.error('CRASH', e); process.exit(1); });
