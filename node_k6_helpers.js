/**
 * k6 metrics library for Node.js
 * Allows recording k6 metrics from within Node.js flows
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

/**
 * Wrapper function to create k6-compatible Node.js flows
 *
 * Usage:
 *   const { run } = require("../node_k6_helpers");
 *   module.exports = run(async ({ payload, metrics, env, logger }) => {
 *     const myCounter = metrics.counter("my_counter");
 *     myCounter.add(1);
 *     logger.info("Hello from Node!", env.NODE_ENV);
 *     return { result: "data" };
 *   });
 */
function run(fn) {
  return async function (payload, ctx = {}) {
    const metrics = new MetricsCollector();
    const env = ctx.env || process.env;
    const logger = ctx.logger || console;

    const result = await fn({ payload, metrics, env, logger });

    const safeResult = result && typeof result === "object" ? result : {};
    const metricsData = metrics._collect();
    if (metricsData.length > 0) {
      safeResult.__k6_metrics__ = metricsData;
    }

    return safeResult;
  };
}

module.exports = { run };
