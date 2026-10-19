/* tests/return-trip.test.js — "↩ Дорога назад…": the dialog, validation, the copy (points reversed, labels, bends, dashed, new colour), undo */
const { open, check, summary, lines, rightClick, P, R, load } = require('./lib');
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const SRC = () => R('r1', "Кур'єр", '#e63946', [
  P('A', 49.55, 25.59, '10:00', 'camera', 'Старт'),
  P('B', 49.55, 25.592, '10:10', 'dashcam', '', PNG),            // no label -> shown as "Точка №2"; has a photo (must not be copied)
  P('C', 49.552, 25.594, '10:30', 'other', 'Фініш')
], [{ id: 'b1', lat: 49.5508, lng: 25.5905, afterPointId: 'A' }, { id: 'b2', lat: 49.5508, lng: 25.5915, afterPointId: 'A' }], { tags: ['Свідок'], type: 'vehicle' });
const dlg = page => page.evaluate(() => ({
  open: document.getElementById('returnModalOverlay').style.display === 'flex',
  title: document.getElementById('returnModalTitle').textContent, name: document.getElementById('returnName').value,
  color: document.getElementById('returnColor').value, dashed: document.getElementById('returnDashed').checked,
  sd: document.getElementById('returnStartDate').value, st: document.getElementById('returnStartTime').value,
  error: getComputedStyle(document.getElementById('returnError')).display === 'none' ? '' : document.getElementById('returnError').textContent,
  rows: [...document.querySelectorAll('#returnList .return-row:not(.return-head)')].map(r => ({ label: r.querySelector('.return-label span').textContent.trim(), small: r.querySelector('small').textContent,
    date: r.querySelectorAll('input')[0].value, time: r.querySelectorAll('input')[1].value, bad: r.querySelectorAll('input.invalid').length }))
}));
const setRow = (page, i, date, time) => page.evaluate(([i, d, t]) => { const r = document.querySelectorAll('#returnList .return-row:not(.return-head)')[i].querySelectorAll('input');
  if (d !== null) { r[0].value = d; r[0].dispatchEvent(new Event('input', { bubbles: true })); } if (t !== null) { r[1].value = t; r[1].dispatchEvent(new Event('input', { bubbles: true })); } }, [i, date, time]);
const openDialog = async page => { await rightClick(page, 49.551, 25.593); await page.click('.ctx-item:has-text("Дорога назад")'); };

(async () => {
  const { browser, page, errors } = await open();
  await page.evaluate(() => { App.history.config.burstMs = 0; });
  console.log('--- Дорога назад ---');
  await load(page, [SRC()]);
  await rightClick(page, 49.551, 25.593);
  check('menu entry "↩ Дорога назад…" is there', await page.$eval('.ctx-menu', m => [...m.querySelectorAll('.ctx-item')].some(b => b.textContent.trim() === '↩Дорога назад…')));
  await page.click('.ctx-item:has-text("Дорога назад")');
  let d = await dlg(page);
  check('dialog opens for the route; name suggests "(назад)"', d.open && d.title.includes("«Кур'єр»") && d.name === "Кур'єр (назад)", d);
  check('colour differs from the original; dashed is on by default', d.color !== '#e63946' && d.color === '#2a9d8f' && d.dashed === true, d.color);
  check('start suggestion = when the original ended', d.sd === '2026-10-08' && d.st === '10:30', [d.sd, d.st]);
  check('rows: every point, last one first, with labels (or "Точка №")', JSON.stringify(d.rows.map(r => r.label)) === JSON.stringify(['📍 Фініш', '🎥 Точка №2', '📹 Старт']), d.rows.map(r => r.label));
  check('rows show what the original time was; date/time start empty', d.rows[0].small.includes('було 08.10.2026 10:30') && d.rows.every(r => r.date === '' && r.time === ''), d.rows[0].small);

  // validation
  await page.click('#returnCreate'); d = await dlg(page);
  check('empty dates/times: not created, error shown, 6 fields marked', d.open && /дату й час для кожної точки/.test(d.error) && d.rows.reduce((n, r) => n + r.bad, 0) === 6 && await page.evaluate(() => App.state.routes.length === 1), d.error);
  await page.fill('#returnStartDate', '2026-10-08'); await page.fill('#returnStartTime', '11:00'); await page.click('#returnFillBtn'); d = await dlg(page);
  check('"Заповнити" keeps the original gaps: 11:00, 11:20, 11:30', JSON.stringify(d.rows.map(r => r.time)) === '["11:00","11:20","11:30"]' && d.rows.every(r => r.date === '2026-10-08') && d.error === '', d.rows.map(r => r.time));
  await setRow(page, 2, null, '11:10'); await page.click('#returnCreate'); d = await dlg(page);
  check('times going backwards are refused (they would flip the direction)', d.open && /точка 3 раніше за точку 2/.test(d.error) && await page.evaluate(() => App.state.routes.length === 1), d.error);
  await setRow(page, 2, null, '11:30');
  await page.fill('#returnName', ''); await page.click('#returnCreate'); d = await dlg(page);
  check('empty name is refused', d.open && /назву/.test(d.error));
  await page.fill('#returnName', "Кур'єр: назад"); await page.$eval('#returnColor', e => { e.value = '#7b2cbf'; });

  // create
  await page.click('#returnCreate');
  const r = await page.evaluate(() => { const [src, ret] = App.state.routes; const sp = App.utils.sortedPoints(ret);
    return { n: App.state.routes.length, closed: document.getElementById('returnModalOverlay').style.display !== 'flex', name: ret.name, type: ret.type, tags: ret.tags, color: ret.color, dashed: ret.dashed,
      retNotes: sp.map(p => p.note), retTimes: sp.map(p => p.time), retDates: sp.map(p => p.date), retSrc: sp.map(p => p.sourceType), retCoords: sp.map(p => [p.lat, p.lng]), retPhotos: sp.map(p => p.photo),
      retBends: ret.bends.map(b => [b.lat, b.lng, b.afterPointId === sp[1].id]), srcIds: src.points.map(p => p.id), retIds: ret.points.map(p => p.id),
      srcTimes: src.points.map(p => p.time), srcBends: src.bends.length, srcPhoto: src.points[1].photo, srcDashed: src.dashed };
  });
  check('dialog closed; new route added right after the original', r.n === 2 && r.closed && r.name === "Кур'єр: назад");
  check('type and tags copied, chosen colour used, dashed', r.type === 'vehicle' && JSON.stringify(r.tags) === '["Свідок"]' && r.color === '#7b2cbf' && r.dashed === true, r);
  check('points reversed: C, B, A — labels and sources kept', JSON.stringify(r.retNotes) === '["Фініш","","Старт"]' && JSON.stringify(r.retSrc) === '["other","dashcam","camera"]' && JSON.stringify(r.retCoords) === JSON.stringify([[49.552, 25.594], [49.55, 25.592], [49.55, 25.59]]), r);
  check('the typed dates and times are used', JSON.stringify(r.retTimes) === '["11:00","11:20","11:30"]' && r.retDates.every(x => x === '2026-10-08'));
  check('photos are NOT copied (and stay on the original)', r.retPhotos.every(p => p === null) && r.srcPhoto === PNG);
  check('the original is untouched', JSON.stringify(r.srcIds) === '["A","B","C"]' && JSON.stringify(r.srcTimes) === '["10:00","10:10","10:30"]' && r.srcBends === 2 && !r.srcDashed);
  check('bends copied in reverse order, hanging off the point they now follow', JSON.stringify(r.retBends) === '[[49.5508,25.5915,true],[49.5508,25.5905,true]]', r.retBends);
  check('all ids unique across the whole data', await page.evaluate(() => { const ids = App.state.routes.flatMap(r => [r.id, ...r.points.map(p => p.id), ...r.bends.map(b => b.id)]); return new Set(ids).size === ids.length; }));
  const ls = await lines(page);
  check('two lines on the map; the new one is exactly the old one backwards', ls.length === 2 && JSON.stringify(ls[1].pts) === JSON.stringify([...ls[0].pts].reverse()), ls.map(l => l.pts.length));
  check('only the new line is dashed', !ls[0].dashArray && !!ls[1].dashArray, ls.map(l => l.dashArray));
  check('both routes in the list and the legend', await page.evaluate(() => document.querySelectorAll('.route-item').length === 2 && /назад/.test(document.getElementById('routeLegendList').textContent)));
  // undo / redo
  await page.keyboard.press('Control+z');
  check('Ctrl+Z removes the whole new route in one step', await page.evaluate(() => App.state.routes.length === 1) && (await lines(page)).length === 1);
  await page.keyboard.press('Control+y');
  check('Ctrl+Y brings it back, still dashed', await page.evaluate(() => App.state.routes.length === 2 && App.state.routes[1].dashed === true) && (await lines(page)).length === 2);

  // inserted right after the ORIGINAL, not at the end
  await load(page, [SRC(), R('r2', 'Інший', '#0a0', [P('X', 49.56, 25.6, '09:00'), P('Y', 49.561, 25.601, '09:10')])]);
  await openDialog(page); await page.fill('#returnStartDate', '2026-10-09'); await page.fill('#returnStartTime', '08:00'); await page.click('#returnFillBtn'); await page.click('#returnCreate');
  check('with several routes the copy goes right after the original', await page.evaluate(() => App.state.routes.map(r => r.name).join('|') === "Кур'єр|Кур'єр (назад)|Інший"));
  // colour choice when every palette colour is taken
  const PAL = ['#2a9d8f', '#f4a261', '#6a4c93', '#1982c4', '#8ac926', '#ff595e', '#e9c46a', '#264653'];
  await load(page, [SRC(), ...PAL.map((c, i) => R('p' + i, 'К' + i, c, [P('p' + i + 'a', 49.56, 25.6, '09:00'), P('p' + i + 'b', 49.561, 25.601, '09:10')]))]);
  await openDialog(page); d = await dlg(page);
  check('all palette colours used: the opposite of the original colour is offered', d.color === '#19c6b9' && !PAL.includes(d.color), d.color);
  // cancel / Esc
  await page.click('#returnCancel');
  check('Скасувати closes without creating', !(await dlg(page)).open && await page.evaluate(() => App.state.routes.length === 9));
  await openDialog(page); await page.keyboard.press('Escape');
  check('Esc closes the dialog (and only the dialog)', !(await dlg(page)).open && await page.evaluate(() => App.state.routes.length === 9));
  // Ctrl+Z is ignored while the dialog is open
  await load(page, [SRC()]); const depth0 = await page.evaluate(() => App.history.depth().undo);
  await openDialog(page); await page.keyboard.press('Control+z');
  check('Ctrl+Z does nothing while the dialog is open', await page.evaluate(() => App.history.depth().undo) === depth0 && (await dlg(page)).open);
  await page.click('#returnCancel');
  // the Word report draws dashed routes dashed
  await load(page, [SRC()]); await openDialog(page); await page.fill('#returnStartTime', '11:00'); await page.click('#returnFillBtn'); await page.click('#returnCreate');
  await page.evaluate(() => { window.__dash = []; const o = CanvasRenderingContext2D.prototype.setLineDash; CanvasRenderingContext2D.prototype.setLineDash = function (a) { window.__dash.push(a.length); return o.call(this, a); }; });
  await page.evaluate(() => App.report.renderMap(App.state.routes, []));
  check('report map snapshot draws the dashed route with a dash pattern', await page.evaluate(() => window.__dash.includes(2)));
  check('no load-error banner / error note', (await page.$('#loadBanner')) === null && (await page.$('#errorNote')) === null);
  console.log('page errors:', errors.length ? errors : 'none');
  summary(); await browser.close();
})().catch(e => { console.error('CRASH', e); process.exit(1); });
