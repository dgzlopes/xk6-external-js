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
var runnerScript string

// init is called by the Go runtime at application startup.
func init() {
	modules.Register("k6/x/external_js", &ExternalJSModule{})
}

// ExternalJSModule is the root module for the external JavaScript runtime interop extension
type ExternalJSModule struct{}

// NewModuleInstance creates a new instance of the module for each VU
func (*ExternalJSModule) NewModuleInstance(vu modules.VU) modules.Instance {
	registry := vu.InitEnv().Registry

	return &ExternalJS{
		vu:                  vu,
		jsIterationDuration: registry.MustNewMetric("external_js_iteration_duration", metrics.Trend, metrics.Time),
		jsIterations:        registry.MustNewMetric("external_js_iterations", metrics.Counter),
		customMetrics:       make(map[string]*metrics.Metric),
		registry:            registry,
	}
}

// ExternalJS is the type for our external JavaScript runtime interop API.
type ExternalJS struct {
	vu                  modules.VU
	jsIterationDuration *metrics.Metric
	jsIterations        *metrics.Metric
	customMetrics       map[string]*metrics.Metric
	registry            *metrics.Registry
}

// Exports returns the exports of the module
func (j *ExternalJS) Exports() modules.Exports {
	return modules.Exports{
		Default: j,
	}
}

// getExecutionContext extracts k6 execution context from VU state
func (j *ExternalJS) getExecutionContext() map[string]interface{} {
	state := j.vu.State()
	if state == nil {
		return map[string]interface{}{
			"vu": map[string]interface{}{
				"id":        int64(0),
				"iteration": int64(0),
			},
		}
	}

	// Extract scenario from tags if available
	scenario := ""
	if state.Tags != nil {
		tags := state.Tags.GetCurrentValues().Tags
		if scenarioTag, ok := tags.Get("scenario"); ok && scenarioTag != "" {
			scenario = scenarioTag
		}
	}

	return map[string]interface{}{
		"vu": map[string]interface{}{
			"id":        int64(state.VUID),
			"iteration": int64(state.Iteration),
			"scenario":  scenario,
		},
	}
}

// RunOptions represents the internal options we derive from ext.run(...)
type RunOptions struct {
	Runtime string            `json:"runtime"`
	Entry   string            `json:"entry"`
	Payload interface{}       `json:"payload"`
	Env     map[string]string `json:"env"`
	Timeout string            `json:"timeout"`
}

// Run executes an external JavaScript flow and returns the result.
//
// Supports both:
//
//	ext.run("lib.js", { user: "alice" })
//
// and the "advanced" form:
//
//	ext.run("lib.js", {
//	  payload: { user: "alice" },
//	  env: { NODE_ENV: "production" },
//	  timeout: "5s",
//	  runtime: "node", // "node", "deno", or "bun"
//	})
//
// Runtime auto-detection: If runtime is not explicitly set, it will be
// auto-detected from the filename pattern:
//   - *.node.js or *.node.ts → "node"
//   - *.deno.js or *.deno.ts → "deno"
//   - *.bun.js or *.bun.ts → "bun"
//
// If no pattern matches, defaults to "node".
func (j *ExternalJS) Run(flowPath string, payloadOrOptions interface{}) (map[string]interface{}, error) {
	opts, err := parseRunOptionsFromArgs(flowPath, payloadOrOptions)
	if err != nil {
		return nil, err
	}

	if opts.Runtime == "" {
		filenameToCheck := opts.Entry
		if filenameToCheck == "" {
			filenameToCheck = flowPath
		}
		opts.Runtime = detectRuntimeFromFilename(filenameToCheck)
	}

	if opts.Runtime == "" {
		opts.Runtime = "node"
	}

	validRuntimes := map[string]bool{"node": true, "deno": true, "bun": true}
	if !validRuntimes[opts.Runtime] {
		return nil, fmt.Errorf("unsupported runtime %q (supported: node, deno, bun)", opts.Runtime)
	}

	if opts.Entry == "" {
		opts.Entry = flowPath
	}

	payloadBytes, err := json.Marshal(opts.Payload)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal payload: %w", err)
	}

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

	execContext := j.getExecutionContext()
	execContextBytes, err := json.Marshal(execContext)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal execution context: %w", err)
	}

	var cmd *exec.Cmd
	switch opts.Runtime {
	case "node":
		cmd = exec.CommandContext(ctx, "node", "-e", runnerScript, opts.Entry, string(payloadBytes), string(execContextBytes))
	case "deno":
		// --allow-all enables npm: specifier imports and all other permissions
		// The script is piped via stdin, arguments come after -
		cmd = exec.CommandContext(ctx, "deno", "run", "--allow-all", "-", opts.Entry, string(payloadBytes), string(execContextBytes))
		cmd.Stdin = strings.NewReader(runnerScript)
		// Set working directory to ensure relative imports and npm packages resolve correctly
		if wd, err := os.Getwd(); err == nil {
			cmd.Dir = wd
		}
	case "bun":
		cmd = exec.CommandContext(ctx, "bun", "-e", runnerScript, opts.Entry, string(payloadBytes), string(execContextBytes))
	default:
		return nil, fmt.Errorf("unsupported runtime: %s", opts.Runtime)
	}

	env := os.Environ()
	for k, v := range opts.Env {
		env = append(env, fmt.Sprintf("%s=%s", k, v))
	}
	cmd.Env = env

	start := time.Now()
	output, err := cmd.CombinedOutput()
	duration := time.Since(start)

	state := j.vu.State()
	if state != nil {
		metricTags := state.Tags.GetCurrentValues().Tags.WithTagsFromMap(
			map[string]string{"flow": opts.Entry, "runtime": opts.Runtime},
		)

		metrics.PushIfNotDone(j.vu.Context(), state.Samples, metrics.Sample{
			TimeSeries: metrics.TimeSeries{
				Metric: j.jsIterationDuration,
				Tags:   metricTags,
			},
			Time:  time.Now(),
			Value: float64(duration.Milliseconds()),
		})
	}

	if ctx.Err() == context.DeadlineExceeded {
		return nil, fmt.Errorf("%s runtime timed out after %s (entry=%s): %w\nOutput: %s",
			opts.Runtime, opts.Timeout, opts.Entry, ctx.Err(), string(output))
	}

	if err != nil {
		return nil, fmt.Errorf("failed to execute %s flow (entry=%s): %w\nOutput: %s",
			opts.Runtime, opts.Entry, err, string(output))
	}

	result, err := extractResult(string(output))
	if err != nil {
		return nil, fmt.Errorf("failed to extract result: %w\nOutput: %s", err, string(output))
	}

	if state != nil {
		metricTags := state.Tags.GetCurrentValues().Tags.WithTagsFromMap(
			map[string]string{"flow": opts.Entry, "runtime": opts.Runtime},
		)

		metrics.PushIfNotDone(j.vu.Context(), state.Samples, metrics.Sample{
			TimeSeries: metrics.TimeSeries{
				Metric: j.jsIterations,
				Tags:   metricTags,
			},
			Time:  time.Now(),
			Value: 1,
		})
	}

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

				tagsMap := make(map[string]string)
				if tagsData, ok := metricData["tags"].(map[string]interface{}); ok {
					for k, v := range tagsData {
						if strVal, ok := v.(string); ok {
							tagsMap[k] = strVal
						}
					}
				}

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

	// Record checks as rate metrics (k6 checks are rate metrics under the hood)
	if checksArray, ok := result["__k6_checks__"].([]interface{}); ok {
		if state != nil {
			checkMetric, exists := j.customMetrics["checks"]
			if !exists {
				checkMetric = j.registry.MustNewMetric("checks", metrics.Rate)
				j.customMetrics["checks"] = checkMetric
			}

			for _, checkEntry := range checksArray {
				checkData, ok := checkEntry.(map[string]interface{})
				if !ok {
					continue
				}

				checkName, _ := checkData["name"].(string)
				checkOk, _ := checkData["ok"].(bool)

				if checkName == "" {
					continue
				}

				// k6 checks use the check name as a tag
				checkValue := 0.0
				if checkOk {
					checkValue = 1.0
				}

				metricTags := state.Tags.GetCurrentValues().Tags.WithTagsFromMap(
					map[string]string{"check": checkName},
				)

				metrics.PushIfNotDone(j.vu.Context(), state.Samples, metrics.Sample{
					TimeSeries: metrics.TimeSeries{
						Metric: checkMetric,
						Tags:   metricTags,
					},
					Time:  time.Now(),
					Value: checkValue,
				})
			}
		}

		delete(result, "__k6_checks__")
	}

	return result, nil
}

// parseRunOptionsFromArgs interprets the second argument to ext.run().
//
// If the second argument is a plain value (e.g. { user: "alice" }),
// it becomes the payload.
//
// If it's a map with any of the special keys (payload, env, timeout, runtime),
// it's treated as an options object.
func parseRunOptionsFromArgs(entry string, arg interface{}) (*RunOptions, error) {
	opts := &RunOptions{
		Runtime: "",
		Entry:   entry,
		Payload: arg,
		Env:     make(map[string]string),
	}

	rawMap, ok := arg.(map[string]interface{})
	if !ok {
		return opts, nil
	}

	_, hasPayload := rawMap["payload"]
	_, hasEnv := rawMap["env"]
	_, hasTimeout := rawMap["timeout"]
	_, hasRuntime := rawMap["runtime"]

	isOptions := hasPayload || hasEnv || hasTimeout || hasRuntime
	if !isOptions {
		return opts, nil
	}
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
func (j *ExternalJS) extractMetricValue(value interface{}) float64 {
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

// detectRuntimeFromFilename detects the runtime from filename patterns like *.node.js, *.deno.ts, *.bun.js.
// The runtime identifier must appear immediately before the file extension.
func detectRuntimeFromFilename(filename string) string {
	if filename == "" {
		return ""
	}

	lower := strings.ToLower(filename)
	runtimeRegex := regexp.MustCompile(`\.(node|deno|bun)\.(js|ts|mjs|cjs)$`)
	matches := runtimeRegex.FindStringSubmatch(lower)

	if len(matches) >= 2 {
		return matches[1]
	}

	return ""
}

// extractResult parses the JSON result from external JavaScript runtime output
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
