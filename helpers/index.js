// Metrics and checks APIs that reference the global APIs set up by js_runner.js

const metricsAPI = {
  counter(name) {
    if (typeof globalThis !== "undefined" && globalThis.metrics) {
      return globalThis.metrics.counter(name);
    }
    if (typeof global !== "undefined" && global.metrics) {
      return global.metrics.counter(name);
    }
    throw new Error("metrics can only be used inside handler");
  },
  gauge(name) {
    if (typeof globalThis !== "undefined" && globalThis.metrics) {
      return globalThis.metrics.gauge(name);
    }
    if (typeof global !== "undefined" && global.metrics) {
      return global.metrics.gauge(name);
    }
    throw new Error("metrics can only be used inside handler");
  },
  trend(name) {
    if (typeof globalThis !== "undefined" && globalThis.metrics) {
      return globalThis.metrics.trend(name);
    }
    if (typeof global !== "undefined" && global.metrics) {
      return global.metrics.trend(name);
    }
    throw new Error("metrics can only be used inside handler");
  },
  rate(name) {
    if (typeof globalThis !== "undefined" && globalThis.metrics) {
      return globalThis.metrics.rate(name);
    }
    if (typeof global !== "undefined" && global.metrics) {
      return global.metrics.rate(name);
    }
    throw new Error("metrics can only be used inside handler");
  },
};

const checksAPI = {
  check(name, condition) {
    if (typeof globalThis !== "undefined" && globalThis.checks) {
      return globalThis.checks.check(name, condition);
    }
    if (typeof global !== "undefined" && global.checks) {
      return global.checks.check(name, condition);
    }
    throw new Error("checks can only be used inside handler");
  },
};

export const metrics = metricsAPI;
export const checks = checksAPI;

if (typeof module !== "undefined" && module.exports) {
  module.exports = { metrics, checks };
}

