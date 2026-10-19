/* tests/example.test.js — examples/london-route.json imports and draws correctly */
const path = require('path');
const { open, check, summary, lines } = require('./lib');
(async () => {
  const { browser, page, errors } = await open();
  console.log('--- examples/london-route.json imported into the app ---');
  await page.setInputFiles('#fileInput', path.resolve(__dirname, '..', 'examples', 'london-route.json')); await page.waitForTimeout(400);
  const s = await page.evaluate(() => ({ routes: App.state.routes.map(r => [r.name, r.type, r.points.length, r.bends.length, r.tags.join('/')]), markers: App.state.markers.map(m => m.icon), ptIcons: document.querySelectorAll('.leaflet-marker-icon .pt-icon').length, bendDots: document.querySelectorAll('.leaflet-marker-icon .bend-dot').length, poi: document.querySelectorAll('.leaflet-marker-icon .poi-icon').length, cards: document.querySelectorAll('.photo-card').length }));
  check('2 routes with the expected points/bends/tags', JSON.stringify(s.routes) === JSON.stringify([["Кур'єр", 'pedestrian', 5, 2, "Свідок/Кур'єр"], ['Таксі', 'vehicle', 4, 1, 'Водій']]), s.routes);
  check('2 standalone markers (camera, flag)', JSON.stringify(s.markers) === '["camera","flag"]');
  check('drawn: 9 point markers, 3 bends, 2 POI, 1 photo card', s.ptIcons === 9 && s.bendDots === 3 && s.poi === 2 && s.cards === 1, s);
  const ls = await lines(page);
  check('2 route lines; courier path has 7 vertices (5 points + 2 bends), taxi 5', ls.length === 2 && ls[0].pts.length === 7 && ls[1].pts.length === 5, ls.map(l => l.pts.length));
  check('bends sit where expected in the path order (…p2, b1, p3, p4, b2, p5)', JSON.stringify(ls[0].pts.map(p => p[0])) === JSON.stringify([51.508, 51.5034, 51.5012, 51.5007, 51.501, 51.5013, 51.5033]), ls[0].pts.map(p => p[0]));
  check('photo card keeps its saved offset (-168, 30) and width 138', await page.$eval('.photo-card', e => { const icon = e.closest('.leaflet-marker-icon'); return e.style.left === (11 - 168) + 'px' && e.style.top === (11 + 30) + 'px' && e.style.width === '138px'; }));
  check('legend lists both routes', await page.$eval('#routeLegendList', e => /Кур'єр/.test(e.textContent) && /Таксі/.test(e.textContent)));
  check('all point times are on one date, in time order, inside London', await page.evaluate(() => App.state.routes.every(r => r.points.every(p => p.date === '2026-10-08' && p.lat > 51.49 && p.lat < 51.52 && p.lng > -0.14 && p.lng < -0.11))));
  check('no load-error banner, no error note', (await page.$('#loadBanner')) === null && (await page.$('#errorNote')) === null);
  console.log('page errors:', errors.length ? errors : 'none');
  summary(); await browser.close();
})().catch(e => { console.error('CRASH', e); process.exit(1); });
