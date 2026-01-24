# Browser Debugging Example

Demonstrates agentic browser debugging by streaming Chrome DevTools console output to the terminal. This enables AI agents to see browser console.log, errors, and exceptions in real-time.

## How It Works

1. **server** - A simple HTTP server that serves a page with console.log statements
2. **browser** - A manual stage that launches Chrome with remote debugging and streams console output

The browser stage is marked `manual: true`, meaning it won't start automatically with the pipeline.

## Usage

```bash
# Start the server
clier service start

# In another terminal, manually trigger the browser
clier trigger browser
```

The browser will open and you'll see console output streamed to your terminal:
```
[console.log] Page loaded at 2024-01-24T10:00:00.000Z
[console.log] Heartbeat: 10:00:05 AM
[console.log] Button clicked! timestamp: 1706090410000
[console.error] EXCEPTION: Error: Intentional error for debugging demo
```

## Requirements

- Chrome browser installed
- One of:
  - Python with `websockets` module: `pip3 install websockets` (recommended)
  - `websocat`: `brew install websocat`
  - Node.js with `ws` module: `npm install ws`

## Why This Is Useful for AI Agents

AI coding agents can now:
- See JavaScript errors and exceptions as they occur
- Debug frontend issues without manual DevTools inspection
- Verify that frontend code is working correctly
- Catch runtime errors during development
