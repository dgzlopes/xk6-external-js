# xk6-external-js

Run Node, Deno, or Bun code from k6 tests. Useful for using npm packages, standard library APIs, or existing code that doesn't work on k6's JavaScript runtime.

## Build

```bash
xk6 build --with github.com/grafana/xk6-external-js@latest
```

## Usage

```js
// test.k6.js
import ext from "k6/x/external_js";

export default function () {
  const result = ext.run("auth.node.js", {
    user: "alice",
  });
  console.log("Token:", result.token);
}
```

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

## Runtimes

Runtime is auto-detected from the filename:
- `*.node.js/ts` → Node.js
- `*.deno.js/ts` → Deno
- `*.bun.js/ts` → Bun
- Otherwise defaults to Node.js

Alternatively, you can specify it manually:

```js
ext.run("./lib.js", {
  payload: { user: "alice" },
  runtime: "deno" // or "node" or "bun"
});
```

## NPM Package

The `xk6-external-js-helpers` package provides utilities to make the interop nicer:
- `run(fn)` - Wraps your code and handles metrics/checks collection
- `metrics` - Emit k6 metrics (counters, gauges, trends, rates)
- `checks` - Create k6 checks
- `ctx` - Execution context with payload, env vars, and VU info

Install it in your project with:

```bash
npm install xk6-external-js-helpers
```


