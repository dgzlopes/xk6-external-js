import ext from "k6/x/external_js";

var BENCH_RUNTIME = __ENV.BENCH_RUNTIME || "bun"; // node, deno, bun

export const options = {
  vus: 5,
  duration: "10s",
};

export default function () {
  const result = ext.run("./lib.js", {
    payload: { user: "alice" },
    runtime: BENCH_RUNTIME,
  });
}

