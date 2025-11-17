import { run } from "../../helpers/index.js";

export default run(async ({ payload, metrics }) => {
  // Custom k6 metrics
  metrics.counter("bun_requests").add(1);

  // Bun's native hash API
  const hash = Bun.hash(JSON.stringify(payload));

  return {
    hash: hash.toString(16),
    message: `Hello from Bun! Processed ${payload.user || "user"}`,
  };
});

