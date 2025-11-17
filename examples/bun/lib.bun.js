import { run } from "../../helpers/index.js";

export default run(async (ctx) => {
  ctx.metrics.counter("bun_requests").add(1);

  // Bun's native hash API
  const hash = Bun.hash(JSON.stringify(ctx.payload));

  return {
    hash: hash.toString(16),
    message: `Hello from Bun! Processed ${ctx.payload.user || "user"} (VU ${ctx.execution.vu.id}, Iteration ${ctx.execution.vu.iteration})`,
  };
});

