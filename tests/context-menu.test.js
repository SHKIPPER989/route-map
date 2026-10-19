/* tests/context-menu.test.js — route-line right-click menu: position/closing, add point here (time, snapping, bend chain), add bend, reverse */
const { open, check, summary, createRoute, mapClick, addPointViaClick, lines, lineClick } = require('./lib');
const P = (id, lat, lng, time) => ({ id, lat, lng, date: '2026-10-08', time, sourceType: 'other', note: '', photo: null });
const load = (page, routes) => page.evaluate(rs => { App.state.routes = App.utils.normalizeRoutes(rs); App.state.activeRouteId = null; App.state.mode = null; App.map.renderAll(); App.sidebar.render(); }, routes);
const R = (id, name, color, points, bends = []) => ({ id, name, type: 'pedestrian', color, tags: [], points, bends });
async function rightClick(page, lat, lng, x = 300, y = 220, idx = 0) {
  return page.evaluate(([a, b, cx, cy, i]) => { window.__prevented = false;
    const hit = window.__lines.filter(l => l.options.className === 'route-hit-line')[i];
    const ev = { clientX: cx, clientY: cy, preventDefault() { window.__prevented = true; } };
    hit.fire('contextmenu', { latlng: { lat: a, lng: b }, originalEvent: ev });
    if (!ev._stopped) window.__map.fire('contextmenu', { latlng: { lat: a, lng: b } }); return !!ev._stopped; }, [lat, lng, cx = x, y, idx]);
}
const path = async page => (await lines(page))[0].pts;
const pts = page => page.evaluate(() => App.utils.sortedPoints(App.state.routes[0]).map(p => p.id + '@' + p.time));
(async () => {
  const { browser, page, errors } = await open();
  let dlg = { accept: true }, msgs = [];
  page.on('dialog', d => { msgs.push(d.message()); dlg.accept ? d.accept() : d.dismiss(); });
  await page.evaluate(() => { App.history.config.burstMs = 0; });
  console.log('--- Route-line right-click menu ---');
  const AB = () => R('r1', 'Лінія', '#1d70b8', [P('A', 49.55, 25.59, '10:00'), P('B', 49.55, 25.592, '10:10')]);
  await load(page, [AB()]);

  // [1] menu itself
  const stopped = await rightClick(page, 49.55, 25.591, 300, 220);
  check('menu opens, event stopped from reaching the map, native menu suppressed', stopped && await page.evaluate(() => window.__prevented === true && !!document.querySelector('.ctx-menu')));
  check('title shows the route; 4 items in order', await page.evaluate(() => document.querySelector('.ctx-title').textContent.includes('Лінія') && [...document.querySelectorAll('.ctx-item')].map(b => b.textContent.trim()).join('|') === '📍Додати точку тут|📐Додати коліно|⇄Реверс напрямку|↩Дорога назад…'));
  const box = await page.$eval('.ctx-menu', e => { const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top)]; });
  check('menu sits at the mouse position', box[0] === 300 && box[1] === 220, box);
  await page.keyboard.press('Escape'); check('Esc closes', await page.$('.ctx-menu') === null);
  await rightClick(page, 49.55, 25.591); await page.mouse.click(5, 400); check('click outside closes', await page.$('.ctx-menu') === null);
  await rightClick(page, 49.55, 25.591); await page.evaluate(() => window.__map.fire('movestart')); check('map move closes', await page.$('.ctx-menu') === null);
  await rightClick(page, 49.55, 25.591, 1295, 845);
  check('menu is kept inside the window at the corner', await page.$eval('.ctx-menu', e => { const r = e.getBoundingClientRect(); return r.right <= innerWidth && r.bottom <= innerHeight; }));
  await rightClick(page, 49.55, 25.591, 300, 220); check('a second right-click replaces the menu (only one)', (await page.$$('.ctx-menu')).length === 1);
  await page.keyboard.press('Escape');

  // [2] add point here: midpoint, time interpolated, snapped
  await rightClick(page, 49.55004, 25.5910);                        // ~4px off the line
  await page.click('.ctx-item:has-text("Додати точку тут")');
  const m = await page.evaluate(() => ({ open: document.getElementById('pointModalOverlay').style.display === 'flex', title: document.getElementById('pointModalTitle').textContent, lat: document.getElementById('ptLat').value, lng: document.getElementById('ptLng').value, date: document.getElementById('ptDate').value, time: document.getElementById('ptTime').value, mode: App.state.mode, active: App.state.activeRouteId }));
  check('modal opens for the clicked route', m.open && m.title.includes('«Лінія»'), m.title);
  check('coordinates snapped onto the line', m.lat === '49.550000' && m.lng === '25.591000', m);
  check('time interpolated halfway (10:05), same date', m.time === '10:05' && m.date === '2026-10-08', m);
  check('no add mode was switched on', m.mode === null && m.active === null);
  await page.fill('#ptNote', 'тут'); await page.click('#ptSave');
  check('point saved into that route, between A and B', JSON.stringify(await pts(page)).startsWith('["A@10:00"') && (await pts(page))[1].endsWith('@10:05') && (await pts(page)).length === 3);
  check('line passes through the new point', (await path(page)).length === 3 && (await path(page))[1][1] === 25.591);
  check('still not in add mode after saving', await page.evaluate(() => App.state.mode === null));
  // cancel leaves nothing behind; the next normal add-mode flow uses its own route
  await rightClick(page, 49.55, 25.5915); await page.click('.ctx-item:has-text("Додати точку тут")'); await page.click('#ptCancel');
  check('cancel adds nothing', (await pts(page)).length === 3);
  await page.evaluate(() => { App.state.routes.push(App.utils.normalizeRoutes([{ id: 'r9', name: 'Інший', type: 'pedestrian', color: '#c00', points: [] }])[0]); App.sidebar.render(); });
  await page.click('[data-add="r9"]'); await mapClick(page, 49.56, 25.6);
  check('afterwards add-mode still targets ITS route (menu target was cleared)', await page.$eval('#pointModalTitle', e => e.textContent.includes('«Інший»')));
  await page.click('#ptCancel'); await page.click('#stopAddBtn');

  // [3] bend chain is split where the point is added
  const withApex = () => R('r1', 'Лінія', '#1d70b8', [P('A', 49.55, 25.59, '10:00'), P('B', 49.55, 25.592, '10:10')], [{ id: 'bx', lat: 49.549, lng: 25.591, afterPointId: 'A' }]);
  await load(page, [withApex()]);
  await rightClick(page, 49.5496, 25.5904); await page.click('.ctx-item:has-text("Додати точку тут")');
  check('on the first leg 40% along → 20% of the time (10:02)', await page.$eval('#ptTime', e => e.value) === '10:02');
  await page.click('#ptSave');
  const nid = (await page.evaluate(() => App.utils.sortedPoints(App.state.routes[0])[1].id));
  check('path A → NEW → apex → B (no zig-zag)', JSON.stringify(await path(page)) === JSON.stringify([[49.55, 25.59], [49.5496, 25.5904], [49.549, 25.591], [49.55, 25.592]]), await path(page));
  check('the bend beyond the click now hangs off the new point', await page.evaluate(id => App.state.routes[0].bends[0].afterPointId === id, nid));
  await load(page, [withApex()]);
  await rightClick(page, 49.5496, 25.5916); await page.click('.ctx-item:has-text("Додати точку тут")');
  check('on the second leg 60% along → 80% of the time (10:08)', await page.$eval('#ptTime', e => e.value) === '10:08');
  await page.click('#ptSave');
  check('path A → apex → NEW → B; bend stays on A', JSON.stringify(await path(page)) === JSON.stringify([[49.55, 25.59], [49.549, 25.591], [49.5496, 25.5916], [49.55, 25.592]]) && await page.evaluate(() => App.state.routes[0].bends[0].afterPointId === 'A'), await path(page));
  // identical times: still lands between its neighbours
  await load(page, [R('r1', 'Лінія', '#1d70b8', [P('A', 49.55, 25.59, '10:00'), P('B', 49.55, 25.592, '10:00')])]);
  await rightClick(page, 49.55, 25.591); await page.click('.ctx-item:has-text("Додати точку тут")'); await page.click('#ptSave');
  const tie = await pts(page);
  check('same time on both neighbours: new point is still in the middle', tie[0].startsWith('A') && tie[2].startsWith('B') && tie.length === 3, tie);

  // [4] RMB add actions leave "add point" mode (no endless adding)
  await load(page, [AB()]);
  const modeState = () => page.evaluate(() => ({ mode: App.state.mode, active: App.state.activeRouteId, bar: getComputedStyle(document.getElementById('addModeBar')).display, cursor: App.map.instance.getContainer().style.cursor }));
  const mapClickOpensDialog = async () => { await page.evaluate(() => window.__map.fire('click', { latlng: { lat: 49.5555, lng: 25.6 } })); const o = await page.evaluate(() => document.getElementById('pointModalOverlay').style.display === 'flex'); if (o) await page.click('#ptCancel'); return o; };
  await page.evaluate(() => { App.pointModal.startAddMode('r1'); });
  check('(precondition) add mode is on; a map click opens the dialog', (await modeState()).mode === 'point' && await mapClickOpensDialog());
  await rightClick(page, 49.55, 25.591); await page.click('.ctx-item:has-text("Додати коліно")');
  let ms = await modeState();
  check('RMB → bend: bend added AND add mode switched off', await page.evaluate(() => App.state.routes[0].bends.length === 1) && ms.mode === null && ms.active === null && ms.bar === 'none' && ms.cursor === '', ms);
  check('…so further clicks on the map add nothing', await mapClickOpensDialog() === false && await page.evaluate(() => App.state.routes[0].points.length === 2));
  check('all point markers are still on the map', await page.evaluate(() => document.querySelectorAll('.leaflet-marker-icon .pt-icon').length === 2 && document.querySelectorAll('.leaflet-marker-icon .bend-dot').length === 1));
  await load(page, [AB()]);
  await page.evaluate(() => { App.pointModal.startAddMode('r1'); });
  await rightClick(page, 49.55, 25.591); await page.click('.ctx-item:has-text("Додати точку тут")');
  check('RMB → point: dialog opens and add mode is already off', (await modeState()).mode === null && await page.evaluate(() => document.getElementById('pointModalOverlay').style.display === 'flex'));
  await page.click('#ptSave');
  ms = await modeState();
  check('after saving that point: still off, no endless adding', ms.mode === null && ms.bar === 'none' && await page.evaluate(() => App.state.routes[0].points.length === 3) && await mapClickOpensDialog() === false);
  // placing a POI marker is also a "keep adding" mode
  await load(page, [AB()]);
  await page.click('#poiAddBtn');
  check('(precondition) POI placing is on', await page.evaluate(() => !!App.state.poiPlacing));
  await rightClick(page, 49.55, 25.591); await page.click('.ctx-item:has-text("Додати коліно")');
  check('RMB → bend also cancels POI placing', await page.evaluate(() => !App.state.poiPlacing && getComputedStyle(document.getElementById('poiPlaceBar')).display === 'none'));
  // reverse does not touch the add mode
  await load(page, [AB()]);
  await page.evaluate(() => { App.pointModal.startAddMode('r1'); });
  await rightClick(page, 49.55, 25.591); await page.click('.ctx-item:has-text("Реверс")');
  check('reverse leaves add mode as it was (it adds nothing)', (await modeState()).mode === 'point');
  await page.click('#stopAddBtn');

  // [5] reverse
  const ABC = () => R('r1', 'Лінія', '#1d70b8', [P('A', 49.55, 25.59, '10:00'), P('B', 49.55, 25.592, '10:10'), P('C', 49.552, 25.594, '10:30')],
                      [{ id: 'b1', lat: 49.5508, lng: 25.5905, afterPointId: 'A' }, { id: 'b2', lat: 49.5508, lng: 25.5915, afterPointId: 'A' }]);
  await load(page, [ABC()]);
  const before = await path(page);
  const d0 = (await page.evaluate(() => App.history.depth())).undo;
  msgs.length = 0; dlg.accept = false;
  await rightClick(page, 49.551, 25.593); await page.click('.ctx-item:has-text("Реверс")');
  check('asks for confirmation (mentions the route and Ctrl+Z)', msgs.length === 1 && msgs[0].includes('«Лінія»') && msgs[0].includes('Ctrl+Z'), msgs);
  check('declining changes nothing', JSON.stringify(await path(page)) === JSON.stringify(before) && JSON.stringify(await pts(page)) === '["A@10:00","B@10:10","C@10:30"]');
  dlg.accept = true;
  await rightClick(page, 49.551, 25.593); await page.click('.ctx-item:has-text("Реверс")');
  const after = await path(page);
  check('path is exactly the old path backwards (bends included)', JSON.stringify(after) === JSON.stringify([...before].reverse()), after);
  check('times mirrored: C 10:00, B 10:10, A 10:30', JSON.stringify(await pts(page)) === '["C@10:00","B@10:10","A@10:30"]', await pts(page));
  check('bends moved to the point they now follow, order reversed', await page.evaluate(() => App.state.routes[0].bends.map(b => b.id + '>' + b.afterPointId).join() === 'b2>B,b1>B'));
  check('exactly one undo step', (await page.evaluate(() => App.history.depth())).undo === d0 + 1);
  await page.keyboard.press('Control+z');
  check('Ctrl+Z restores the original direction, times and bends', JSON.stringify(await path(page)) === JSON.stringify(before) && JSON.stringify(await pts(page)) === '["A@10:00","B@10:10","C@10:30"]' && await page.evaluate(() => App.state.routes[0].bends.map(b => b.id + '>' + b.afterPointId).join() === 'b1>A,b2>A'));
  await page.keyboard.press('Control+y');
  check('Ctrl+Y re-applies it', JSON.stringify(await path(page)) === JSON.stringify([...before].reverse()));
  // reverse twice = original
  await rightClick(page, 49.551, 25.593); await page.click('.ctx-item:has-text("Реверс")');
  check('reversing twice gives back the original', JSON.stringify(await path(page)) === JSON.stringify(before) && JSON.stringify(await pts(page)) === '["A@10:00","B@10:10","C@10:30"]');
  // equal times: direction must still flip
  await load(page, [R('r1', 'Лінія', '#1d70b8', [P('A', 49.55, 25.59, '10:00'), P('B', 49.55, 25.592, '10:00'), P('C', 49.552, 25.594, '10:00')])]);
  const t0 = await path(page);
  await rightClick(page, 49.551, 25.593); await page.click('.ctx-item:has-text("Реверс")');
  check('all times equal: the line still runs the other way', JSON.stringify(await path(page)) === JSON.stringify([...t0].reverse()), await path(page));
  // stray bend after the last point is dropped (it would lead nowhere)
  await load(page, [R('r1', 'Лінія', '#1d70b8', [P('A', 49.55, 25.59, '10:00'), P('B', 49.55, 25.592, '10:10')], [{ id: 'tail', lat: 49.551, lng: 25.593, afterPointId: 'B' }])]);
  await rightClick(page, 49.55, 25.591); await page.click('.ctx-item:has-text("Реверс")');
  check('a bend hanging off the last point is dropped, rest reversed', JSON.stringify(await path(page)) === JSON.stringify([[49.55, 25.592], [49.55, 25.59]]) && await page.evaluate(() => App.state.routes[0].bends.length === 0), await path(page));

  check('no load-error banner', await page.$('#loadBanner') === null);
  console.log('page errors:', errors.length ? errors : 'none');
  summary(); await browser.close();
})().catch(e => { console.error('CRASH', e); process.exit(1); });
