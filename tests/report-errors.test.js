/* tests/report-errors.test.js — Word report: the library cannot be loaded (clear message), then a retry works */
const { open, check, summary, createRoute, addPointViaClick } = require('./lib');
(async () => {
  const { browser, page, errors } = await open();
  const dialogs = [];
  page.on('dialog', d => { dialogs.push(d.type() + ': ' + d.message()); d.accept(d.type() === 'prompt' ? '' : undefined); });
  console.log('--- Word report: library cannot be loaded (fresh page) ---');
  await createRoute(page, 'X', '#ff0000'); await addPointViaClick(page, 49.55, 25.59, '10:00'); await page.click('#stopAddBtn');
  await page.evaluate(() => { App.report.config.docxUrls = ['/nope1.js', '/nope2.js']; App.report.config.tileUrl = '/tiles/{z}/{x}/{y}.png'; });
  await page.click('#wordReportBtn'); await page.waitForTimeout(2500);
  check('clear error about the library / internet', dialogs.some(d => /Не вдалося сформувати звіт/.test(d) && /інтернет/.test(d)), dialogs);
  check('button usable again with original label', await page.$eval('#wordReportBtn', b => !b.disabled && /Звіт у Word/.test(b.textContent)));
  // second attempt after the CDN "comes back" works (failed load is not cached)
  await page.evaluate(() => { App.report.config.docxUrls = ['/docx.iife.js']; });
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.click('#wordReportBtn')]);
  check('retry succeeds once the library is reachable', /\.docx$/.test(dl.suggestedFilename()));
  check('single-point route (no line, one point) still reports', true);
  console.log('page errors:', errors.length ? errors : 'none');
  summary(); await browser.close();
})().catch(e => { console.error('CRASH', e); process.exit(1); });
