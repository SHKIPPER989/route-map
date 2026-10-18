/* =============================================================================
   report.js
   "📝 Звіт у Word" — builds a .docx report for attaching to a case file:
     1. a map snapshot with every shown route (line, direction arrows, bends,
        numbered points) and every POI marker;
     2. a legend table of the routes;
     3. one table of points per route (№, date, time, coordinates, source, note);
     4. a table of POI markers;
     5. photo/scan thumbnails, each captioned with its route, point № and time.
   Point numbers on the map match the "№" column in the tables (numbered per
   route, in time order); POI markers are numbered М1, М2, ...
   How it works (all in the browser, no server):
     - the map picture is drawn by renderMap() straight onto a <canvas> using
       OpenStreetMap tiles — independent of what the on-screen map is showing,
       it always frames all shown routes;
     - the Word file is assembled with the `docx` library, loaded from a CDN
       only when the button is first pressed (so the page itself stays light).
   Needs internet for the library and the map background; without the tiles the
   report is still produced, with a plain grey map background.
   ============================================================================= */
//const App = window.App || (window.App = {});

App.report = {};

(function(){
  const { constants, state, utils } = App;

  const config = {
    docxUrls: [
      'https://cdn.jsdelivr.net/npm/docx@9.6.1/dist/index.iife.js',
      'https://unpkg.com/docx@9.6.1/dist/index.iife.js'
    ],
    tileUrl: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    mapWidth: 1200,
    mapHeight: 760
  };
  const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

  // ---- small helpers ------------------------------------------------------------
  const typeLabel = r => r.type === 'vehicle' ? 'Авто' : 'Пішохід';
  const sourceLabel = p => (constants.SOURCE_TYPES[p.sourceType] || constants.SOURCE_TYPES.other).label;
  const fmtDate = s => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); return m ? `${m[3]}.${m[2]}.${m[1]}` : (s || ''); };
  const fmtCoord = v => Number(v).toFixed(6);
  const hex = c => String(c || '#4fa3ff').replace('#', '').toUpperCase();

  function loadImage(src, cors){
    return new Promise((resolve, reject) => {
      const img = new Image();
      if(cors) img.crossOrigin = 'anonymous';
      const timer = setTimeout(() => reject(new Error('timeout')), 10000);
      img.onload = () => { clearTimeout(timer); resolve(img); };
      img.onerror = () => { clearTimeout(timer); reject(new Error('image failed')); };
      img.src = src;
    });
  }

  function dataUrlToBytes(dataUrl){
    const bin = atob(dataUrl.split(',')[1]);
    const bytes = new Uint8Array(bin.length);
    for(let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  // ---- loading the docx library (only when first needed) -------------------------
  function loadScript(url){
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = url;
      s.onload = resolve;
      s.onerror = () => { s.remove(); reject(new Error('cannot load ' + url)); };
      document.head.appendChild(s);
    });
  }
  let docxPromise = null;
  function loadDocx(){
    if(window.docx && window.docx.Packer) return Promise.resolve(window.docx);
    if(!docxPromise){
      docxPromise = (async () => {
        for(const url of config.docxUrls){
          try{ await loadScript(url); if(window.docx && window.docx.Packer) return window.docx; }catch(e){ /* try the next CDN */ }
        }
        throw new Error('не вдалося завантажити бібліотеку для створення Word-файлів — потрібен доступ до інтернету');
      })().catch(err => { docxPromise = null; throw err; });
    }
    return docxPromise;
  }

  // ---- map snapshot (canvas) --------------------------------------------------------
  // Web-Mercator: lat/lng -> pixel in the "whole world" image at zoom z (256px tiles).
  function worldPx(lat, lng, z){
    const scale = 256 * Math.pow(2, z);
    const sin = Math.sin(lat * Math.PI / 180);
    return { x: (lng + 180) / 360 * scale, y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale };
  }

  // Black or white text, whichever reads better on this colour.
  function textOn(color){
    const m = /^#?([0-9a-f]{6})$/i.exec(color || '');
    if(!m) return '#fff';
    const n = parseInt(m[1], 16);
    return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) > 160 ? '#000' : '#fff';
  }

  function tracePath(ctx, nodes){
    ctx.beginPath();
    nodes.forEach((n, i) => i ? ctx.lineTo(n.x, n.y) : ctx.moveTo(n.x, n.y));
  }

  // Direction arrows every ~90px along the line, like on the live map.
  function drawArrows(ctx, nodes, color){
    let travelled = 0, next = 50;
    for(let i = 0; i < nodes.length - 1; i++){
      const a = nodes[i], b = nodes[i + 1];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if(!len) continue;
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      while(next <= travelled + len){
        const t = (next - travelled) / len;
        ctx.save();
        ctx.translate(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
        ctx.rotate(ang);
        ctx.beginPath(); ctx.moveTo(8, 0); ctx.lineTo(-6, -6); ctx.lineTo(-6, 6); ctx.closePath();
        ctx.fillStyle = color; ctx.fill();
        ctx.lineWidth = 1.8; ctx.strokeStyle = '#fff'; ctx.stroke();
        ctx.restore();
        next += 90;
      }
      travelled += len;
    }
  }

  function roundRect(ctx, x, y, w, h, r){
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  async function renderMap(routes, pois){
    const W = config.mapWidth, H = config.mapHeight, PAD = 70;

    // Everything that has to be visible: points + bends of the shown routes, and all POI markers.
    const coords = [];
    routes.forEach(r => utils.buildNodes(r).forEach(n => coords.push([n.lat, n.lng])));
    pois.forEach(m => coords.push([m.lat, m.lng]));

    // Largest zoom at which all of it fits the picture (with a margin).
    let z = 17;
    if(coords.length > 1){
      for(z = 18; z > 2; z--){
        const ps = coords.map(c => worldPx(c[0], c[1], z));
        const xs = ps.map(p => p.x), ys = ps.map(p => p.y);
        if(Math.max(...xs) - Math.min(...xs) <= W - 2 * PAD && Math.max(...ys) - Math.min(...ys) <= H - 2 * PAD) break;
      }
      z = Math.min(z, 17);
    }
    const ps = coords.map(c => worldPx(c[0], c[1], z));
    const xs = ps.map(p => p.x), ys = ps.map(p => p.y);
    const ox = (Math.min(...xs) + Math.max(...xs)) / 2 - W / 2;   // top-left corner of the picture, in world pixels
    const oy = (Math.min(...ys) + Math.max(...ys)) / 2 - H / 2;
    const P = (lat, lng) => { const p = worldPx(lat, lng, z); return { x: p.x - ox, y: p.y - oy }; };

    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#e9e9e9'; ctx.fillRect(0, 0, W, H);

    // Background tiles.
    const n = Math.pow(2, z), tiles = [];
    for(let ty = Math.floor(oy / 256); ty <= Math.floor((oy + H) / 256); ty++){
      for(let tx = Math.floor(ox / 256); tx <= Math.floor((ox + W) / 256); tx++){
        if(ty >= 0 && ty < n) tiles.push({ tx, ty });
      }
    }
    let loaded = 0;
    await Promise.all(tiles.map(t => {
      const url = config.tileUrl.replace('{z}', z).replace('{x}', ((t.tx % n) + n) % n).replace('{y}', t.ty);
      return loadImage(url, true).then(img => { ctx.drawImage(img, t.tx * 256 - ox, t.ty * 256 - oy); loaded++; }).catch(() => {});
    }));
    if(!loaded){
      ctx.strokeStyle = '#d2d2d2'; ctx.lineWidth = 1;
      for(let x = 0; x < W; x += 100){ ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
      for(let y = 0; y < H; y += 100){ ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    }

    // Routes: line (white outline + colour), arrows.
    const nodesByRoute = routes.map(r => utils.buildNodes(r).map(nd => Object.assign({}, nd, P(nd.lat, nd.lng))));
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    routes.forEach((r, i) => {
      const nodes = nodesByRoute[i];
      if(nodes.length < 2) return;
      tracePath(ctx, nodes); ctx.strokeStyle = '#fff'; ctx.lineWidth = 8; ctx.stroke();
      tracePath(ctx, nodes); ctx.strokeStyle = r.color; ctx.lineWidth = 4.5;
      ctx.setLineDash(r.dashed ? [14, 10] : []); ctx.stroke(); ctx.setLineDash([]);   // dashed = a route that repeats another's path
      drawArrows(ctx, nodes, r.color);
    });
    // Bends: small dots.
    routes.forEach((r, i) => nodesByRoute[i].filter(nd => nd.kind === 'bend').forEach(nd => {
      ctx.beginPath(); ctx.arc(nd.x, nd.y, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = r.color; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = '#fff'; ctx.stroke();
    }));
    // Points: numbered circles (the number is the "№" in the tables).
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    routes.forEach((r, i) => nodesByRoute[i].filter(nd => nd.kind === 'point').forEach((nd, k) => {
      ctx.beginPath(); ctx.arc(nd.x, nd.y, 11, 0, Math.PI * 2);
      ctx.fillStyle = r.color; ctx.fill(); ctx.lineWidth = 2.5; ctx.strokeStyle = '#fff'; ctx.stroke();
      ctx.fillStyle = textOn(r.color); ctx.font = 'bold 12px Arial, sans-serif';
      ctx.fillText(String(k + 1), nd.x, nd.y + 0.5);
    }));
    // POI markers: icon in a rounded square + "М1" badge.
    pois.forEach((m, i) => {
      const { x, y } = P(m.lat, m.lng);
      const t = constants.MARKER_ICON_TYPES[m.icon] || constants.MARKER_ICON_TYPES.other;
      roundRect(ctx, x - 13, y - 13, 26, 26, 5); ctx.fillStyle = '#fff'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = '#333'; ctx.stroke();
      ctx.fillStyle = '#000'; ctx.font = '16px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';
      ctx.fillText(t.icon, x, y + 1);
      const label = 'М' + (i + 1);
      ctx.font = 'bold 11px Arial, sans-serif';
      const w = ctx.measureText(label).width + 8;
      roundRect(ctx, x - w / 2, y + 16, w, 15, 3); ctx.fillStyle = '#fff'; ctx.fill(); ctx.lineWidth = 1; ctx.strokeStyle = '#333'; ctx.stroke();
      ctx.fillStyle = '#000'; ctx.fillText(label, x, y + 24);
    });

    // Attribution (required by OpenStreetMap's licence) / offline notice.
    ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic'; ctx.font = '11px Arial, sans-serif';
    const credit = loaded ? '© учасники OpenStreetMap' : 'Фон карти недоступний (немає мережі)';
    const cw = ctx.measureText(credit).width + 10;
    ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.fillRect(W - cw, H - 18, cw, 18);
    ctx.fillStyle = '#333'; ctx.fillText(credit, W - 5, H - 5);
    ctx.strokeStyle = '#888'; ctx.lineWidth = 1; ctx.strokeRect(0.5, 0.5, W - 1, H - 1);

    return { bytes: dataUrlToBytes(canvas.toDataURL('image/png')), width: W, height: H, tilesTotal: tiles.length, tilesLoaded: loaded };
  }

  // ---- photos ------------------------------------------------------------------------
  // Every attached photo is re-drawn to a ≤640px-wide JPEG: Word can't show every
  // format a browser can (e.g. WebP), and it keeps the .docx small. A photo given
  // as a web link that the browser isn't allowed to read (no CORS) or that isn't an
  // image falls back to a plain link in the document.
  async function photoThumbnail(src){
    const img = await loadImage(src, !src.startsWith('data:'));
    const scale = Math.min(1, 640 / img.naturalWidth);
    const w = Math.max(1, Math.round(img.naturalWidth * scale)), h = Math.max(1, Math.round(img.naturalHeight * scale));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return { bytes: dataUrlToBytes(c.toDataURL('image/jpeg', 0.85)), width: w, height: h };
  }

  // -> Map(pointId -> {thumb|null, src})
  async function collectPhotos(routes){
    const result = new Map();
    const jobs = [];
    routes.forEach(r => r.points.forEach(p => {
      if(!p.photo) return;
      jobs.push(photoThumbnail(p.photo).then(thumb => result.set(p.id, { thumb, src: p.photo }), () => result.set(p.id, { thumb: null, src: p.photo })));
    }));
    await Promise.all(jobs);
    return result;
  }

  // ---- the document ---------------------------------------------------------------------
  const PAGE_W = 11906, PAGE_H = 16838, MARGIN = 1134;       // A4 portrait, 2 cm margins (DXA)
  const CONTENT_W = PAGE_W - 2 * MARGIN;                      // 9638

  function buildDocument(d, data){
    const { Document, Paragraph, TextRun, Table, TableRow, TableCell, ImageRun, ExternalHyperlink, Header, Footer,
            HeadingLevel, AlignmentType, WidthType, ShadingType, BorderStyle, PageNumber } = d;

    const para = (text, opts = {}) => new Paragraph(Object.assign({ children: [new TextRun({ text, size: opts.size, bold: opts.bold, color: opts.color, italics: opts.italics })] }, opts.p || {}));
    const heading = (text, level) => new Paragraph({ heading: level, keepNext: true, children: [new TextRun(text)] });

    // Table with fixed column widths (both on the table and on every cell, as Word/Google Docs need).
    function makeTable(widths, header, rows, swatchColumn){
      const line = { style: BorderStyle.SINGLE, size: 4, color: 'A0A0A0' };
      const borders = { top: line, bottom: line, left: line, right: line };
      const cell = (text, w, o = {}) => new TableCell({
        width: { size: w, type: WidthType.DXA }, borders,
        margins: { top: 50, bottom: 50, left: 80, right: 80 },
        shading: o.fill ? { type: ShadingType.CLEAR, fill: o.fill, color: 'auto' } : undefined,
        children: [new Paragraph({ keepNext: !!o.keepNext, children: [new TextRun({ text: String(text == null ? '' : text), bold: !!o.bold, size: 18 })] })]
      });
      return new Table({
        width: { size: widths.reduce((a, b) => a + b, 0), type: WidthType.DXA },
        columnWidths: widths,
        rows: [
          new TableRow({ tableHeader: true, cantSplit: true, children: header.map((h, i) => cell(h, widths[i], { bold: true, fill: 'D9D9D9', keepNext: true })) }),
          ...rows.map(r => new TableRow({ cantSplit: true, children: r.map((c, i) => (swatchColumn === i) ? cell('', widths[i], { fill: c }) : cell(c, widths[i])) }))
        ]
      });
    }

    const children = [];
    const stamp = new Date().toLocaleString('uk-UA');

    children.push(new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: 'Звіт за маршрутами', bold: true, size: 40 })] }));
    if(data.caseTitle) children.push(para('Справа: ' + data.caseTitle, { size: 26, p: { spacing: { after: 60 } } }));
    children.push(para('Сформовано: ' + stamp, { size: 20, color: '666666', p: { spacing: { after: 200 } } }));

    let section = 0;

    // 1. Map + legend
    children.push(heading(`${++section}. Карта маршрутів`, HeadingLevel.HEADING_1));
    const imgW = 638;                                   // px at 96 dpi ≈ the full text width
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER, spacing: { after: 60 },
      children: [new ImageRun({ type: 'png', data: data.map.bytes, transformation: { width: imgW, height: Math.round(imgW * data.map.height / data.map.width) } })]
    }));
    children.push(para('Рис. 1 — Схема. Номери на карті відповідають колонці «№» у таблицях нижче; стрілки показують напрямок руху.' +
      (data.routes.some(r => r.dashed) ? ' Пунктир — маршрут, що повторює шлях іншого (наприклад, дорога назад).' : '') +
      (data.map.tilesLoaded ? ' Підкладка: © учасники OpenStreetMap.' : ' Підкладку карти завантажити не вдалося (немає мережі).'),
      { size: 18, italics: true, color: '555555', p: { spacing: { after: 160 } } }));
    if(data.routes.length){
      children.push(makeTable([500, 3300, 1300, 3338, 1200], ['', 'Маршрут', 'Тип', 'Теги', 'Точок'],
        data.routes.map(r => [hex(r.color), r.name, typeLabel(r), (r.tags || []).join(', '), r.points.length]), 0));
    }

    // 2. Points of every route
    if(data.routes.length){
      children.push(heading(`${++section}. Точки фіксації`, HeadingLevel.HEADING_1));
      data.routes.forEach((r, ri) => {
        children.push(heading(`Маршрут ${ri + 1}: ${r.name}`, HeadingLevel.HEADING_2));
        const bends = (r.bends || []).length;
        children.push(new Paragraph({ keepNext: true, spacing: { after: 80 }, children: [
          new TextRun({ text: '   ', shading: { type: ShadingType.CLEAR, fill: hex(r.color), color: 'auto' } }),
          new TextRun({ text: `  Тип: ${typeLabel(r)}` + ((r.tags || []).length ? ` · Теги: ${r.tags.join(', ')}` : '') + (bends ? ` · Проміжних точок вигину: ${bends}` : ''), size: 20 })
        ] }));
        children.push(makeTable([560, 1300, 820, 1300, 1300, 1750, 2608],
          ['№', 'Дата', 'Час', 'Широта', 'Довгота', 'Джерело', 'Примітка'],
          utils.sortedPoints(r).map((p, i) => [i + 1, fmtDate(p.date), p.time, fmtCoord(p.lat), fmtCoord(p.lng), sourceLabel(p), p.note || ''])));
      });
    }

    // 3. POI markers
    if(data.pois.length){
      children.push(heading(`${++section}. Мітки на карті`, HeadingLevel.HEADING_1));
      children.push(makeTable([700, 2400, 2500, 1300, 1300, 1438],
        ['№', 'Тип', 'Назва', 'Широта', 'Довгота', 'Примітка'],
        data.pois.map((m, i) => ['М' + (i + 1), (constants.MARKER_ICON_TYPES[m.icon] || constants.MARKER_ICON_TYPES.other).label, m.label, fmtCoord(m.lat), fmtCoord(m.lng), m.note || ''])));
    }

    // 4. Photos / scans
    const photoBlocks = [];
    data.routes.forEach((r, ri) => utils.sortedPoints(r).forEach((p, i) => {
      if(!p.photo) return;
      const info = data.photos.get(p.id) || { thumb: null, src: p.photo };
      photoBlocks.push({ r, ri, p, i, info });
    }));
    if(photoBlocks.length){
      children.push(heading(`${++section}. Фото та скани`, HeadingLevel.HEADING_1));
      photoBlocks.forEach(b => {
        children.push(new Paragraph({ keepNext: true, spacing: { before: 200, after: 60 }, children: [
          new TextRun({ text: `Маршрут «${b.r.name}», точка № ${b.i + 1} — ${fmtDate(b.p.date)} ${b.p.time}`, bold: true, size: 22 })
        ] }));
        children.push(new Paragraph({ keepNext: !!b.info.thumb, spacing: { after: 80 }, children: [
          new TextRun({ text: `Координати: ${fmtCoord(b.p.lat)}, ${fmtCoord(b.p.lng)} · Джерело: ${sourceLabel(b.p)}` + (b.p.note ? ` · ${b.p.note}` : ''), size: 20, color: '444444' })
        ] }));
        if(b.info.thumb){
          const t = b.info.thumb, k = Math.min(1, 340 / t.width, 400 / t.height);
          children.push(new Paragraph({ spacing: { after: 120 }, children: [
            new ImageRun({ type: 'jpg', data: t.bytes, transformation: { width: Math.round(t.width * k), height: Math.round(t.height * k) } })
          ] }));
        } else {
          children.push(new Paragraph({ spacing: { after: 120 }, children: [
            new TextRun({ text: 'Вкладення (посилання): ', size: 20 }),
            new ExternalHyperlink({ link: b.info.src, children: [new TextRun({ text: b.info.src, size: 20, color: '0563C1', underline: {} })] })
          ] }));
        }
      });
    }

    return new Document({
      creator: 'route-map',
      title: 'Звіт за маршрутами' + (data.caseTitle ? ' — ' + data.caseTitle : ''),
      styles: {
        default: { document: { run: { font: 'Arial', size: 21 } } },
        paragraphStyles: [
          { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 30, bold: true }, paragraph: { spacing: { before: 320, after: 140 }, outlineLevel: 0 } },
          { id: 'Header', name: 'header', basedOn: 'Normal', run: { size: 16, color: '888888' } },
          { id: 'Footer', name: 'footer', basedOn: 'Normal', run: { size: 16, color: '888888' } },
          { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 25, bold: true }, paragraph: { spacing: { before: 240, after: 100 }, outlineLevel: 1 } }
        ]
      },
      sections: [{
        properties: { page: { size: { width: PAGE_W, height: PAGE_H }, margin: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN } } },
        headers: { default: new Header({ children: [new Paragraph({ style: 'Header', alignment: AlignmentType.RIGHT, children: [new TextRun(data.caseTitle ? 'Справа: ' + data.caseTitle : 'Звіт за маршрутами')] })] }) },
        footers: { default: new Footer({ children: [new Paragraph({ style: 'Footer', alignment: AlignmentType.CENTER, children: [new TextRun({ children: ['Сторінка ', PageNumber.CURRENT, ' з ', PageNumber.TOTAL_PAGES] })] })] }) },
        children
      }]
    });
  }

  // ---- the button -----------------------------------------------------------------------
  const btn = document.getElementById('wordReportBtn');
  let lastCaseTitle = '';

  async function run(){
    // Same rule as the print legend: what's checked ("shown") in the route list goes in.
    const routes = state.routes.filter(r => r.visible && r.points.length);
    const pois = state.markers;
    if(!routes.length && !pois.length){
      alert('Немає що вносити у звіт: увімкніть галочкою хоча б один маршрут із точками (або додайте мітки).');
      return;
    }
    const title = prompt('Назва або номер справи для заголовка звіту (можна залишити порожнім):', lastCaseTitle);
    if(title === null) return;
    lastCaseTitle = title.trim();

    const label = btn.textContent;
    btn.disabled = true; btn.textContent = '⏳ Формую звіт…';
    try{
      const [d, map, photos] = await Promise.all([loadDocx(), renderMap(routes, pois), collectPhotos(routes)]);
      const doc = buildDocument(d, { caseTitle: lastCaseTitle, routes, pois, map, photos });
      const blob = await d.Packer.toBlob(doc);
      const now = new Date(), pad = v => String(v).padStart(2, '0');
      App.exportImport.downloadBlob(blob, DOCX_MIME, `zvit-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.docx`);
    }catch(err){
      alert('Не вдалося сформувати звіт: ' + (err && err.message ? err.message : err));
    }finally{
      btn.disabled = false; btn.textContent = label;
    }
  }
  btn.addEventListener('click', run);

  App.report = { config, run, renderMap };
})();
