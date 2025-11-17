// Unified JavaScript runner for Node.js, Deno, and Bun
// Detects runtime and adapts accordingly

// Detect runtime
const isDeno = typeof Deno !== "undefined";
const isBun = typeof Bun !== "undefined";
const isNode = !isDeno && !isBun && typeof process !== "undefined" && process.versions?.node;

(async () => {
  try {
    // Get entry path, payload, and execution context from command line arguments
    // All runtimes (Node, Deno, Bun) receive arguments the same way
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
    
    // Parse execution context
    let executionContext = {};
    if (execContextJson) {
      executionContext = JSON.parse(execContextJson);
    }

    // Resolve full path based on runtime
    let fullPath;
    if (isDeno) {
      // Deno: use file:// URLs
      if (!entryPath.startsWith("file://") && !entryPath.startsWith("http://") && !entryPath.startsWith("https://")) {
        try {
          const absPath = await Deno.realPath(entryPath);
          fullPath = `file://${absPath}`;
        } catch {
          // Try with extensions
          try {
            const jsPath = await Deno.realPath(entryPath + ".js");
            fullPath = `file://${jsPath}`;
          } catch {
            try {
              const tsPath = await Deno.realPath(entryPath + ".ts");
              fullPath = `file://${tsPath}`;
            } catch {
              const cwd = Deno.cwd();
              fullPath = `file://${cwd}/${entryPath}`;
            }
          }
        }
      } else {
        fullPath = entryPath;
      }
    } else {
      // Node/Bun: use file system paths
      let path, fs;
      if (isNode) {
        path = require("path");
        fs = require("fs");
      } else {
        // Bun - use dynamic import
        const pathMod = await import("path");
        const fsMod = await import("fs");
        path = pathMod.default || pathMod;
        fs = fsMod.default || fsMod;
      }
      
      fullPath = path.join(process.cwd(), entryPath);
      if (!fullPath.endsWith(".js") && !fullPath.endsWith(".ts")) {
        fullPath += ".js";
      }

      // Check if file exists
      if (isNode) {
        if (!fs.existsSync(fullPath)) {
          throw new Error("Flow not found: " + fullPath);
        }
      } else {
        // Bun - use async stat
        try {
          await fs.promises.stat(fullPath);
        } catch {
          throw new Error("Flow not found: " + fullPath);
        }
      }
    }

    // Import the flow function
    let flowFunction;
    if (isNode && typeof require !== "undefined") {
      // Node: try require first (for CommonJS), then dynamic import
      try {
        flowFunction = require(fullPath);
      } catch {
        const flowModule = await import(fullPath);
        flowFunction = flowModule.default || flowModule;
      }
    } else {
      // Deno/Bun: use dynamic import
      const flowModule = await import(fullPath);
      flowFunction = flowModule.default || flowModule;
    }

    // Get environment based on runtime
    const env = isDeno ? Deno.env.toObject() : process.env;

    // Build ctx object with payload, env, and execution context
    const ctx = {
      payload,
      env,
      execution: executionContext,
    };

    const result = await flowFunction(ctx);

    console.log("__RESULT_START__");
    console.log(JSON.stringify(result || {}));
    console.log("__RESULT_END__");
    
    // Exit based on runtime
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

