# xk6-js

Bring Node, Deno, and Bun into your Grafana k6 tests. Seamless interop. Endless possibilities.

With this extension, you can use:
- All of Node/Deno/Bun's standard library (`fs`, `crypto`, `http`, etc)
- Any npm package you want (e.g. Playwright, Axios, etc)
- Internal SDKs and company-specific libraries you already rely on

...directly from your k6 scripts. No rewrites. No duplicated logic.

## Wait, what?

Yep. Your k6 script can call out a external JavaScript runtime from inside a VU, synchronously, and get results back as if it were a normal function call.

```js
// test.js
import js from "k6/x/js";

export default function () {
  const result = js.run("auth.node.js", {
    user: "alice",
  });

  console.log("Token:", result.token);
}
```

Behind the scenes, `js.run()`:
- Spins up a Node.js (or Deno/Bun) process
- Sends the payload over (plus environment variables, etc)
- Runs your code
- Collects any custom k6 metrics you recorded
- Returns the result back to your k6 script

Here is what the `auth.node.js` file (running inside Node) looks like:
```js
// auth.node.js
const { run } = require("k6_helpers");
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
