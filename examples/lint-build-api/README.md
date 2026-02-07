# Lint -> Build -> API Pipeline Example

This example demonstrates a complete CI/CD-style pipeline using Clier:

1. **Lint** - Validates code quality
2. **Build** - Compiles the application
3. **API** - Starts the server (only if build succeeds)

## Pipeline Flow

```
lint (task) ---[lint:success]---> build (task) ---[build:success]---> api (service)
```

## Features Demonstrated

- **Task vs Service**: Shows the difference between one-off tasks (lint, build) and long-running services (api)
- **Event-driven triggers**: Build only runs after lint succeeds, API only starts after build succeeds
- **Pattern matching**: Custom success patterns emit events to trigger next stage
- **Safety mechanisms**: Debouncing and rate limiting prevent excessive operations

## Prerequisites

```bash
npm install -g clier
```

## Setup

1. Install dependencies:
```bash
cd examples/lint-build-api
npm install
```

2. Validate the configuration:
```bash
clier validate
```

## Running the Pipeline

Start the pipeline:
```bash
clier start
```

This will:
1. Run the linter
2. If linting passes, run the build
3. If build succeeds, start the API server
4. API will be available at http://localhost:3000

## Monitoring

Check status:
```bash
clier status
```

View logs:
```bash
clier logs lint
clier logs build
clier logs api
```

## Stopping

Stop all processes:
```bash
clier stop
```

## Testing the API

Once the pipeline is running and the API is up:

```bash
curl http://localhost:3000
curl http://localhost:3000/health
```

## Configuration

See `clier-pipeline.json` for the complete configuration. Key settings:

- **Debounce**: 100ms to prevent rapid-fire operations
- **Rate limit**: Max 60 operations per minute
- **Event patterns**: Custom regex patterns to detect success
- **Trigger chains**: Each stage triggers the next on success

## Troubleshooting

If the pipeline doesn't progress:
1. Check logs: `clier logs <process-name>`
2. Verify pattern matching - make sure stdout contains expected patterns
3. Check PM2 directly: `pm2 list` and `pm2 logs`

## Next Steps

Try modifying:
- Add a test stage between lint and build
- Add notification webhook when API is ready
- Add failure handling with `continue_on_failure: true`
