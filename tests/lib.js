/* =============================================================================
   tests/lib.js — helpers shared by the test files.
   ============================================================================= */
const { chromium } = require('playwright');
const zlib = require('zlib');

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8123';

// Opens the app in a fresh headless browser. Only the local test server is reachable (no internet),
// and every uncaught page error is collected in `errors`.
async function open(base = BASE){
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1300, height: 850 } });
  const errors = [];
  const host = new URL(base).host;
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if(m.type() === 'error' && !/Failed to load resource|ERR_FAILED|net::/.test(m.text())) errors.push('CONSOLE: ' + m.text()); });
  await page.route(/^https?:/, r => (r.request().url().includes('//' + host) ? r.continue() : r.abort()));
  await page.goto(base + '/index.test.html');
  await page.waitForTimeout(300);
  return { browser, page, errors };
}

let passed = 0, failed = 0;
function check(name, ok, extra){
  ok ? passed++ : failed++;
  console.log((ok ? '  PASS ' : '  FAIL ') + name + (!ok && extra !== undefined ? '  -> ' + JSON.stringify(extra).slice(0, 400) : ''));
}
function summary(){
  console.log(`\n== ${passed} passed, ${failed} failed ==`);
  process.exitCode = failed ? 1 : 0;
}

// ---- driving the app --------------------------------------------------------------------------
async function createRoute(page, name, color){
  await page.fill('#routeName', name);
  if(color) await page.$eval('#routeColor', (el, c) => { el.value = c; }, color);
  await page.click('#createRouteBtn');
}
// A click on the map (fires the same event Leaflet would).
async function mapClick(page, lat, lng){ await page.evaluate(([a, b]) => window.__map.fire('click', { latlng: { lat: a, lng: b } }), [lat, lng]); }
// Add-point mode is on: click the map, fill the dialog, save.
async function addPointViaClick(page, lat, lng, time, extra = {}){
  await mapClick(page, lat, lng);
  await page.fill('#ptDate', '2026-10-08'); await page.fill('#ptTime', time);
  if(extra.note) await page.fill('#ptNote', extra.note);
  await page.click('#ptSave');
}
// The lines currently drawn on the map (without the invisible click-target twins).
const lines = page => page.evaluate(() => (window.__lines || []).filter(l => l.options.className !== 'route-hit-line')
  .map(l => ({ color: l.options.color, dashArray: l.options.dashArray, pts: l._lls.map(p => [+p.lat.toFixed(5), +p.lng.toFixed(5)]) })));
// A left-click ON a route line (the invisible hit line's click, bubbling to the map unless stopped).
async function lineClick(page, lat, lng, idx = 0){
  return page.evaluate(([a, b, i]) => { const hit = window.__lines.filter(l => l.options.className === 'route-hit-line')[i];
    if(!hit) return 'no-hit-line'; const e = { latlng: { lat: a, lng: b }, originalEvent: {} }; hit.fire('click', e);
    if(!e.originalEvent._stopped) window.__map.fire('click', { latlng: { lat: a, lng: b } }); return 'ok'; }, [lat, lng, idx]);
}
// A right-click on a route line (opens that route's menu) …
async function rightClick(page, lat, lng, x = 300, y = 220, idx = 0){
  return page.evaluate(([a, b, cx, cy, i]) => { window.__prevented = false;
    const hit = window.__lines.filter(l => l.options.className === 'route-hit-line')[i];
    const ev = { clientX: cx, clientY: cy, preventDefault(){ window.__prevented = true; } };
    hit.fire('contextmenu', { latlng: { lat: a, lng: b }, originalEvent: ev });
    if(!ev._stopped) window.__map.fire('contextmenu', { latlng: { lat: a, lng: b }, originalEvent: ev }); return !!ev._stopped; }, [lat, lng, x, y, idx]);
}
// … and on an empty spot of the map (opens the map's menu).
async function mapRightClick(page, x = 300, y = 220){
  return page.evaluate(([cx, cy]) => { window.__prevented = false; const ev = { clientX: cx, clientY: cy, preventDefault(){ window.__prevented = true; } };
    window.__map.fire('contextmenu', { latlng: { lat: 49.55, lng: 25.59 }, originalEvent: ev }); }, [x, y]);
}
// Moves a marker like a mouse drag would (the stand-in map has no real dragging).
async function dragMarker(page, selector, lat, lng, nth = 0){
  await page.evaluate(([sel, a, b, n]) => { const el = [...document.querySelectorAll('.leaflet-marker-icon')].filter(e => e.querySelector(sel))[n];
    const m = el.__marker; m.setLatLng([a, b]); m.fire('dragend'); }, [selector, lat, lng, nth]);
}
// Replaces all data at once (handy for setting up a scenario).
const P = (id, lat, lng, time, src = 'other', note = '', photo = null) => ({ id, lat, lng, date: '2026-10-08', time, sourceType: src, note, photo });
const R = (id, name, color, points, bends = [], extra = {}) => Object.assign({ id, name, type: 'pedestrian', color, tags: [], points, bends }, extra);
const load = (page, routes, markers = []) => page.evaluate(([rs, ms]) => { App.state.routes = App.utils.normalizeRoutes(rs); App.state.markers = App.utils.normalizeMarkers(ms);
  App.state.activeRouteId = null; App.state.mode = null; App.map.renderAll(); App.poi.renderAll(); App.sidebar.render(); }, [routes, markers]);

// ---- reading a .docx (a zip) without any library ------------------------------------------------
function unzip(buf){
  let e = buf.length - 22;
  while(e >= 0 && buf.readUInt32LE(e) !== 0x06054b50) e--;                       // end-of-central-directory record
  const count = buf.readUInt16LE(e + 10);
  let p = buf.readUInt32LE(e + 16);
  const files = {};
  for(let i = 0; i < count; i++){
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), nlen = buf.readUInt16LE(p + 28),
          xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.slice(start, start + csize);
    files[name] = method === 8 ? zlib.inflateRawSync(raw) : raw;
    p += 46 + nlen + xlen + clen;
  }
  return files;
}

module.exports = { open, check, summary, createRoute, mapClick, addPointViaClick, lines, lineClick, rightClick, mapRightClick, dragMarker, P, R, load, unzip, BASE };
