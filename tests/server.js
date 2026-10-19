/* =============================================================================
   tests/server.js
   A tiny static web server for the tests (Node only — no Python, no symlinks):
     - serves the project (index.html, js/, styles.css, examples/ …) from the repo root;
     - serves /index.test.html: the real index.html with the Leaflet CDN tags removed and
       tests/fake-leaflet.js (a stand-in for Leaflet) put in their place;
     - serves /docx.iife.js from the `docx` package (the Word report loads it from a CDN
       in real life);
     - `broken: true` simulates a faulty upload to GitHub (js/state.js holds map.js's code,
       js/poi.js is missing) to check the on-page "load error" banner.
   ============================================================================= */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.gif': 'image/gif', '.md': 'text/markdown; charset=utf-8' };

function testPage(){
  let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  html = html.replace(/<link rel="stylesheet" href="https:\/\/unpkg[^>]*>\n?/g, '')
             .replace(/<script src="https:\/\/unpkg[^>]*><\/script>\n?/g, '')
             .replace('<script src="js/constants.js"></script>', '<script src="/tests/fake-leaflet.js"></script>\n<script src="js/constants.js"></script>');
  return html;
}

function docxBundle(){
  const dist = path.dirname(require.resolve('docx'));                 // …/docx/dist (found via node_modules or NODE_PATH)
  return fs.readFileSync(path.join(dist, 'index.iife.js'));
}

function start({ broken = false } = {}){
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    const send = (code, body, type) => { res.writeHead(code, { 'Content-Type': type || 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(body); };
    try{
      if(url === '/index.test.html') return send(200, testPage(), TYPES['.html']);
      if(url === '/docx.iife.js') return send(200, docxBundle(), TYPES['.js']);
      if(broken && url === '/js/poi.js') return send(404, 'not found');
      if(broken && url === '/js/state.js') return send(200, fs.readFileSync(path.join(ROOT, 'js', 'map.js')), TYPES['.js']);
      const base = url.startsWith('/tests/') ? __dirname : ROOT;
      const rel = url.startsWith('/tests/') ? url.slice('/tests/'.length) : url.replace(/^\//, '');
      const file = path.resolve(base, rel);
      if(!file.startsWith(base) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(404, 'not found');
      send(200, fs.readFileSync(file), TYPES[path.extname(file)] || 'application/octet-stream');
    }catch(err){ send(500, String(err && err.message || err)); }
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => {
    resolve({ url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(r => server.close(r)) });
  }));
}

module.exports = { start };
