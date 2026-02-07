# Circuit Breaker Example

This example demonstrates Clier's circuit breaker safety mechanism, which prevents cascading failures by stopping processes that crash repeatedly.

## How It Works

1. **Crasher** - A service that intentionally crashes repeatedly
2. **Monitor** - Triggered when circuit breaker opens, monitors system state
3. **Notify** - Sends an alert when circuit breaker is triggered

## Circuit Breaker Configuration

```json
"circuit_breaker": {
  "enabled": true,
  "error_threshold": 3,      // Open after 3 failures
  "timeout_ms": 5000,         // 5 second window
  "reset_timeout_ms": 10000   // Reset after 10 seconds
}
```

## Pipeline Flow

```
crasher (crashes 3x) --> [circuit-breaker:triggered] --> monitor + notify
```

## Running the Example

Start the pipeline:
```bash
clier start
```

Watch what happens:
1. The `crasher` process starts and crashes
2. PM2 automatically restarts it (default behavior)
3. After 3 crashes within 5 seconds, circuit breaker opens
4. `circuit-breaker:triggered` event is emitted
5. `monitor` service starts to track system state
6. `notify` task runs to send an alert

## Monitoring

Check status:
```bash
clier status
```

View logs:
```bash
clier logs crasher
clier logs monitor
clier logs notify
```

## Expected Output

You should see:
- Crasher logs showing repeated failures
- Circuit breaker event in the event bus
- Monitor service starting and logging system state
- Notify task showing the alert message

## Stopping

```bash
clier stop
```

## Real-World Use Cases

This pattern is useful for:
- **Database connection failures**: Prevent overwhelming a struggling database
- **API endpoint crashes**: Stop hitting a failing external service
- **Resource exhaustion**: Prevent processes from consuming all system resources
- **Cascading failures**: Break the chain of dependent service failures

## Customization

You can adjust:
- `error_threshold`: How many failures before opening
- `timeout_ms`: Time window for counting failures
- `reset_timeout_ms`: How long to wait before trying again
- Notification method in `notify.js` (webhook, email, Slack, etc.)
