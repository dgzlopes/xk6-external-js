import { metrics, checks } from "../../helpers/index.js";
import { chromium } from "npm:playwright@^1.40.0";

export const handler = async (ctx) => {
  metrics.counter("deno_requests").add(1);

  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('https://example.com/');
  const title = await page.title();
  await browser.close();

  checks.check("title_is_example", title === "Example Domain");

  return {
    title,
    message: `Hello from Deno! Processed ${ctx.payload.user || "user"} (VU ${ctx.vu.id}, Iteration ${ctx.iteration})`,
  };
};

