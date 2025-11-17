package js

import (
	"context"
	_ "embed"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"regexp"
	"strings"
	"time"

	"go.k6.io/k6/js/modules"
	"go.k6.io/k6/metrics"
)

//go:embed js_runner.js
var jsRunnerScript string

// init is called by the Go runtime at application startup.
func init() {
	modules.Register("k6/x/js", &JSModule{})
}

// JSModule is the root module for the JavaScript runtime interop extension
type JSModule struct{}

// NewModuleInstance creates a new instance of the module for each VU
func (*JSModule) NewModuleInstance(vu modules.VU) modules.Instance {
	registry := vu.InitEnv().Registry

	return &JS{
		vu:            vu,
		jsDuration:    registry.MustNewMetric("js_duration", metrics.Trend, metrics.Time),
		customMetrics: make(map[string]*metrics.Metric),
		registry:      registry,
	}
}

// JS is the type for our JavaScript runtime interop API.
type JS struct {
	vu            modules.VU
	jsDuration    *metrics.Metric
	customMetrics map[string]*metrics.Metric
	registry      *metrics.Registry
}

// Exports returns the exports of the module
func (j *JS) Exports() modules.Exports {
	return modules.Exports{
		Default: j,
	}
}

// RunOptions represents the internal options we derive from js.run(...)
type RunOptions struct {
	Runtime string            `json:"runtime"`
	Entry   string            `json:"entry"`
	Payload interface{}       `json:"payload"`
	Env     map[string]string `json:"env"`
	Timeout string            `json:"timeout"`
}

// Run executes a JavaScript flow and returns the result.
//
// Supports both:
//
//	js.run("lib.js", { user: "alice" })
//
// and the "advanced" form:
//
//	js.run("lib.js", {
//	  payload: { user: "alice" },
//	  env: { NODE_ENV: "production" },
//	  timeout: "5s",
//	  runtime: "node", // "node", "deno", or "bun"
//	})
func (j *JS) Run(flowPath string, payloadOrOptions interface{}) (map[string]interface{}, error) {
	// 1) Interpret second argument
	opts, err := parseRunOptionsFromArgs(flowPath, payloadOrOptions)
	if err != nil {
		return nil, err
	}

	// Default runtime
	if opts.Runtime == "" {
		opts.Runtime = "node"
	}

	// Validate runtime
	validRuntimes := map[string]bool{"node": true, "deno": true, "bun": true}
	if !validRuntimes[opts.Runtime] {
		return nil, fmt.Errorf("unsupported runtime %q (supported: node, deno, bun)", opts.Runtime)
	}

	if opts.Entry == "" {
		opts.Entry = flowPath
	}

	// 2) Serialize payload to JSON
	payloadBytes, err := json.Marshal(opts.Payload)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal payload: %w", err)
	}

	// 3) Build context with optional timeout
	ctx := j.vu.Context()
	if ctx == nil {
		ctx = context.Background()
	}

	if opts.Timeout != "" {
		d, err := time.ParseDuration(opts.Timeout)
		if err != nil {
			return nil, fmt.Errorf("invalid timeout value %q: %w", opts.Timeout, err)
		}
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, d)
		defer cancel()
	}

	// 4) Execute JavaScript runtime with embedded runner script
	var cmd *exec.Cmd
	switch opts.Runtime {
	case "node":
		// node -e <runnerScript> <entry> <payloadJson>
		cmd = exec.CommandContext(ctx, "node", "-e", jsRunnerScript, opts.Entry, string(payloadBytes))
	case "deno":
		// deno run --allow-all - (with entry and payload in env vars)
		cmd = exec.CommandContext(ctx, "deno", "run", "--allow-all", "-")
		cmd.Stdin = strings.NewReader(jsRunnerScript)
	case "bun":
		// bun -e <runnerScript> <entry> <payloadJson>
		cmd = exec.CommandContext(ctx, "bun", "-e", jsRunnerScript, opts.Entry, string(payloadBytes))
	default:
		return nil, fmt.Errorf("unsupported runtime: %s", opts.Runtime)
	}

	// 5) Env: base env + overrides
	env := os.Environ()
	for k, v := range opts.Env {
		env = append(env, fmt.Sprintf("%s=%s", k, v))
	}
	// Set env vars for Deno before assigning to cmd
	if opts.Runtime == "deno" {
		env = append(env, fmt.Sprintf("XK6_JS_ENTRY=%s", opts.Entry))
		env = append(env, fmt.Sprintf("XK6_JS_PAYLOAD=%s", string(payloadBytes)))
	}
	cmd.Env = env

	start := time.Now()
	output, err := cmd.CombinedOutput()
	duration := time.Since(start)

	// 6) Record the duration metric
	state := j.vu.State()
	if state != nil {
		metricTags := state.Tags.GetCurrentValues().Tags.WithTagsFromMap(
			map[string]string{"flow": opts.Entry, "runtime": opts.Runtime},
		)

		metrics.PushIfNotDone(j.vu.Context(), state.Samples, metrics.Sample{
			TimeSeries: metrics.TimeSeries{
				Metric: j.jsDuration,
				Tags:   metricTags,
			},
			Time:  time.Now(),
			Value: float64(duration.Milliseconds()),
		})
	}

	// Handle timeout separately
	if ctx.Err() == context.DeadlineExceeded {
		return nil, fmt.Errorf("%s runtime timed out after %s (entry=%s): %w\nOutput: %s",
			opts.Runtime, opts.Timeout, opts.Entry, ctx.Err(), string(output))
	}

	if err != nil {
		return nil, fmt.Errorf("failed to execute %s flow (entry=%s): %w\nOutput: %s",
			opts.Runtime, opts.Entry, err, string(output))
	}

	// 7) Extract result from output
	result, err := extractResult(string(output))
	if err != nil {
		return nil, fmt.Errorf("failed to extract result: %w\nOutput: %s", err, string(output))
	}

	// 8) Automatically record metrics from JavaScript runtime (__k6_metrics__)
	if metricsArray, ok := result["__k6_metrics__"].([]interface{}); ok {
		if state != nil {
			for _, metricEntry := range metricsArray {
				metricData, ok := metricEntry.(map[string]interface{})
				if !ok {
					continue
				}

				metricName, _ := metricData["name"].(string)
				metricType, _ := metricData["type"].(string)
				metricValue := j.extractMetricValue(metricData["value"])
				if metricValue == 0 && metricData["value"] != nil && metricData["value"] != 0.0 {
					continue
				}

				// Get or create the metric with appropriate type
				metric, exists := j.customMetrics[metricName]
				if !exists {
					var metricKind metrics.MetricType
					switch metricType {
					case "counter":
						metricKind = metrics.Counter
					case "gauge":
						metricKind = metrics.Gauge
					case "trend":
						metricKind = metrics.Trend
					case "rate":
						metricKind = metrics.Rate
					default:
						metricKind = metrics.Counter
					}
					metric = j.registry.MustNewMetric(metricName, metricKind)
					j.customMetrics[metricName] = metric
				}

				// Parse custom tags
				tagsMap := make(map[string]string)
				if tagsData, ok := metricData["tags"].(map[string]interface{}); ok {
					for k, v := range tagsData {
						if strVal, ok := v.(string); ok {
							tagsMap[k] = strVal
						}
					}
				}

				// Merge with state tags
				metricTags := state.Tags.GetCurrentValues().Tags.WithTagsFromMap(tagsMap)

				metrics.PushIfNotDone(j.vu.Context(), state.Samples, metrics.Sample{
					TimeSeries: metrics.TimeSeries{
						Metric: metric,
						Tags:   metricTags,
					},
					Time:  time.Now(),
					Value: metricValue,
				})
			}
		}

		delete(result, "__k6_metrics__")
	}

	return result, nil
}

// parseRunOptionsFromArgs interprets the second argument to js.run().
//
// If the second argument is a plain value (e.g. { user: "alice" }),
// it becomes the payload.
//
// If it's a map with any of the special keys (payload, env, timeout, runtime),
// it's treated as an options object.
func parseRunOptionsFromArgs(entry string, arg interface{}) (*RunOptions, error) {
	opts := &RunOptions{
		Runtime: "node",
		Entry:   entry,
		Payload: arg,
		Env:     make(map[string]string),
	}

	// Only maps can be "options objects"
	rawMap, ok := arg.(map[string]interface{})
	if !ok {
		// Not a map => treat as plain payload
		return opts, nil
	}

	// Detect if this looks like an "options" object
	_, hasPayload := rawMap["payload"]
	_, hasEnv := rawMap["env"]
	_, hasTimeout := rawMap["timeout"]
	_, hasRuntime := rawMap["runtime"]

	isOptions := hasPayload || hasEnv || hasTimeout || hasRuntime
	if !isOptions {
		// Map but no special keys => treat whole map as payload
		return opts, nil
	}

	// Now we treat it as { payload?, env?, timeout?, runtime? }
	if v, ok := rawMap["runtime"].(string); ok {
		opts.Runtime = v
	}

	if v, ok := rawMap["entry"].(string); ok && v != "" {
		opts.Entry = v
	}

	if v, ok := rawMap["payload"]; ok {
		opts.Payload = v
	}

	if v, ok := rawMap["timeout"].(string); ok {
		opts.Timeout = v
	}

	if rawEnv, ok := rawMap["env"].(map[string]interface{}); ok {
		for k, v := range rawEnv {
			if s, ok := v.(string); ok {
				opts.Env[k] = s
			}
		}
	}

	return opts, nil
}

// extractMetricValue converts interface{} to float64 for metrics
func (j *JS) extractMetricValue(value interface{}) float64 {
	switch v := value.(type) {
	case float64:
		return v
	case int:
		return float64(v)
	case int64:
		return float64(v)
	case json.Number:
		f, _ := v.Float64()
		return f
	default:
		return 0
	}
}

// extractResult parses the JSON result from JavaScript runtime output
func extractResult(output string) (map[string]interface{}, error) {
	// Find content between __RESULT_START__ and __RESULT_END__
	re := regexp.MustCompile(`__RESULT_START__\s*([\s\S]*?)\s*__RESULT_END__`)
	matches := re.FindStringSubmatch(output)

	if len(matches) < 2 {
		return nil, fmt.Errorf("result markers not found in output")
	}

	resultJSON := strings.TrimSpace(matches[1])

	var result map[string]interface{}
	if err := json.Unmarshal([]byte(resultJSON), &result); err != nil {
		return nil, fmt.Errorf("failed to unmarshal result: %w", err)
	}

	return result, nil
}
