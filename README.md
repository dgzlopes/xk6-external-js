# xk6-external-js

Run Node, Deno, or Bun code from your k6 tests so you can use:

- Any npm package (e.g., Playwright, AWS/GCP/Azure SDKs, JWT, etc)
- Runtime standard libraries (e.g., fs, crypto, http)
- Existing JavaScript/TypeScript code that doesn’t run in k6’s runtime

## Prerequisites

**To build the extension:**
- Go 1.25+
- [xk6](https://github.com/grafana/xk6)

**To run tests:**
- Node.js, Deno, or Bun installed and available in PATH

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
## More
### Supported Runtimes

The runtime is auto-detected from the file extension:
- `*.node.js/ts` → Node.js
- `*.deno.js/ts` → Deno
- `*.bun.js/ts` → Bun
- Anything else → Node.js (default)

You can also specify it explicitly, along with other options:

```js
ext.run("./lib.js", {
  payload: { user: "alice" },
  runtime: "deno", // or "node" or "bun"
  env: { NODE_ENV: "production" },
  timeout: "5s"
});
```

The `payload` is passed as `ctx.payload` in your external script, and whatever you return becomes the result in k6. Only JSON-serializable data can be passed (no functions, classes, or Buffers). Promises are automatically awaited.

If your external JS throws an error, it fails the k6 iteration and the error includes full stdout/stderr output. `console.log` from external JS is captured but only appears in error messages when execution fails.

### Security

External runtimes have full access to the local filesystem and network. Deno is run with `--allow-all` (bypassing its permission system), and Node.js/Bun have no sandboxing by default.

### Performance
Each call has ~25 ms of overhead because it spawns a new runtime process. This is usually fine when your external JS does meaningful work (crypto, I/O, etc.). However, this extension isn’t designed for **high-load scenarios**.

You can quickly hit system limits by spawning too many OS processes. k6’s built-in JavaScript runtime is optimized for high concurrency, so for heavy-load tests you should mix approaches. For example, use Deno/Node/Bun in `setup()` and rely on k6’s runtime inside VU code.

Benchmark results (5 VUs, 10s duration, [minimal function call](https://github.com/dgzlopes/xk6-external-js/tree/main/bench)):

| Runtime | Iterations/s | Avg Duration |
|---------|--------------|--------------|
| Bun     | ~275         | ~17ms        |
| Deno    | ~233         | ~21ms        |
| Node    | ~204         | ~24ms        |

### Helpers Package

The `xk6-external-js-helpers` package provides utilities to make the interop nicer:
- `run(fn)` - Wraps your code and handles metrics/checks collection
- `metrics` - Emit k6 metrics (counters, gauges, trends, rates)
- `checks` - Create k6 checks
- `ctx` - Execution context with payload, env vars, and VU info

Install it in your project with:

```bash
npm install xk6-external-js-helpers
```


