import { run } from "../../helpers/index.js";
import { chromium } from "npm:playwright@^1.40.0";

export default run(async ({ payload, metrics }) => {
  metrics.counter("deno_requests").add(1);

  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('https://example.com/');
  const title = await page.title();
  await browser.close();

  return {
    title,
    message: `Hello from Deno! Processed ${payload.user || "user"}`,
  };
});

