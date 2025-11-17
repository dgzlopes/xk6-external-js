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
- Returns the result back to your k6 script.

Here is what the `auth.node.js` file (running inside Node) looks like:

```js
// auth.node.js
const { run } = require("xk6-external-js-helpers");
const crypto = require("crypto");

module.exports = run(async ({ payload, metrics }) => {
  // Yes, you can emit k6 metrics from here
  metrics.counter("auth_calls").add(1);

  return {
    token: crypto
      .createHash("sha256")
      .update(payload.user + "-" + Date.now())
      .digest("hex"),
  };
});
```

A helper library (`xk6-external-js-helpers`) can be used to wrap your JavaScript code, enable metrics collection, and many more things:

```bash
npm install xk6-external-js-helpers
```

## Using npm packages with Deno

When using Deno, npm packages must be imported with the `npm:` prefix:

```ts
// lib.deno.ts
import { run } from "../../helpers/index.js";
import axios from "npm:axios@^1.6.0";  // Note the npm: prefix

export default run(async ({ payload, metrics }) => {
  const response = await axios.get("https://example.com/api");
  return { data: response.data };
});
```

**Important**: Deno requires the `npm:` specifier for all npm package imports. The extension automatically enables npm support with the `--allow-all` flag.

For npm packages that require installation (like Playwright), you may need to run setup commands separately:
```bash
deno run --allow-all npm:playwright install
```