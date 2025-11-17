import { run } from "../../js_k6_helpers.js";

export default run(async ({ payload, metrics }) => {
  // Custom k6 metrics
  metrics.counter("deno_requests").add(1);

  // Deno's native crypto API
  const encoder = new TextEncoder();
  const data = encoder.encode(JSON.stringify(payload));
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hash = hashArray.map(b => b.toString(16).padStart(2, "0")).join("");

  return {
    hash,
    message: `Hello from Deno! Processed ${payload.user || "user"}`,
  };
});

