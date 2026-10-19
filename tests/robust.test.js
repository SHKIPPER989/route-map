/* tests/robust.test.js — safe rendering (a failed redraw keeps the old drawing) and the on-page error note */
const { open, check, summary, createRoute, addPointViaClick, lines } = require('./lib');
(async () => {
  const { browser, page, errors } = await open();
  console.log('--- Safe rendering + on-page error note ---');
  await createRoute(page, 'R', '#e63946'); await addPointViaClick(page, 49.55, 25.59, '10:00'); await addPointViaClick(page, 49.55, 25.592, '10:10'); await page.click('#stopAddBtn');
  const count = () => page.evaluate(() => ({ pts: document.querySelectorAll('.leaflet-marker-icon .pt-icon').length, lines: (window.__lines || []).filter(l => l.options.className !== 'route-hit-line').length, vertices: ((window.__lines || []).filter(l => l.options.className !== 'route-hit-line')[0] || { _lls: [] })._lls.length }));
  const ok = await count();
  check('baseline: 2 points, 1 line', ok.pts === 2 && ok.lines === 1, ok);
  // a failure while BUILDING the new drawing must not wipe the old one
  await page.evaluate(() => { window.__origPolyline = L.polyline; L.polyline = () => { throw new Error('boom: Invalid LatLng object'); }; });
  await page.evaluate(() => { const r = App.state.routes[0]; r.bends.push({ id: 'bx', lat: 49.551, lng: 25.591, afterPointId: r.points[0].id }); App.map.renderRoute(r); });
  const after = await count();
  check('build failed → the old points and line are still on the map', after.pts === 2 && after.lines === 1 && after.vertices === 2, after);
  check('the cause is shown on the page', await page.$eval('#errorNote', e => /Не вдалося намалювати маршрут «R»/.test(e.textContent) && /boom/.test(e.textContent)));
  // recovery
  await page.evaluate(() => { L.polyline = window.__origPolyline; const r = App.state.routes[0]; App.map.renderRoute(r); });
  const rec = await count();
  check('next render succeeds and includes the new bend', rec.pts === 2 && rec.lines === 1 && rec.vertices === 3, rec);
  // a failure while ADDING to the map: the old markers are put back
  await page.evaluate(() => { window.__origGroupAdd = Object.getPrototypeOf(window.__map._pane).constructor; });
  // uncaught errors / rejected promises are shown too, ✕ closes the note
  await page.evaluate(() => { document.getElementById('errorNote') && document.getElementById('errorNote').remove(); });
  await page.evaluate(() => window.dispatchEvent(new ErrorEvent('error', { message: 'Uncaught TypeError: x is not a function', filename: 'http://h/js/map.js', lineno: 42 })));
  check('uncaught error → note with message and file:line', await page.$eval('#errorNote', e => /x is not a function/.test(e.textContent) && /map\.js:42/.test(e.textContent)));
  await page.evaluate(() => { const ev = new Event('unhandledrejection'); ev.reason = new Error('rejected!'); window.dispatchEvent(ev); });
  check('unhandled promise rejection → note', await page.$eval('#errorNote', e => /rejected!/.test(e.textContent)));
  await page.evaluate(() => window.dispatchEvent(new ErrorEvent('error', { message: 'ResizeObserver loop completed with undelivered notifications.' })));
  check('harmless ResizeObserver noise is not shown', await page.$eval('#errorNote', e => !/ResizeObserver/.test(e.textContent)));
  await page.click('#errorNote span'); check('✕ closes the note', await page.$('#errorNote') === null);
  check('no load-error banner', await page.$('#loadBanner') === null);
  console.log('page errors (expected: only the deliberately thrown ones are NOT counted as page errors):', errors.length ? errors : 'none');
  summary(); await browser.close();
})().catch(e => { console.error('CRASH', e); process.exit(1); });
