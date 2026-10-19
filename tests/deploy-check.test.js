/* tests/deploy-check.test.js — a faulty upload (state.js holds map.js, poi.js missing) is announced by the red banner; a healthy one is not */

const { open, check, summary, BASE } = require('./lib');
(async () => {
  console.log('--- load self-check banner ---');
  const bad = await open(process.env.BROKEN_URL || BASE);
  const banner = await bad.page.$eval('#loadBanner', e => e.textContent).catch(() => null);
  check('faulty deploy: red banner shown', !!banner, banner);
  check('banner names js/state.js and js/poi.js', !!banner && banner.includes('js/state.js') && banner.includes('js/poi.js'), banner);
  await bad.browser.close();
  const good = await open();
  check('healthy deploy: no banner', (await good.page.$('#loadBanner')) === null);
  await good.browser.close();
  summary();
})().catch(e => { console.error('CRASH', e); process.exit(1); });
