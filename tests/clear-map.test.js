/* tests/clear-map.test.js — map right-click menu "🗑 Очистити карту…": confirmation, what is removed, undo, empty map, plans */
const { open, check, summary, lines, rightClick, mapRightClick, P, R, load } = require('./lib');
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const ROUTES = () => [
  R('r1', "Кур'єр", '#e63946', [P('A', 49.55, 25.59, '10:00', 'camera', 'Старт'), P('B', 49.55, 25.592, '10:10', 'dashcam', 'З фото', PNG), P('C', 49.552, 25.594, '10:30')],
    [{ id: 'b1', lat: 49.5508, lng: 25.5905, afterPointId: 'A' }, { id: 'b2', lat: 49.5508, lng: 25.5915, afterPointId: 'A' }]),
  R('r2', 'Таксі', '#2a9d8f', [P('X', 49.56, 25.6, '09:00'), P('Y', 49.561, 25.601, '09:10')])
];
const MARKERS = () => [{ id: 'm1', icon: 'camera', label: 'CCTV', lat: 49.551, lng: 25.591, note: '' }, { id: 'm2', icon: 'flag', label: 'Збір', lat: 49.553, lng: 25.595, note: '' }];
const onMap = page => page.evaluate(() => ({ routes: App.state.routes.length, markers: App.state.markers.length, lines: (window.__lines || []).filter(l => l.options.className !== 'route-hit-line').length,
  icons: document.querySelectorAll('.leaflet-marker-icon').length, cards: document.querySelectorAll('.photo-card').length, rows: document.querySelectorAll('.route-item').length, poiRows: document.querySelectorAll('.poi-item').length }));
const menu = page => page.evaluate(() => { const m = document.querySelector('.ctx-menu'); return m && { title: (m.querySelector('.ctx-title') || {}).textContent, items: [...m.querySelectorAll('.ctx-item')].map(b => ({ text: b.textContent.trim(), danger: b.classList.contains('ctx-danger'), disabled: b.disabled })) }; });

(async () => {
  const { browser, page, errors } = await open();
  const msgs = []; let accept = true;
  page.on('dialog', d => { msgs.push(d.message()); (accept ? d.accept(d.type() === 'prompt' ? 'План T' : undefined) : d.dismiss()); });
  await page.evaluate(() => { App.history.config.burstMs = 0; });
  console.log('--- Очистити карту ---');
  await load(page, ROUTES(), MARKERS());
  const before = await onMap(page);
  check('(setup) 2 routes, 2 markers, photo card drawn', before.routes === 2 && before.markers === 2 && before.lines === 2 && before.cards === 1, before);

  await page.evaluate(() => { App.pointModal.startAddMode('r1'); });          // a "keep adding" mode is on
  await mapRightClick(page, 400, 300);
  let m = await menu(page);
  check('right-click on an empty spot: menu titled "Карта" with one red item', m && m.title === 'Карта' && m.items.length === 1 && m.items[0].text === '🗑Очистити карту…' && m.items[0].danger && !m.items[0].disabled, m);
  check('the browser\'s own menu is suppressed', await page.evaluate(() => window.__prevented === true));

  accept = false; msgs.length = 0;
  await page.click('.ctx-item:has-text("Очистити карту")');
  check('confirmation names what will go (2 routes, 5 points, 2 bends, 2 markers) and mentions Ctrl+Z', msgs.length === 1 && /маршрутів — 2/.test(msgs[0]) && /точок — 5/.test(msgs[0]) && /колін — 2/.test(msgs[0]) && /міток — 2/.test(msgs[0]) && /Ctrl\+Z/.test(msgs[0]), msgs[0]);
  check('declining changes nothing', JSON.stringify(await onMap(page)) === JSON.stringify(before));

  accept = true; const d0 = await page.evaluate(() => App.history.depth().undo);
  await mapRightClick(page, 400, 300); await page.click('.ctx-item:has-text("Очистити карту")');
  const after = await onMap(page);
  check('confirmed: no routes, markers, lines, photo cards, list rows', after.routes === 0 && after.markers === 0 && after.lines === 0 && after.icons === 0 && after.cards === 0 && after.rows === 0 && after.poiRows === 0, after);
  check('the lists say they are empty; the legend too', await page.evaluate(() => getComputedStyle(document.getElementById('emptyMsg')).display !== 'none' && getComputedStyle(document.getElementById('poiEmptyMsg')).display !== 'none' && /Немає видимих/.test(document.getElementById('routeLegendList').textContent)));
  check('"keep adding" modes were switched off', await page.evaluate(() => App.state.mode === null && App.state.activeRouteId === null && !App.state.poiPlacing && getComputedStyle(document.getElementById('addModeBar')).display === 'none'));
  check('one undo step', await page.evaluate(() => App.history.depth().undo) === d0 + 1);

  await page.keyboard.press('Control+z');
  const back = await onMap(page);
  check('Ctrl+Z restores everything, as it was', JSON.stringify(back) === JSON.stringify(Object.assign({}, before)), back);
  check('…including bends, notes and the photo', await page.evaluate(() => App.state.routes[0].bends.length === 2 && App.state.routes[0].points[1].photo !== null && App.state.routes[0].points[0].note === 'Старт'));
  await page.keyboard.press('Control+y');
  check('Ctrl+Y clears again', (await onMap(page)).routes === 0);
  await page.keyboard.press('Control+z');

  // an empty map: the item is greyed out
  await load(page, [], []);
  await mapRightClick(page, 400, 300); m = await menu(page);
  check('empty map: the item is disabled and says so', m.items[0].disabled && /вона порожня/.test(m.items[0].text), m);
  msgs.length = 0; await page.click('.ctx-item', { force: true, timeout: 800 }).catch(() => {});
  check('clicking it does nothing (no confirmation)', msgs.length === 0);
  await page.keyboard.press('Escape');

  // lines keep their own menu
  await load(page, ROUTES(), MARKERS());
  await rightClick(page, 49.551, 25.593); m = await menu(page);
  check('right-click on a route line opens the ROUTE menu, not the map menu', m.title === "Кур'єр" && m.items.length === 4 && !m.items.some(i => /Очистити/.test(i.text)), m);
  await page.keyboard.press('Escape');

  // saved plans are separate; the cleared state is what gets autosaved
  await page.click('#planSaveBtn'); await page.waitForTimeout(300);
  check('(setup) a plan was saved', await page.$eval('#plansSelect', s => s.options.length === 1 && /План/.test(s.options[0].text)));
  await mapRightClick(page); await page.click('.ctx-item:has-text("Очистити карту")');
  check('saved plans are not touched by clearing', await page.$eval('#plansSelect', s => s.options.length === 1 && /План/.test(s.options[0].text)));
  await page.waitForTimeout(900); await page.reload(); await page.waitForTimeout(600);
  check('after a reload the map is still empty (autosave stored it), the plan is still listed', await page.evaluate(() => App.state.routes.length === 0 && App.state.markers.length === 0) && await page.$eval('#plansSelect', s => s.options.length === 1 && /План/.test(s.options[0].text)));
  await page.click('#planLoadBtn'); await page.waitForTimeout(400);
  check('and the plan can bring the data back', await page.evaluate(() => App.state.routes.length === 2 && App.state.markers.length === 2));
  check('no load-error banner / error note', (await page.$('#loadBanner')) === null && (await page.$('#errorNote')) === null);
  console.log('page errors:', errors.length ? errors : 'none');
  summary(); await browser.close();
})().catch(e => { console.error('CRASH', e); process.exit(1); });
