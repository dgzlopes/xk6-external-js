const fs = require("fs");
const path = require("path");

// When invoked as:
//   node -e "<runnerScript>" <entry> <payloadJson>
//
// argv looks like:
//   [0] node
//   [1] <entry>
//   [2] <payloadJson>
const entryPath = process.argv[1];
const payloadJson = process.argv[2];

(async () => {
  try {
    if (!entryPath) {
      throw new Error("Missing entry path argument");
    }
    if (!payloadJson) {
      throw new Error("Missing payload JSON argument");
    }

    const payload = JSON.parse(payloadJson);

    // Support both with and without .js extension
    let fullPath = path.join(process.cwd(), entryPath);
    if (!fullPath.endsWith(".js")) {
      fullPath += ".js";
    }

    if (!fs.existsSync(fullPath)) {
      throw new Error("Flow not found: " + fullPath);
    }

    const flowFunction = require(fullPath);

    // ctx can be extended later (logger, etc.)
    const ctx = {
      env: process.env,
      logger: console,
    };

    const result = await flowFunction(payload, ctx);

    console.log("__RESULT_START__");
    console.log(JSON.stringify(result || {}));
    console.log("__RESULT_END__");
    process.exit(0);
  } catch (error) {
    console.error("Error:", error && error.stack ? error.stack : String(error));
    process.exit(1);
  }
})();
