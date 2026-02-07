#!/bin/bash
# Launches Chrome with remote debugging and streams console logs to terminal
# Usage: ./chrome-console.sh [url]

URL="${1:-https://localhost:5001}"
DEBUG_PORT=9222
TEMP_PROFILE=$(mktemp -d)

cleanup() {
    echo "[chrome-console] Cleaning up..."
    # Kill Chrome process by PID if we have it
    if [ -n "$CHROME_PID" ] && kill -0 "$CHROME_PID" 2>/dev/null; then
        kill "$CHROME_PID" 2>/dev/null
        sleep 1
    fi
    rm -rf "$TEMP_PROFILE"
}
trap cleanup EXIT INT TERM

# Ensure debug port is free before starting
if lsof -i ":$DEBUG_PORT" >/dev/null 2>&1; then
    echo "[chrome-console] Port $DEBUG_PORT in use, waiting for it to free..."
    for i in {1..5}; do
        sleep 1
        if ! lsof -i ":$DEBUG_PORT" >/dev/null 2>&1; then
            break
        fi
    done
    if lsof -i ":$DEBUG_PORT" >/dev/null 2>&1; then
        echo "[chrome-console] ERROR: Port $DEBUG_PORT still in use after waiting"
        echo "[chrome-console] Run: pkill -f 'remote-debugging-port=$DEBUG_PORT'"
        exit 0  # Exit cleanly to avoid crash loop
    fi
fi

echo "[chrome-console] Starting Chrome with clean profile at $TEMP_PROFILE"
echo "[chrome-console] Debug port: $DEBUG_PORT"
echo "[chrome-console] Target URL: $URL"

# Launch Chrome with:
# - Temporary user data dir (no cache/cookies)
# - Remote debugging enabled
# - Disable various caches
# - Suppress Chrome's internal stderr noise (GPU warnings, sandbox notices, etc.)
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
    --user-data-dir="$TEMP_PROFILE" \
    --remote-debugging-port=$DEBUG_PORT \
    --no-first-run \
    --no-default-browser-check \
    --disable-application-cache \
    --disable-cache \
    --disk-cache-size=0 \
    --media-cache-size=0 \
    --aggressive-cache-discard \
    --disable-background-networking \
    --disable-logging \
    --log-level=3 \
    --silent-debugger-extension-api \
    --auto-open-devtools-for-tabs \
    "$URL" 2>/dev/null &

CHROME_PID=$!
echo "[chrome-console] Chrome PID: $CHROME_PID"

# Wait for Chrome to start and debugging endpoint to be available
sleep 2

# Get the WebSocket debugger URL
echo "[chrome-console] Connecting to DevTools Protocol..."

for i in {1..10}; do
    # Use Python to reliably parse JSON and find the target page (not devtools:// or chrome-extension://)
    WS_URL=$(curl -s "http://localhost:$DEBUG_PORT/json" 2>/dev/null | \
        python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    # Find the page matching our target URL, or any https:// page
    target = '$URL'
    for item in data:
        if item.get('type') == 'page' and item.get('url', '').startswith(target):
            print(item.get('webSocketDebuggerUrl', ''))
            sys.exit(0)
    # Fallback: find any https:// page that's not devtools or chrome-extension
    for item in data:
        url = item.get('url', '')
        if item.get('type') == 'page' and url.startswith('https://') and 'devtools' not in url:
            print(item.get('webSocketDebuggerUrl', ''))
            sys.exit(0)
except: pass
" 2>/dev/null)
    if [ -n "$WS_URL" ]; then
        break
    fi
    echo "[chrome-console] Waiting for Chrome DevTools... (attempt $i)"
    sleep 1
done

if [ -z "$WS_URL" ]; then
    echo "[chrome-console] ERROR: Could not connect to Chrome DevTools"
    echo "[chrome-console] Chrome is running but console streaming unavailable"
    echo "[chrome-console] You can manually connect at: chrome://inspect"
    # Wait for Chrome to exit naturally, exit 0 to avoid crash loop restarts
    wait $CHROME_PID
    exit 0
fi

echo "[chrome-console] Connected to: $WS_URL"
echo "[chrome-console] Streaming console logs..."
echo "----------------------------------------"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Prefer Python websockets (best object serialization), then websocat, then Node
if python3 -c "import websockets" 2>/dev/null; then
    # Use full-featured Python CDP client with async object fetching
    python3 "$SCRIPT_DIR/cdp-console.py" "$WS_URL" 2>&1
elif command -v websocat &> /dev/null; then
    # Enable Runtime and Console domains, then stream
    # Use Python to parse the JSON messages properly
    {
        echo '{"id":1,"method":"Runtime.enable"}'
        echo '{"id":2,"method":"Console.enable"}'
        echo '{"id":3,"method":"Log.enable"}'
        # Keep connection alive
        while true; do sleep 30; done
    } | websocat -t "$WS_URL" | python3 -u -c "
import sys, json

for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    try:
        msg = json.loads(line)
        method = msg.get('method', '')

        if method == 'Runtime.consoleAPICalled':
            params = msg.get('params', {})
            log_type = params.get('type', 'log')
            args = params.get('args', [])
            # Extract values from args, serializing objects
            values = []
            for arg in args:
                arg_type = arg.get('type', '')
                if 'value' in arg:
                    val = arg['value']
                    # JSON stringify if it's a complex value
                    if isinstance(val, (dict, list)):
                        values.append(json.dumps(val, ensure_ascii=False))
                    else:
                        values.append(str(val))
                elif arg_type == 'object' and 'preview' in arg:
                    # Serialize object preview
                    preview = arg['preview']
                    props = preview.get('properties', [])
                    obj = {}
                    for p in props:
                        pval = p.get('value')
                        if pval is None:
                            pval = p.get('description', '...')
                        obj[p.get('name', '?')] = pval
                    if preview.get('overflow'):
                        obj['...'] = '(truncated)'
                    # Include className if it's informative
                    class_name = preview.get('subtype') or arg.get('className', '')
                    if class_name and class_name not in ('Object', 'Array'):
                        values.append(f'[{class_name}] ' + json.dumps(obj, ensure_ascii=False))
                    else:
                        values.append(json.dumps(obj, ensure_ascii=False))
                elif arg_type == 'object':
                    # No preview available - show className and description
                    class_name = arg.get('className', 'Object')
                    desc = arg.get('description', class_name)
                    # If description is just the class name, try to be more informative
                    if desc == class_name or desc == 'Object':
                        # Check for subtype (e.g., 'error', 'array', 'null')
                        subtype = arg.get('subtype', '')
                        if subtype:
                            values.append(f'[{class_name}:{subtype}]')
                        else:
                            values.append(f'[{class_name}]')
                    else:
                        values.append(desc)
                elif 'description' in arg:
                    values.append(str(arg['description']))
                elif arg_type == 'undefined':
                    values.append('undefined')
                elif arg_type == 'null':
                    values.append('null')
            message = ' '.join(values)
            if message:
                print(f'[console.{log_type}] {message}', flush=True)

        elif method == 'Runtime.exceptionThrown':
            params = msg.get('params', {})
            details = params.get('exceptionDetails', {})
            exc = details.get('exception', {})
            desc = exc.get('description', details.get('text', 'Unknown error'))
            print(f'[console.error] EXCEPTION: {desc}', flush=True)

        elif method == 'Log.entryAdded':
            params = msg.get('params', {})
            entry = params.get('entry', {})
            level = entry.get('level', 'info')
            text = entry.get('text', '')
            if text:
                print(f'[{level}] {text}', flush=True)

    except json.JSONDecodeError:
        pass
    except Exception as e:
        print(f'[parse-error] {e}', flush=True)
"
elif command -v node &> /dev/null && node -e "require('ws')" 2>/dev/null; then
    # Node.js fallback for console streaming (requires ws module)
    node -e "
const WebSocket = require('ws');
const ws = new WebSocket('$WS_URL');
ws.on('open', () => {
    ws.send(JSON.stringify({id:1,method:'Runtime.enable'}));
    ws.send(JSON.stringify({id:2,method:'Console.enable'}));
    ws.send(JSON.stringify({id:3,method:'Log.enable'}));
});
ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if (msg.method === 'Runtime.consoleAPICalled') {
        const type = msg.params.type;
        const args = msg.params.args.map(a => a.value || a.description || '').join(' ');
        console.log('[console.' + type + ']', args);
    } else if (msg.method === 'Runtime.exceptionThrown') {
        const desc = msg.params.exceptionDetails?.exception?.description || 'Unknown error';
        console.log('[console.error] EXCEPTION:', desc);
    } else if (msg.method === 'Log.entryAdded') {
        const entry = msg.params.entry;
        console.log('[' + entry.level + ']', entry.text);
    }
});
ws.on('error', (e) => console.error('[ws error]', e.message));
ws.on('close', () => { console.log('[chrome-console] Connection closed'); process.exit(0); });
"
else
    echo "[chrome-console] WARNING: No WebSocket client available for console streaming"
    echo "[chrome-console] Install one of:"
    echo "[chrome-console]   brew install websocat    (recommended)"
    echo "[chrome-console]   npm install -g ws        (for Node.js)"
    echo "[chrome-console] Chrome is running - view console in DevTools window"
    echo "[chrome-console] Waiting for Chrome to exit..."
    wait $CHROME_PID
fi
