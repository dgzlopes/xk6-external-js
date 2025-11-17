const { metrics, checks } = require("../../helpers/index.js");
const { chromium } = require('playwright');

const handler = async (ctx) => {
  metrics.counter("node_requests").add(1);

  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('https://example.com/');
  const title = await page.title();
  await browser.close();
  
  checks.check("title_is_example", title === "Example Domain");

  return {
    title,
    message: `Hello from Node.js! Processed ${ctx.payload.user || "user"} (VU ${ctx.vu.id}, Iteration ${ctx.vu.iteration})`,
  };
};

module.exports = { handler };
