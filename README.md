# xk6-external-js

Bring Node, Deno, and Bun into your Grafana k6 tests. Seamless interop. Endless possibilities.

With this extension, you can use:
- All of Node/Deno/Bun's standard library (`fs`, `crypto`, `http`, etc)
- Any npm package you want (e.g. Playwright, Axios, etc)
- Internal SDKs and company-specific libraries you already rely on

...directly from your k6 scripts. No rewrites. No duplicated logic.

## Wait, what?

Yep. With this extension, your k6 tests can call out a external JavaScript runtime from inside a VU, synchronously, and get results back as if it were a normal function call.

```js
// test.js
import ext from "k6/x/external_js";

export default function () {
  const result = ext.run("auth.node.js", {
    user: "alice",
  });

  console.log("Token:", result.token);
}
```

Behind the scenes, `ext.run()`:
- Spins up a Node.js (or Deno/Bun) process.
- Sends the payload over (plus environment variables, etc).
- Runs your code.
- Collects any custom k6 metrics you recorded.
- Records any k6 checks you defined.
- Returns the result back to your k6 script.

Here is what the `auth.node.js` file (running inside Node) looks like:

```js
// auth.node.js
const { run, metrics, checks } = require("xk6-external-js-helpers");
const crypto = require("crypto");

module.exports = run(async (ctx) => {
  // Emit custom k6 metrics from the external runtime
  metrics.counter("auth_calls").add(1);
  
  // Use Node's standard library APIs (crypto, fs, http, etc.)
  const token = crypto
    .createHash("sha256")
    .update(ctx.payload.user + "-" + Date.now())
    .digest("hex");
  
  // Create k6 checks that will be recorded in the k6 context
  checks.check("token_generated", token !== undefined);
  checks.check("token_length_valid", token.length === 64);

  return { token };
});
```

## More

### Supported Runtimes

This extension supports three JavaScript runtimes: Node (default), Bun and Deno.

```js
// Defaults to Node.js
ext.run("./lib.js", { user: "alice" });

// Explicit runtime
ext.run("./lib.js", {
  payload: { user: "alice" },
  runtime: "deno" // or "node" or "bun"
});
```

### NPM Package

The `xk6-external-js-helpers` package provides utilities for working with k6 from external JavaScript runtimes:

- **`run(fn)`** Wraps your async function and handles metrics/checks collection
- **`metrics`** Emit custom k6 metrics (counters, gauges, trends, rates)
- **`checks`** Create k6 checks
- **`ctx`** Access execution context (payload, environment variables, VU info)

Install it in your project with

```bash
npm install xk6-external-js-helpers
```