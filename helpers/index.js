/**
 * k6 metrics library for JavaScript runtimes (Node.js, Deno, Bun)
 * Allows recording k6 metrics from within JavaScript flows
 */

class Counter {
  constructor(name, collector) {
    this.name = name;
    this.collector = collector;
  }

  add(value = 1, tags = {}) {
    this.collector._recordCounter(this.name, value, tags);
  }
}

class Gauge {
  constructor(name, collector) {
    this.name = name;
    this.collector = collector;
  }

  set(value, tags = {}) {
    this.collector._recordGauge(this.name, value, tags);
  }
}

class Trend {
  constructor(name, collector) {
    this.name = name;
    this.collector = collector;
  }

  add(value, tags = {}) {
    this.collector._recordTrend(this.name, value, tags);
  }
}

class Rate {
  constructor(name, collector) {
    this.name = name;
    this.collector = collector;
  }

  add(value, tags = {}) {
    this.collector._recordRate(this.name, value ? 1 : 0, tags);
  }
}

class MetricsCollector {
  constructor() {
    this.metrics = [];
  }

  counter(name) {
    return new Counter(name, this);
  }

  gauge(name) {
    return new Gauge(name, this);
  }

  trend(name) {
    return new Trend(name, this);
  }

  rate(name) {
    return new Rate(name, this);
  }

  _recordCounter(name, value, tags) {
    this.metrics.push({ type: "counter", name, value, tags });
  }

  _recordGauge(name, value, tags) {
    this.metrics.push({ type: "gauge", name, value, tags });
  }

  _recordTrend(name, value, tags) {
    this.metrics.push({ type: "trend", name, value, tags });
  }

  _recordRate(name, value, tags) {
    this.metrics.push({ type: "rate", name, value, tags });
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

// Detect runtime for environment access
const isDeno = typeof Deno !== "undefined";
const getEnv = () => {
  if (isDeno) {
    return Deno.env.toObject();
  }
  return typeof process !== "undefined" ? process.env : {};
};

// Current execution context (per-execution collectors)
let currentMetrics = null;
let currentChecks = null;

// Module-level API objects that delegate to current execution
const metricsAPI = {
  counter(name) {
    if (!currentMetrics) throw new Error("metrics can only be used inside run()");
    return currentMetrics.counter(name);
  },
  gauge(name) {
    if (!currentMetrics) throw new Error("metrics can only be used inside run()");
    return currentMetrics.gauge(name);
  },
  trend(name) {
    if (!currentMetrics) throw new Error("metrics can only be used inside run()");
    return currentMetrics.trend(name);
  },
  rate(name) {
    if (!currentMetrics) throw new Error("metrics can only be used inside run()");
    return currentMetrics.rate(name);
  },
};

const checksAPI = {
  check(name, condition) {
    if (!currentChecks) throw new Error("checks can only be used inside run()");
    return currentChecks.check(name, condition);
  },
};

/**
 * Wrapper function to create k6-compatible JavaScript flows
 * Works with Node.js, Deno, and Bun
 *
 * Usage (Node.js CommonJS):
 *   const { run, metrics, checks } = require("xk6-external-js-helpers");
 *   module.exports = run(async (ctx) => {
 *     const user = ctx.payload.user;
 *     metrics.counter("my_counter").add(1);
 *     checks.check("user_exists", user !== undefined);
 *     console.log(`VU ${ctx.execution.vu.id}, Iteration ${ctx.execution.vu.iteration}`);
 *     return { result: "data" };
 *   });
 *
 * Usage (ES Modules - Node.js/Deno/Bun):
 *   import { run, metrics, checks } from "xk6-external-js-helpers";
 *   export default run(async (ctx) => {
 *     const user = ctx.payload.user;
 *     metrics.counter("my_counter").add(1);
 *     checks.check("user_exists", user !== undefined);
 *     console.log(`VU ${ctx.execution.vu.id}, Iteration ${ctx.execution.vu.iteration}`);
 *     return { result: "data" };
 *   });
 */
export function run(fn) {
  return async function (ctx = {}) {
    // Create fresh collectors for this execution
    const metrics = new MetricsCollector();
    const checks = new ChecksCollector();
    
    // Set as current execution context
    const prevMetrics = currentMetrics;
    const prevChecks = currentChecks;
    currentMetrics = metrics;
    currentChecks = checks;
    
    try {
      // Build ctx object with only raw data (payload, env, execution)
      const fullCtx = {
        payload: ctx.payload || {},
        env: ctx.env || getEnv(),
        execution: ctx.execution || {
          vu: { id: 0, iteration: 0, scenario: "" },
        },
      };

      const result = await fn(fullCtx);

      const safeResult = result && typeof result === "object" ? result : {};
      const metricsData = metrics._collect();
      if (metricsData.length > 0) {
        safeResult.__k6_metrics__ = metricsData;
      }
      
      // Add checks to result if any were recorded
      if (checks.checks.length > 0) {
        safeResult.__k6_checks__ = checks.checks;
      }

      return safeResult;
    } finally {
      // Restore previous execution context
      currentMetrics = prevMetrics;
      currentChecks = prevChecks;
    }
  };
}

// Export module-level APIs
export const metrics = metricsAPI;
export const checks = checksAPI;

// Also export as CommonJS for Node.js compatibility
if (typeof module !== "undefined" && module.exports) {
  module.exports = { run, metrics, checks };
}

