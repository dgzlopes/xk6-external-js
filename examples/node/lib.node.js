const { run } = require("../../js_k6_helpers");
const { chromium, devices } = require('playwright');
const crypto = require("crypto");

module.exports = run(async ({ payload, metrics, env }) => {
  // Custom k6 metrics
  metrics.counter("example_counter").add(7);
  metrics.gauge("example_gauge").set(3.14);
  metrics.trend("example_trend").add(123.456);
  metrics.rate("example_rate").add(true, { foo: "bar", test: "yes" });

  // Environment variables from k6
  console.log("Env var THIS_IS_FROM_K6:", env.THIS_IS_FROM_K6);

  // Node.js stuff
  const hash = crypto.createHash('sha256')
    .update(`${payload.user}-${Date.now()}`)
    .digest('hex');

  // Playwright?!
  const browser = await chromium.launch();
  const context = await browser.newContext(devices['iPhone 11']);
  const page = await context.newPage();

  await context.route('**.jpg', route => route.abort());
  await page.goto('https://example.com/');
  assert(await page.title() === 'Example Domain');

  await context.close();
  await browser.close();

  return { token: `token-${hash}` };
});
