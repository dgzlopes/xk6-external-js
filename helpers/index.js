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

const isDeno = typeof Deno !== "undefined";
const getEnv = () => {
  if (isDeno) {
    return Deno.env.toObject();
  }
  return typeof process !== "undefined" ? process.env : {};
};

let currentMetrics = null;
let currentChecks = null;

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

export function run(fn) {
  return async function (ctx = {}) {
    const metrics = new MetricsCollector();
    const checks = new ChecksCollector();
    
    const prevMetrics = currentMetrics;
    const prevChecks = currentChecks;
    currentMetrics = metrics;
    currentChecks = checks;
    
    try {
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
      
      if (checks.checks.length > 0) {
        safeResult.__k6_checks__ = checks.checks;
      }

      return safeResult;
    } finally {
      currentMetrics = prevMetrics;
      currentChecks = prevChecks;
    }
  };
}

export const metrics = metricsAPI;
export const checks = checksAPI;

if (typeof module !== "undefined" && module.exports) {
  module.exports = { run, metrics, checks };
}

