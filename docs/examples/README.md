# Clier Examples

This directory contains working examples demonstrating different Clier features and patterns.

## Available Examples

### 1. Lint → Build → API Pipeline

**Location**: `examples/lint-build-api/`

**What it demonstrates**:
- Sequential task execution
- Event-driven triggers
- Transition from tasks to services
- Pattern matching for success detection

**Use cases**:
- CI/CD pipelines
- Build and deploy workflows
- Development environments

**Pipeline flow**:
```
lint (task) → [lint:success] → build (task) → [build:success] → api (service)
```

[Full documentation](../../examples/lint-build-api/README.md)

---

### 2. Circuit Breaker

**Location**: `examples/circuit-breaker/`

**What it demonstrates**:
- Circuit breaker safety mechanism
- Automatic failure detection
- Event-driven alerting
- System recovery monitoring

**Use cases**:
- Preventing cascading failures
- Automated alerting
- Service health monitoring
- Resource protection

**Pipeline flow**:
```
crasher (crashes repeatedly)
    → [circuit-breaker:triggered]
    → monitor (service) + notify (task)
```

[Full documentation](../../examples/circuit-breaker/README.md)

---

### 3. Continue on Failure

**Location**: `examples/continue-on-failure/`

**What it demonstrates**:
- Strict mode vs lenient mode
- Graceful degradation
- Failure event emission
- Cleanup handlers

**Use cases**:
- Optional operations (cache, metrics)
- Resilient pipelines
- Fallback logic
- Error recovery

**Key differences**:
| Mode | continue_on_failure | Behavior |
|------|---------------------|----------|
| Strict | `false` (default) | Failure blocks dependents |
| Lenient | `true` | Failure emits event, continues |

[Full documentation](../../examples/continue-on-failure/README.md)

---

### 4. Multi-Pattern Event Matching

**Location**: `examples/multi-pattern/`

**What it demonstrates**:
- Multiple patterns per process
- ALL patterns emit events (not just first match)
- Event fan-out pattern
- Log level routing

**Use cases**:
- Log aggregation
- Multi-level monitoring
- Event broadcasting
- Complex event routing

**Pipeline flow**:
```
analyzer (outputs multiple log levels)
    ├─ [INFO] → info-logger
    ├─ [WARN] → warn-logger
    ├─ [ERROR] → error-logger
    └─ [Analysis complete] → report
```

[Full documentation](../../examples/multi-pattern/README.md)

---

## Running Examples

### Prerequisites

Install Clier globally:
```bash
npm install -g clier
```

### General Steps

1. Navigate to example directory:
```bash
cd examples/[example-name]
```

2. Install dependencies (if any):
```bash
npm install
```

3. Validate configuration:
```bash
clier validate
```

4. Start the pipeline:
```bash
clier start
```

5. Monitor status:
```bash
clier status
clier logs [process-name]
```

6. Stop the pipeline:
```bash
clier stop
```

---

### 5. Workflow Orchestration

**What it demonstrates**:
- Sequential multi-step workflows
- Conditional step execution
- Process coordination (stop → build → start)
- Workflow lifecycle events

**Use cases**:
- Rebuild-and-restart pipelines
- Rolling restarts with health checks
- Auto-triggered deployment chains
- Complex multi-process coordination

**Example workflow**:
```json
{
  "name": "rebuild-web",
  "type": "workflow",
  "manual": true,
  "steps": [
    { "action": "stop", "process": "web", "if": { "process": "web", "is": "running" } },
    { "action": "run", "process": "build-web" },
    { "action": "start", "process": "web", "await": "web:ready" }
  ]
}
```

```bash
clier flow rebuild-web
```

[Full documentation](../../docs/workflows.md)

---

## Example Categories

### By Complexity

**Beginner**:
- lint-build-api - Basic sequential pipeline

**Intermediate**:
- multi-pattern - Event fan-out and routing
- continue-on-failure - Error handling patterns

**Advanced**:
- circuit-breaker - Safety mechanisms and recovery

### By Use Case

**Development Workflows**:
- lint-build-api - Dev environment automation

**Production Safety**:
- circuit-breaker - Failure detection and recovery
- continue-on-failure - Graceful degradation

**Event Patterns**:
- multi-pattern - Complex event routing

---

## Common Patterns

### Sequential Execution

See: `lint-build-api`

```json
{
  "pipeline": [
    { "name": "step1", "events": { "on_stdout": [{ "pattern": "DONE", "emit": "step1:done" }] } },
    { "name": "step2", "trigger_on": ["step1:done"], "events": { "on_stdout": [{ "pattern": "DONE", "emit": "step2:done" }] } },
    { "name": "step3", "trigger_on": ["step2:done"] }
  ]
}
```

### Parallel Execution

```json
{
  "pipeline": [
    { "name": "init", "events": { "on_stdout": [{ "pattern": "READY", "emit": "init:ready" }] } },
    { "name": "worker1", "trigger_on": ["init:ready"] },
    { "name": "worker2", "trigger_on": ["init:ready"] },
    { "name": "worker3", "trigger_on": ["init:ready"] }
  ]
}
```

### Error Handling

See: `continue-on-failure`

```json
{
  "name": "optional-task",
  "continue_on_failure": true,
  "events": {
    "on_stdout": [
      { "pattern": "SUCCESS", "emit": "task:success" },
      { "pattern": "FAILURE", "emit": "task:failure" }
    ]
  }
}
```

### Alerting

See: `circuit-breaker`

```json
{
  "name": "alert",
  "type": "task",
  "trigger_on": ["circuit-breaker:triggered", "service:error"],
  "command": "node send-webhook.js"
}
```

---

## Modifying Examples

All examples are fully self-contained and can be modified:

1. **Edit the config**: Modify `clier-pipeline.json`
2. **Edit the scripts**: Modify supporting `.js` files
3. **Test changes**: Run `clier validate` and `clier start`

### Tips

- Use `clier logs` to debug pattern matching
- Check PM2 directly: `pm2 logs`
- Test patterns with `console.log()` in your scripts
- Start simple, add complexity gradually

---

## Creating Your Own Examples

1. Create a new directory
2. Add `clier-pipeline.json`
3. Add supporting scripts
4. Add `README.md` with:
   - What it demonstrates
   - How to run it
   - Expected output
   - Use cases

Example structure:
```
my-example/
├── clier-pipeline.json    # Configuration
├── script1.js             # Supporting script
├── script2.js             # Supporting script
└── README.md              # Documentation
```

---

## Troubleshooting

### Processes don't start

1. Check validation: `clier validate`
2. Check dependencies: Are trigger events being emitted?
3. Check logs: `clier logs [process-name]`
4. Check PM2: `pm2 list` and `pm2 logs`

### Pattern doesn't match

1. Test the pattern with a regex tester
2. Check logs for actual output
3. Remember to escape special characters: `\\[`, `\\.`
4. Use broader patterns for testing: `.*ready.*`

### Pipeline stops unexpectedly

1. Check for crashes: `clier logs`
2. Verify `continue_on_failure` setting
3. Check circuit breaker (3 crashes in 5 seconds)
4. Check safety limits in config

### Events not triggering

1. Verify pattern matches stdout exactly
2. Check event name spelling in `trigger_on`
3. Ensure process emitting event actually runs
4. Check debounce timing

---

## Additional Resources

- [Configuration Guide](../configuration.md) - Complete config reference
- [API Reference](../api-reference.md) - TypeScript API docs
- [Main Documentation](../README.md) - Overview and quick start

---

## Contributing Examples

Have a great example? Contribute it!

1. Create the example in `examples/your-example/`
2. Include complete documentation
3. Test thoroughly
4. Submit a pull request

Good examples:
- Solve real-world problems
- Are well-documented
- Include error handling
- Are self-contained
- Work out of the box

---

## Example Checklist

When creating examples, ensure:

- [ ] Config validates with `clier validate`
- [ ] All scripts are executable
- [ ] README explains what it demonstrates
- [ ] README includes step-by-step instructions
- [ ] Example runs successfully
- [ ] Logs show expected output
- [ ] Stops cleanly with `clier stop`
- [ ] No hardcoded paths or credentials
- [ ] Works on fresh install
