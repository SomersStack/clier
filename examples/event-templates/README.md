# Event Template Variables Example

This example demonstrates **event template variable substitution** in Clier pipelines - a powerful feature that allows you to pass event metadata to triggered processes.

## What are Event Templates?

Event template variables are placeholders like `{{event.source}}` or `{{process.name}}` that get automatically replaced with actual event metadata when a process is triggered by an event. This enables dynamic, context-aware process execution.

## Available Template Variables

### Event Metadata
- `{{event.name}}` - Event name (e.g., "backend:ready")
- `{{event.type}}` - Event type (custom, success, error, crashed, stdout, stderr)
- `{{event.timestamp}}` - Unix timestamp in milliseconds when event was emitted
- `{{event.source}}` - Name of the process that emitted the event

### Process Metadata
- `{{process.name}}` - Current process name
- `{{process.type}}` - Process type (service or task)

### Clier Metadata
- `{{clier.project}}` - Project name from configuration
- `{{clier.timestamp}}` - Current timestamp in milliseconds

## How This Example Works

This example has 3 processes:

1. **data-generator** (service)
   - Runs continuously, generating data every 2 seconds
   - Emits `data:generated` event on stdout pattern match
   - No templates needed (entry point)

2. **processor** (task)
   - Triggered by `data:generated` event
   - Uses templates in **command** arguments:
     ```bash
     node processor.js --source={{event.source}} --event={{event.name}} --timestamp={{event.timestamp}}
     ```
   - Uses templates in **environment variables**:
     ```json
     {
       "TRIGGER_SOURCE": "{{event.source}}",
       "TRIGGER_EVENT": "{{event.name}}",
       "PROCESSOR_NAME": "{{process.name}}",
       "PROJECT_NAME": "{{clier.project}}"
     }
     ```

3. **logger** (task)
   - Triggered by `data:generated` event
   - Demonstrates ALL template variables via environment
   - Shows timestamp difference between event emission and process start

## Running the Example

```bash
# From this directory
npm start

# Or using clier directly
clier start

# Watch logs in real-time
clier logs --follow

# Check status
clier status
```

## Expected Output

You should see:

1. **data-generator** starts and emits events every 2 seconds
2. **processor** triggers on each event, showing:
   - Command arguments with substituted values
   - Environment variables with event metadata
3. **logger** triggers on each event, showing:
   - All available template variables
   - Time difference between event emission and process start

Example processor output:
```
Processor started with event templates:
  Command Args:
    --source=data-generator
    --event=data:generated
    --timestamp=1706012345678
  Environment Variables:
    TRIGGER_SOURCE=data-generator
    TRIGGER_EVENT=data:generated
    PROCESSOR_NAME=processor
    PROJECT_NAME=event-templates-demo
```

Example logger output:
```
============================================================
EVENT LOGGER - All Template Variables
============================================================

Event Metadata:
  event.source      = data-generator
  event.name        = data:generated
  event.type        = custom
  event.timestamp   = 1706012345678

Process Metadata:
  process.name      = logger
  process.type      = task

Clier Metadata:
  clier.project     = event-templates-demo
  clier.timestamp   = 1706012345720

Timestamp Difference:
  Time since event  = 42ms
============================================================
```

## Key Configuration Points

### Enabling Event Templates

Templates are **opt-in** per process:

```json
{
  "name": "my-process",
  "command": "node app.js --source={{event.source}}",
  "enable_event_templates": true,  // Required!
  "trigger_on": ["some:event"]
}
```

### Template Behavior

- **Entry point processes** (no `trigger_on`): Templates are NOT substituted (no event context)
- **Triggered processes** with `enable_event_templates: false`: Templates are NOT substituted
- **Triggered processes** with `enable_event_templates: true`: Templates ARE substituted

### Where Templates Work

Templates can be used in:
- **Command strings**: `"command": "node app.js --arg={{event.name}}"`
- **Environment variable values**: `"env": {"VAR": "{{event.source}}"}`

### Error Handling

- Unknown template variables (e.g., `{{event.unknown}}`) are left unchanged and logged as warnings
- Malformed templates (e.g., unclosed `{{`) are detected during validation
- Templates in entry point processes are silently ignored

## Use Cases

### 1. Dynamic Routing
```json
{
  "command": "node process-{{event.source}}.js",
  "enable_event_templates": true
}
```

### 2. Event Tracing
```json
{
  "env": {
    "TRACE_ID": "{{event.timestamp}}-{{event.source}}-{{process.name}}"
  },
  "enable_event_templates": true
}
```

### 3. Conditional Logic
```bash
# In your script
if [ "$EVENT_TYPE" = "error" ]; then
  send-alert.sh
fi
```

### 4. Audit Logging
```json
{
  "command": "log.sh '{{event.name}}' from '{{event.source}}' at {{event.timestamp}}",
  "enable_event_templates": true
}
```

## Security & Safety

Event templates are designed to be **safe**:

- ✅ Only predefined metadata variables allowed
- ✅ No arbitrary code execution
- ✅ No user-controlled data injection
- ✅ Type-safe substitution
- ✅ Backward compatible (opt-in)

Templates substitute **metadata only** - you cannot inject arbitrary event data or execute code.

## Learn More

- [Configuration Guide](../../docs/configuration.md#event-template-variables)
- [API Reference](../../docs/api-reference.md)
- [Main README](../../README.md)
