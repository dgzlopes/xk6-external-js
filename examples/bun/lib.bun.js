import { metrics } from "../../helpers/index.js";

export const handler = async (ctx) => {
  metrics.counter("bun_requests").add(1);

  // Bun's native hash API
  const hash = Bun.hash(JSON.stringify(ctx.payload));

  return {
    hash: hash.toString(16),
    message: `Hello from Bun! Processed ${ctx.payload.user || "user"} (VU ${ctx.vu.id}, Iteration ${ctx.iteration})`,
  };
};

