/* tests/regression.test.js — broad regression of everyday features: routes, tags, points, drag, colours, labels, legend, bulk import, POI, photo cards, plans, exports */
const fs = require('fs');
const { open, check, summary, createRoute, mapClick, addPointViaClick, lines, lineClick } = require('./lib');
const markerEls = page => page.$$('.leaflet-marker-icon');
const makeImg = (page, w, h, type = 'image/png') => page.evaluate(([w, h, t]) => {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, w, h); g.addColorStop(0, '#f00'); g.addColorStop(1, '#00f'); x.fillStyle = g; x.fillRect(0, 0, w, h);
  for (let i = 0; i < 4000; i++) { x.fillStyle = `hsl(${Math.random() * 360},80%,50%)`; x.fillRect(Math.random() * w, Math.random() * h, 8, 8); }
  return c.toDataURL(t); }, [w, h, type]);
(async () => {
  const { browser, page, errors } = await open();
  page.on('dialog', d => d.accept(d.type() === 'prompt' ? (d.defaultValue() || 'План X') : undefined));
  await page.evaluate(() => { window.__printed = 0; window.print = () => { window.__printed++; }; });

  console.log('\n[1] Routes, tags, points, edit');
  await createRoute(page, 'Кур\'єр-1', '#ff0000');
  await page.click('[data-quicktag="Свідок"]').catch(() => {}); // chips only exist before creation; tags via edit below
  await addPointViaClick(page, 49.5500, 25.5900, '10:00', { note: 'старт' });
  await addPointViaClick(page, 49.5500, 25.5920, '10:10');
  await addPointViaClick(page, 49.5500, 25.5940, '10:20');
  check('3 points', await page.evaluate(() => App.state.routes[0].points.length === 3));
  await page.evaluate(() => { const r = App.state.routes[0]; r.tags = ['Свідок']; App.sidebar.render(); });
  check('tag badge rendered', await page.$eval('.tag-badge', e => e.textContent === 'Свідок'));
  const firstId = await page.evaluate(() => App.state.routes[0].points[0].id);
  await page.evaluate(([rid, pid]) => App.pointModal.openForEdit(rid, pid), [await page.evaluate(() => App.state.routes[0].id), firstId]);
  await page.fill('#ptNote', 'змінено'); await page.selectOption('#ptSourceType', 'camera'); await page.click('#ptSave');
  check('edit keeps id, updates fields', await page.evaluate(id => { const p = App.state.routes[0].points.find(p => p.id === id); return p && p.note === 'змінено' && p.sourceType === 'camera' && App.state.routes[0].points.length === 3; }, firstId));
  // coordinates by typing / pasting text
  await page.evaluate(() => App.pointModal.openForAdd(null));
  await page.fill('#ptPasteCoords', '49.5510, 25.5960'); 
  check('paste-coords fills lat/lng', await page.evaluate(() => document.getElementById('ptLat').value === '49.551000' && document.getElementById('ptLng').value === '25.596000'));
  await page.click('#ptCancel');

  console.log('\n[2] Bends (existing route), drag, colour, visibility');
  await page.click('#stopAddBtn');
  await lineClick(page, 49.5500, 25.5910); await lineClick(page, 49.5500, 25.5930);
  check('2 bends drawn in path (click on the line)', (await lines(page))[0].pts.length === 5);
  const bendEl = (await page.$$('.leaflet-marker-icon')).find(async () => true);
  await page.evaluate(() => { const el = [...document.querySelectorAll('.leaflet-marker-icon')].find(e => e.querySelector('.bend-dot')); const m = el.__marker; m.setLatLng([49.5512, 25.5911]); m.fire('dragend'); });
  check('bend drag updates path', (await lines(page))[0].pts[1][0] === 49.5512);
  await page.evaluate(() => { const el = [...document.querySelectorAll('.leaflet-marker-icon')].find(e => e.querySelector('.pt-icon')); const m = el.__marker; m.setLatLng([49.5503, 25.5903]); m.fire('dragend'); });
  check('point drag updates stored coords', await page.evaluate(() => App.state.routes[0].points.some(p => Math.abs(p.lat - 49.5503) < 1e-6)));
  await page.$eval('[data-route-color]', el => { el.value = '#00aa00'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  check('colour change recolours the line', (await lines(page))[0].color === '#00aa00');
  await page.click('[data-vis]'); check('hide route removes line', (await lines(page)).length === 0);
  await page.click('[data-add]'); check('➕ on a hidden route re-shows it', (await lines(page)).length === 1);
  await page.click('#stopAddBtn');

  console.log('\n[3] Labels, legend, collapse');
  await page.check('#showLabelsChk');
  check('labels bound on markers', await page.evaluate(() => [...document.querySelectorAll('.leaflet-marker-icon')].some(e => e.__marker._tip)));
  check('legend lists the route', await page.$eval('#routeLegendList', e => e.textContent.includes('Кур\'єр-1')));
  await page.click('#collapseBtn'); check('sidebar collapsed', await page.$eval('#sidebar', e => e.classList.contains('collapsed')));
  await page.click('#railExpandBtn'); check('sidebar expanded', await page.$eval('#sidebar', e => !e.classList.contains('collapsed')));
  await page.click('#legendCollapseBtn'); check('legend collapses to icon', await page.$eval('#legendFab', e => getComputedStyle(e).display !== 'none'));
  await page.click('#legendFab');

  console.log('\n[4] Bulk import');
  await page.fill('#bulkImportText', 'Маршрут\tТип\tДата\tЧас\tШирота\tДовгота\tДжерело\tПримітка\nАвто-7\tАвто\t2026-10-08\t11:00\t49.56\t25.60\tВідеореєстратор\tрух\nАвто-7\tАвто\t2026-10-08\t11:05\t49.561\t25.601\t\t\nАвто-7\tАвто\t2026-10-08\t11:06\tбрак\tбрак\t\t');
  await page.click('#bulkImportBtn');
  check('TSV: 2 points imported, bad row skipped, vehicle type', await page.evaluate(() => { const r = App.state.routes.find(r => r.name === 'Авто-7'); return r && r.points.length === 2 && r.type === 'vehicle' && r.points[0].sourceType === 'dashcam'; }));
  await page.fill('#bulkImportText', 'lat,lng,time\n49.57,25.61,12:00\n49.571,25.611,12:05');
  await page.click('#bulkImportBtn');
  check('CSV without route column → one new route', await page.evaluate(() => App.state.routes.some(r => /Імпортований/.test(r.name) && r.points.length === 2)));

  console.log('\n[5] POI markers');
  await page.click('#poiAddBtn'); await mapClick(page, 49.5530, 25.5950);
  await page.selectOption('#poiType', 'hazard'); await page.fill('#poiLabel', 'Знахідка'); await page.click('#poiSave');
  check('POI saved', await page.evaluate(() => App.state.markers.length === 1 && App.state.markers[0].icon === 'hazard'));
  await page.check('#showMarkerLabelsChk');
  await page.evaluate(() => { const el = [...document.querySelectorAll('.leaflet-marker-icon')].find(e => e.querySelector('.poi-icon')); const m = el.__marker; m.setLatLng([49.5531, 25.5951]); m.fire('dragend'); });
  check('POI drag updates coords', await page.evaluate(() => Math.abs(App.state.markers[0].lat - 49.5531) < 1e-6));

  console.log('\n[6] Photo cards');
  const route0 = await page.evaluate(() => App.state.routes[0].id);
  const pt0 = await page.evaluate(() => App.state.routes[0].points.sort((a, b) => a.time.localeCompare(b.time))[1].id);
  // 6a attach through the modal file picker (big PNG -> compressed JPEG)
  const big = await makeImg(page, 2400, 1800);
  await page.evaluate(([r, p]) => App.pointModal.openForEdit(r, p), [route0, pt0]);
  await page.setInputFiles('#ptPhotoFile', { name: 'big.png', mimeType: 'image/png', buffer: Buffer.from(big.split(',')[1], 'base64') });
  await page.waitForFunction(() => document.getElementById('ptPhotoPreview').style.display === 'block');
  const dims = await page.$eval('#ptPhotoPreview', async img => { await img.decode(); return [img.naturalWidth, img.naturalHeight, img.src.slice(0, 20)]; });
  check('big PNG downscaled to ≤1280 and re-encoded as JPEG', dims[0] <= 1280 && dims[2].startsWith('data:image/jpeg'), dims);
  await page.click('#ptSave');
  check('card rendered inside point marker', await page.evaluate(() => document.querySelectorAll('.leaflet-marker-icon .photo-card').length === 1));
  // 6b pasted image anywhere in the modal
  const small = await makeImg(page, 200, 150);
  await page.evaluate(([r, p]) => App.pointModal.openForEdit(r, p), [route0, pt0]);
  await page.evaluate(async d => { const f = new File([await (await fetch(d)).blob()], 'p.png', { type: 'image/png' }); const dt = new DataTransfer(); dt.items.add(f); document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); }, small);
  await page.waitForFunction(() => document.getElementById('ptPhotoPreview').style.display === 'block');
  check('Ctrl+V image works anywhere in modal', true);
  await page.click('#ptSave');
  await page.waitForTimeout(150);
  // 6c geometry: card position & leader line
  const geo = () => page.evaluate(() => { const c = document.querySelector('.photo-card'); const icon = c.closest('.leaflet-marker-icon'); const line = icon.querySelector('.pc-leader line');
    const cb = c.getBoundingClientRect(), ib = icon.getBoundingClientRect();
    return { w: cb.width, h: cb.height, cx: cb.x + cb.width / 2 - (ib.x + 11), cy: cb.y + cb.height / 2 - (ib.y + 11), x2: +line.getAttribute('x2'), y2: +line.getAttribute('y2'), imgW: c.querySelector('img').getBoundingClientRect().width, st: App.state.routes.find(r => r.id === c.dataset.route).points.find(p => p.id === c.dataset.point) }; });
  let g = await geo();
  check('leader line ends at card centre', Math.abs(g.x2 - g.cx) < 1.5 && Math.abs(g.y2 - g.cy) < 1.5, g);
  check('image fills card width (Leaflet img rule overridden)', g.imgW > g.w - 12 && g.imgW <= g.w, g);
  // 6d drag the card
  const latBefore = g.st.lat, popupsBefore = await page.evaluate(() => !!window.__map._popupEl);
  const card = await page.$('.photo-card'); let box = await card.boundingBox();
  await page.mouse.move(box.x + 30, box.y + 30); await page.mouse.down(); await page.mouse.move(box.x + 30 + 70, box.y + 30 + 45, { steps: 6 }); await page.mouse.up();
  g = await geo();
  check('drag: offset saved (+70,+45)', g.st.photoCard.dx === 28 + 70 && g.st.photoCard.dy === -130 + 45, g.st.photoCard);
  check('drag: leader line followed', Math.abs(g.x2 - g.cx) < 1.5 && Math.abs(g.y2 - g.cy) < 1.5, g);
  check('drag: point did not move, no popup, mode intact', g.st.lat === latBefore && !(await page.evaluate(() => !!window.__map._popupEl)) && !popupsBefore);
  // 6e resize via grip
  await page.hover('.photo-card'); const grip = await (await page.$('.pc-grip')).boundingBox(); const w0 = g.w;
  await page.mouse.move(grip.x + 8, grip.y + 8); await page.mouse.down(); await page.mouse.move(grip.x + 8 + 60, grip.y + 8 + 10, { steps: 5 }); await page.mouse.up();
  g = await geo();
  check('resize: width +60, aspect kept', g.st.photoCard.w === 200 && Math.abs(g.w - (w0 + 60)) < 1.5, [g.st.photoCard.w, g.w]);
  check('resize: leader line still on card centre', Math.abs(g.x2 - g.cx) < 1.5 && Math.abs(g.y2 - g.cy) < 1.5, g);
  await page.hover('.photo-card'); const grip2 = await (await page.$('.pc-grip')).boundingBox();
  await page.mouse.move(grip2.x + 8, grip2.y + 8); await page.mouse.down(); await page.mouse.move(grip2.x - 400, grip2.y, { steps: 5 }); await page.mouse.up();
  check('resize: clamped to minimum 70px', (await geo()).st.photoCard.w === 70);
  // 6f persistence across reload (IndexedDB autosave)
  await page.waitForTimeout(900);
  const saved = (await geo()).st.photoCard;
  await page.reload(); await page.waitForTimeout(600);
  const restored = await page.evaluate(() => { const c = document.querySelector('.photo-card'); return c ? App.state.routes.flatMap(r => r.points).find(p => p.id === c.dataset.point).photoCard : null; });
  check('reload restores routes + card layout from IndexedDB', restored && restored.dx === saved.dx && restored.dy === saved.dy && restored.w === saved.w, [saved, restored]);
  check('reload restores POI + bends', await page.evaluate(() => App.state.markers.length === 1 && App.state.routes[0].bends.length === 2));
  // 6g close / reopen / global toggle
  await page.hover('.photo-card'); await page.click('.pc-close');
  check('✕ hides the card', await page.evaluate(() => document.querySelectorAll('.photo-card').length === 0));
  await page.evaluate(() => { [...document.querySelectorAll('.leaflet-marker-icon')].find(e => e.querySelector('.pt-icon') && e.__marker._popupHtml.includes('data-toggle-photo')).click(); });
  check('popup offers "показати фото"', await page.evaluate(() => /показати фото/.test(window.__map._popupEl.textContent)));
  await page.evaluate(() => window.__map._popupEl.querySelector('[data-toggle-photo]').click());
  check('popup link re-shows the card', await page.evaluate(() => document.querySelectorAll('.photo-card').length === 1));
  await page.uncheck('#showPhotosChk'); check('global toggle off hides cards', await page.evaluate(() => document.querySelectorAll('.photo-card').length === 0));
  await page.check('#showPhotosChk'); check('global toggle on shows cards', await page.evaluate(() => document.querySelectorAll('.photo-card').length === 1));
  // 6h non-image link falls back to a plain link
  await page.evaluate(() => { const r = App.state.routes[0]; const p = r.points.find(p => !p.photo); p.photo = '/missing-file.pdf'; App.map.renderRoute(r); });
  await page.waitForSelector('.pc-fallback', { timeout: 3000 }).then(() => check('broken/non-image link → "відкрити вкладення"', true)).catch(() => check('broken/non-image link → "відкрити вкладення"', false));

  console.log('\n[7] Plans, export, print');
  await page.click('#planSaveBtn'); await page.waitForTimeout(300);
  check('plan saved & listed', await page.$eval('#plansSelect', s => s.options.length === 1 && /План/.test(s.options[0].text)));
  await page.evaluate(() => { App.state.routes = []; App.sidebar.render(); App.map.renderAll(); });
  await page.click('#planLoadBtn'); await page.waitForTimeout(300);
  check('plan loads data back', await page.evaluate(() => App.state.routes.length >= 3));
  await page.click('#planDeleteBtn'); await page.waitForTimeout(300);
  check('plan deleted', await page.$eval('#plansSelect', s => !s.value));
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#exportBtn')]);
  const json = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
  check('JSON export has routes, markers, bends, photoCard', json.routes.length >= 3 && json.markers.length === 1 && json.routes[0].bends.length === 2 && json.routes.flatMap(r => r.points).some(p => p.photoCard));
  const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('#csvExportBtn')]);
  const csv = fs.readFileSync(await dl2.path(), 'utf8');
  check('CSV export header + rows', csv.includes('Маршрут,Тип,Теги,Дата') && csv.split('\r\n').length > 5);
  await page.evaluate(() => { window.__printed = 0; window.print = () => { window.__printed++; }; }); // reload reset the stub
  await page.click('#printBtn'); await page.waitForTimeout(300);
  check('print builds legend & calls print', await page.$eval('#printLegend', e => e.textContent.includes('Кур\'єр-1')) && await page.evaluate(() => window.__printed === 1));
  // import round-trip
  await page.evaluate(() => { App.state.routes = []; App.state.markers = []; });
  await page.setInputFiles('#fileInput', await dl.path());
  await page.waitForTimeout(300);
  check('JSON import restores everything', await page.evaluate(() => App.state.routes.length >= 3 && App.state.markers.length === 1));

  check('no load-error banner on a healthy deploy', await page.$("#loadBanner") === null);
  console.log('\npage errors:', errors.length ? errors : 'none');
  summary(); await browser.close();
})().catch(e => { console.error('TEST CRASH', e); process.exit(1); });
