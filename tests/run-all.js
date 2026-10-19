/* =============================================================================
   tests/run-all.js — runs every *.test.js in this folder, one after another, against a
   local test server, and prints a summary. `node run-all.js bends` runs only the files whose
   name contains "bends". Exit code 1 if anything failed.
   ============================================================================= */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const server = require('./server');

(async () => {
  const filter = process.argv[2];
  const files = fs.readdirSync(__dirname).filter(f => f.endsWith('.test.js') && (!filter || f.includes(filter))).sort();
  const ok = await server.start();
  const broken = await server.start({ broken: true });
  const results = [];
  for(const f of files){
    console.log(`\n▶ ${f}`);
    const code = await new Promise(resolve => {
      const child = spawn(process.execPath, [path.join(__dirname, f)], { stdio: 'inherit', env: Object.assign({}, process.env, { BASE_URL: ok.url, BROKEN_URL: broken.url }) });
      child.on('exit', c => resolve(c));
    });
    results.push([f, code === 0]);
  }
  await ok.close(); await broken.close();
  console.log('\n================ SUMMARY ================');
  results.forEach(([f, pass]) => console.log((pass ? '  ✔ ' : '  ✘ ') + f));
  const bad = results.filter(r => !r[1]).length;
  console.log(bad ? `\n${bad} of ${results.length} test files FAILED` : `\nAll ${results.length} test files passed`);
  process.exit(bad ? 1 : 0);
})();
