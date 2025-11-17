import ext from "k6/x/external_js";

export const options = {
  vus: 1,
  duration: "5s",
};

export default function () {
  console.log("Starting iteration test with Deno + Playwright...");
  
  const result = ext.run("./lib.deno.ts", {
    user: "alice",
  });

  console.log("Received:", result.message);
  console.log("Page title:", result.title);
}

