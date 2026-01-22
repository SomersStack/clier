# Continue on Failure Example

This example demonstrates how to control pipeline behavior when tasks fail using the `continue_on_failure` flag.

## Two Modes

### Strict Mode (default: `continue_on_failure: false`)
- Task failure BLOCKS dependent tasks
- Use for critical operations (build, deploy, database migrations)
- Ensures pipeline stops on errors

### Lenient Mode (`continue_on_failure: true`)
- Task failure emits failure events BUT dependent tasks still run
- Use for non-critical operations (notifications, logging, metrics)
- Allows graceful degradation

## Pipeline Flow

```
step1-strict (FAILS, blocks step2)
    ├─[step1:failure]─> cleanup
    └─[step1:success]─> step2-blocked (NEVER RUNS)

step3-lenient (FAILS, but emits event)
    ├─[step3:failure]─> step4-continues (RUNS!)
    └─[step3:failure]─> cleanup
```

## Running the Example

Default behavior (both steps fail):
```bash
clier start
```

Watch the logs:
```bash
clier logs step1-strict   # Fails
clier logs step2-blocked  # Never runs (blocked by failure)
clier logs step3-lenient  # Fails, but continues
clier logs step4-continues # Runs despite step3 failure
clier logs cleanup        # Runs due to failure events
```

## Testing Success Path

Modify the config to test success:

```json
{
  "name": "step1-strict",
  "command": "node step1.js",  // Remove "fail" argument
  ...
}
```

Now `step2-blocked` will run!

## Key Differences

| Scenario | Strict Mode | Lenient Mode |
|----------|-------------|--------------|
| Task fails | Pipeline STOPS | Pipeline CONTINUES |
| Failure event | Emitted | Emitted |
| Dependent tasks | BLOCKED | TRIGGERED |
| Exit code | Propagates | Swallowed |

## Real-World Use Cases

### Strict Mode (continue_on_failure: false)
- **Database migrations**: Must succeed before deploying
- **Compilation**: Can't run code if build fails
- **Authentication setup**: Required for app to function
- **Critical config validation**: Must be valid to proceed

### Lenient Mode (continue_on_failure: true)
- **Metrics collection**: Nice to have, but not critical
- **Cache warming**: Can work without cache
- **Notification sending**: Don't block on external services
- **Optional optimizations**: Can function without them

## Best Practices

1. **Default to strict**: Use `continue_on_failure: false` (default) for most tasks
2. **Be explicit**: Always set `continue_on_failure` for clarity
3. **Emit both events**: Emit both success and failure events for flexibility
4. **Cleanup handlers**: Create cleanup tasks that trigger on failure events
5. **Logging**: Always log why a task is continuing despite failure

## Configuration

```json
{
  "name": "my-task",
  "continue_on_failure": true,  // or false
  "events": {
    "on_stdout": [
      { "pattern": "SUCCESS", "emit": "my-task:success" },
      { "pattern": "FAILURE", "emit": "my-task:failure" }
    ]
  }
}
```

## Stopping

```bash
clier stop
```
