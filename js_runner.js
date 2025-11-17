const isDeno = typeof Deno !== "undefined";
const isBun = typeof Bun !== "undefined";
const isNode = !isDeno && !isBun && typeof process !== "undefined" && process.versions?.node;

// Helper function to create metrics and checks wrapper
function createMetricsAndChecksWrapper(handler) {
  let currentMetrics = null;
  let currentChecks = null;

  class MetricsCollector {
    constructor() {
      this.metrics = [];
    }

    counter(name) {
      return {
        add: (value = 1, tags = {}) => {
          this.metrics.push({ type: "counter", name, value, tags });
        },
      };
    }

    gauge(name) {
      return {
        set: (value, tags = {}) => {
          this.metrics.push({ type: "gauge", name, value, tags });
        },
      };
    }

    trend(name) {
      return {
        add: (value, tags = {}) => {
          this.metrics.push({ type: "trend", name, value, tags });
        },
      };
    }

    rate(name) {
      return {
        add: (value, tags = {}) => {
          this.metrics.push({ type: "rate", name, value, tags });
        },
      };
    }

    _collect() {
      return this.metrics;
    }
  }

  class ChecksCollector {
    constructor() {
      this.checks = [];
    }

    check(name, condition) {
      this.checks.push({ name, ok: Boolean(condition) });
    }
  }

  // Create global metrics/checks APIs
  const metricsAPI = {
    counter(name) {
      if (!currentMetrics) throw new Error("metrics can only be used inside handler");
      return currentMetrics.counter(name);
    },
    gauge(name) {
      if (!currentMetrics) throw new Error("metrics can only be used inside handler");
      return currentMetrics.gauge(name);
    },
    trend(name) {
      if (!currentMetrics) throw new Error("metrics can only be used inside handler");
      return currentMetrics.trend(name);
    },
    rate(name) {
      if (!currentMetrics) throw new Error("metrics can only be used inside handler");
      return currentMetrics.rate(name);
    },
  };

  const checksAPI = {
    check(name, condition) {
      if (!currentChecks) throw new Error("checks can only be used inside handler");
      return currentChecks.check(name, condition);
    },
  };

  // Make metrics/checks available globally
  if (typeof globalThis !== "undefined") {
    globalThis.metrics = metricsAPI;
    globalThis.checks = checksAPI;
  }
  if (typeof global !== "undefined") {
    global.metrics = metricsAPI;
    global.checks = checksAPI;
  }

  return async function(ctx) {
    const metricsCollector = new MetricsCollector();
    const checksCollector = new ChecksCollector();
    
    const prevMetrics = currentMetrics;
    const prevChecks = currentChecks;
    currentMetrics = metricsCollector;
    currentChecks = checksCollector;
    
    try {
      const result = await handler(ctx);
      
      const safeResult = result && typeof result === "object" ? result : {};
      const metricsData = metricsCollector._collect();
      if (metricsData.length > 0) {
        safeResult.__k6_metrics__ = metricsData;
      }
      
      if (checksCollector.checks.length > 0) {
        safeResult.__k6_checks__ = checksCollector.checks;
      }
      
      return safeResult;
    } finally {
      currentMetrics = prevMetrics;
      currentChecks = prevChecks;
    }
  };
}

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
        // Check for handler export first
        if (required && typeof required.handler === "function") {
          flowFunction = createMetricsAndChecksWrapper(required.handler);
        } else if (typeof required === "function") {
          flowFunction = required;
        } else if (required && typeof required.default === "function") {
          flowFunction = required.default;
        } else {
          const flowModule = await import(fullPath);
          if (flowModule.handler && typeof flowModule.handler === "function") {
            flowFunction = createMetricsAndChecksWrapper(flowModule.handler);
          } else {
            flowFunction = flowModule.default || flowModule;
          }
        }
      } catch {
        const flowModule = await import(fullPath);
        if (flowModule.handler && typeof flowModule.handler === "function") {
          flowFunction = createMetricsAndChecksWrapper(flowModule.handler);
        } else {
          flowFunction = flowModule.default || flowModule;
        }
      }
    } else {
      const flowModule = await import(fullPath);
      if (flowModule.handler && typeof flowModule.handler === "function") {
        flowFunction = createMetricsAndChecksWrapper(flowModule.handler);
      } else if (flowModule.default && typeof flowModule.default === "function") {
        flowFunction = flowModule.default;
      } else {
        flowFunction = flowModule.default || flowModule;
      }
    }

    if (typeof flowFunction !== "function") {
      throw new Error(`Expected a function or handler export but got ${typeof flowFunction}. Make sure your module exports a handler function (export const handler = ...) or a default function.`);
    }

    const env = isDeno ? Deno.env.toObject() : process.env;

    // Flatten context structure for easier destructuring
    const vu = executionContext.vu || { id: 0, iteration: 0, scenario: "" };
    const ctx = {
      payload,
      env,
      vu,
      iteration: vu.iteration,
      execution: executionContext, // Keep for backward compatibility if needed
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

