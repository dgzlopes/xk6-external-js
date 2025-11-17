const isDeno = typeof Deno !== "undefined";
const isBun = typeof Bun !== "undefined";
const isNode = !isDeno && !isBun && typeof process !== "undefined" && process.versions?.node;

(async () => {
  try {
    const entryPath = isDeno ? Deno.args[0] : process.argv[1];
    const payloadJson = isDeno ? Deno.args[1] : process.argv[2];
    const execContextJson = isDeno ? Deno.args[2] : process.argv[3];

    if (!entryPath) {
      throw new Error("Missing entry path argument");
    }
    if (!payloadJson) {
      throw new Error("Missing payload JSON argument");
    }

    const payload = JSON.parse(payloadJson);
    
    let executionContext = {};
    if (execContextJson) {
      executionContext = JSON.parse(execContextJson);
    }

    let fullPath;
    if (isDeno) {
      if (!entryPath.startsWith("file://") && !entryPath.startsWith("http://") && !entryPath.startsWith("https://")) {
        try {
          const absPath = await Deno.realPath(entryPath);
          fullPath = `file://${absPath}`;
        } catch {
          const cwd = Deno.cwd();
          const baseUrl = `file://${cwd}/`;
          const resolvedUrl = new URL(entryPath, baseUrl);
          fullPath = resolvedUrl.href;
        }
      } else {
        fullPath = entryPath;
      }
    } else {
      let path, fs;
      if (isNode) {
        path = require("path");
        fs = require("fs");
      } else {
        const pathMod = await import("path");
        const fsMod = await import("fs");
        path = pathMod.default || pathMod;
        fs = fsMod.default || fsMod;
      }
      
      fullPath = path.join(process.cwd(), entryPath);
      if (!fullPath.endsWith(".js") && !fullPath.endsWith(".ts")) {
        fullPath += ".js";
      }

      if (isNode) {
        if (!fs.existsSync(fullPath)) {
          throw new Error("Flow not found: " + fullPath);
        }
      } else {
        try {
          await fs.promises.stat(fullPath);
        } catch {
          throw new Error("Flow not found: " + fullPath);
        }
      }
    }

    let flowFunction;
    if (isNode && typeof require !== "undefined") {
      try {
        const required = require(fullPath);
        if (typeof required === "function") {
          flowFunction = required;
        } else if (required && typeof required.default === "function") {
          flowFunction = required.default;
        } else {
          const flowModule = await import(fullPath);
          flowFunction = flowModule.default || flowModule;
        }
      } catch {
        const flowModule = await import(fullPath);
        flowFunction = flowModule.default || flowModule;
      }
    } else {
      const flowModule = await import(fullPath);
      flowFunction = flowModule.default || flowModule;
    }

    if (typeof flowFunction !== "function") {
      throw new Error(`Expected a function but got ${typeof flowFunction}. Make sure your module exports a function (default export or module.exports).`);
    }

    const env = isDeno ? Deno.env.toObject() : process.env;

    const ctx = {
      payload,
      env,
      execution: executionContext,
    };

    const result = await flowFunction(ctx);

    console.log("__RESULT_START__");
    console.log(JSON.stringify(result || {}));
    console.log("__RESULT_END__");
    
    if (isDeno) {
      Deno.exit(0);
    } else {
      process.exit(0);
    }
  } catch (error) {
    console.error("Error:", error && error.stack ? error.stack : String(error));
    if (isDeno) {
      Deno.exit(1);
    } else {
      process.exit(1);
    }
  }
})();

