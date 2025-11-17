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

// Detect runtime for environment access
const isDeno = typeof Deno !== "undefined";
const getEnv = () => {
  if (isDeno) {
    return Deno.env.toObject();
  }
  return typeof process !== "undefined" ? process.env : {};
};

/**
 * Wrapper function to create k6-compatible JavaScript flows
 * Works with Node.js, Deno, and Bun
 *
 * Usage (Node.js CommonJS):
 *   const { run } = require("xk6-external-js-helpers");
 *   module.exports = run(async (ctx) => {
 *     const user = ctx.payload.user;
 *     ctx.metrics.counter("my_counter").add(1);
 *     console.log(`VU ${ctx.execution.vu.id}, Iteration ${ctx.execution.vu.iteration}`);
 *     return { result: "data" };
 *   });
 *
 * Usage (ES Modules - Node.js/Deno/Bun):
 *   import { run } from "xk6-external-js-helpers";
 *   export default run(async (ctx) => {
 *     const user = ctx.payload.user;
 *     ctx.metrics.counter("my_counter").add(1);
 *     console.log(`VU ${ctx.execution.vu.id}, Iteration ${ctx.execution.vu.iteration}`);
 *     return { result: "data" };
 *   });
 */
export function run(fn) {
  return async function (ctx = {}) {
    // Ensure ctx has required structure
    const metrics = new MetricsCollector();
    
    // Build full ctx object with metrics
    const fullCtx = {
      payload: ctx.payload || {},
      metrics: metrics,
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

    return safeResult;
  };
}

// Also export as CommonJS for Node.js compatibility
if (typeof module !== "undefined" && module.exports) {
  module.exports = { run };
}

