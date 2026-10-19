/* tests/static.test.js — checks of the project files themselves (no browser needed). They catch the kind of
   mistakes that have actually happened: a file uploaded under the wrong name, `const App` declared twice,
   a dialog placed below the <script> tags, an id used in JS that does not exist in the HTML. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { check, summary } = require('./lib');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script src="(js\/[^"]+)"/g)].map(m => m[1]);
const firstScriptAt = html.indexOf('<script src="js/');
console.log('--- project files ---');

check('index.html lists the app scripts', scripts.length >= 10, scripts);
const missing = scripts.filter(f => !fs.existsSync(path.join(ROOT, f)));
check('every <script src="js/…"> file exists (exact name, with .js)', missing.length === 0, missing);
const onDisk = fs.readdirSync(path.join(ROOT, 'js')).map(f => 'js/' + f);
check('no file in js/ is left out of index.html (or misnamed)', onDisk.every(f => scripts.includes(f)), onDisk.filter(f => !scripts.includes(f)));

const sources = {};
scripts.forEach(f => { if(fs.existsSync(path.join(ROOT, f))) sources[f] = fs.readFileSync(path.join(ROOT, f), 'utf8'); });
const syntaxErrors = Object.entries(sources).filter(([f, code]) => { try{ new vm.Script(code, { filename: f }); return false; }catch(e){ return true; } }).map(([f]) => f);
check('every script is valid JavaScript', syntaxErrors.length === 0, syntaxErrors);

const declaring = Object.entries(sources).filter(([f, c]) => /^const App\s*=/m.test(c)).map(([f]) => f);
check('only constants.js declares `const App` (a second declaration is a SyntaxError)', JSON.stringify(declaring) === '["js/constants.js"]', declaring);
check('constants.js is the first app script', scripts[0] === 'js/constants.js' && scripts[scripts.length - 1] === 'js/main.js', [scripts[0], scripts[scripts.length - 1]]);

const selfCheck = html.slice(html.indexOf('LOAD SELF-CHECK'));
const notChecked = scripts.filter(f => f !== 'js/main.js' && !selfCheck.includes(`'${f}'`));
check('every module is covered by the on-page load self-check (red banner)', notChecked.length === 0, notChecked);

// ids
const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);
const dupes = ids.filter((v, i) => ids.indexOf(v) !== i);
check('no duplicate ids in index.html', dupes.length === 0, dupes);
const used = new Set();
Object.values(sources).forEach(code => { for(const m of code.matchAll(/(?:getElementById|\$)\('([^']+)'\)/g)) used.add(m[1]); });
const unknown = [...used].filter(id => !ids.includes(id));
check('every id used in the scripts exists in index.html', unknown.length === 0, unknown);
const late = ids.filter(id => html.indexOf(`id="${id}"`) > firstScriptAt && used.has(id));
check('no element used by the scripts sits below the <script> tags (they run at load time)', late.length === 0, late);

// docs
const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
const undocumented = scripts.filter(f => !readme.includes(f.replace('js/', '')));
check('README lists every module in the project structure', undocumented.length === 0, undocumented);
check('example data exists and is valid JSON', (() => { try{ const d = JSON.parse(fs.readFileSync(path.join(ROOT, 'examples', 'london-route.json'), 'utf8')); return Array.isArray(d.routes); }catch(e){ return false; } })());
summary();
