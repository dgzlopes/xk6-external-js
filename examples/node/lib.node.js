const { run } = require("../../helpers");
const { chromium } = require('playwright');

module.exports = run(async (ctx) => {
  ctx.metrics.counter("node_requests").add(1);

  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('https://example.com/');
  const title = await page.title();
  await browser.close();

  return {
    title,
    message: `Hello from Node.js! Processed ${ctx.payload.user || "user"} (VU ${ctx.execution.vu.id}, Iteration ${ctx.execution.vu.iteration})`,
  };
});
