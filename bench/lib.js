import { run, metrics } from "../helpers/index.js";

export default run(async (ctx) => {
  return {
    message: `${ctx.payload.user}, hello from another runtime!`,
  };
});

