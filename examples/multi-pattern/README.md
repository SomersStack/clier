# Multi-Pattern Event Matching Example

This example demonstrates how a single process can emit MULTIPLE events by matching MULTIPLE patterns in its output.

## Key Feature

When a process outputs text, Clier checks ALL patterns and emits ALL matching events, not just the first match. This allows for sophisticated event-driven architectures.

## Pipeline Flow

```
analyzer (outputs multiple log levels)
    ├─[INFO] ─> info-logger
    ├─[WARN] ─> warn-logger
    ├─[ERROR]─> error-logger
    └─[Analysis complete] ─> report
```

## Pattern Configuration

```json
"events": {
  "on_stdout": [
    { "pattern": "\\[INFO\\]", "emit": "log:info" },
    { "pattern": "\\[WARN\\]", "emit": "log:warn" },
    { "pattern": "\\[ERROR\\]", "emit": "log:error" },
    { "pattern": "Analysis complete", "emit": "analysis:done" }
  ]
}
```

## How It Works

1. The `analyzer` process outputs multiple log lines with different levels
2. Each line is checked against ALL patterns
3. If a line contains `[INFO]`, `log:info` event is emitted
4. If a line contains `[WARN]`, `log:warn` event is emitted
5. If a line contains `[ERROR]`, `log:error` event is emitted
6. When "Analysis complete" appears, `analysis:done` event is emitted
7. Each event triggers its respective handler

## Running the Example

Start the pipeline:
```bash
clier start
```

Watch the logs:
```bash
clier logs analyzer        # See the analysis output
clier logs info-logger     # See INFO event handlers
clier logs warn-logger     # See WARN event handlers
clier logs error-logger    # See ERROR event handlers
clier logs report          # See final report
```

## Expected Behavior

The analyzer will output:
- Multiple `[INFO]` messages → Multiple `info-logger` triggers
- Multiple `[WARN]` messages → Multiple `warn-logger` triggers
- At least one `[ERROR]` message → At least one `error-logger` trigger
- One "Analysis complete" message → One `report` trigger

## Real-World Use Cases

### Log Aggregation
Different log levels trigger different handlers:
- INFO → Write to file
- WARN → Send to monitoring service
- ERROR → Page on-call engineer

### Build Process
Multiple events from a single build:
- "Compilation started" → Show status
- "Tests passed" → Update dashboard
- "Coverage: 85%" → Update metrics
- "Build complete" → Deploy

### Data Pipeline
Track progress through stages:
- "Ingestion: 100%" → Start transformation
- "Validation: PASS" → Update status
- "Export: Complete" → Send notification
- "Cleanup: Done" → Mark job finished

### Microservice Health
Monitor multiple health indicators:
- "CPU: 50%" → Update metrics
- "Memory: OK" → Clear alert
- "Requests/sec: 1000" → Scale decision
- "Health check: PASS" → Update load balancer

## Pattern Tips

1. **Escape regex**: Use `\\[` for literal `[` characters
2. **Be specific**: Avoid overly broad patterns
3. **Order matters**: More specific patterns should come first
4. **Test patterns**: Verify regex matches expected output
5. **Use anchors**: `^` and `$` for start/end of line

## Common Patterns

```javascript
// Version detection
{ "pattern": "v\\d+\\.\\d+\\.\\d+", "emit": "version:detected" }

// Percentage tracking
{ "pattern": "\\d+%", "emit": "progress:update" }

// Error codes
{ "pattern": "ERR_\\w+", "emit": "error:specific" }

// URLs
{ "pattern": "https?://\\S+", "emit": "url:found" }

// JSON output
{ "pattern": "\\{.*\\}", "emit": "json:data" }
```

## Stopping

```bash
clier stop
```
