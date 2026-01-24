#!/usr/bin/env python3
"""Chrome DevTools Protocol console log streamer with full object serialization."""

import asyncio
import json
import sys
import signal

try:
    import websockets
except ImportError:
    print("[cdp-console] ERROR: websockets module required")
    print("[cdp-console] Install: pip3 install websockets")
    sys.exit(1)


class CDPConsole:
    def __init__(self, ws_url):
        self.ws_url = ws_url
        self.ws = None
        self.msg_id = 0
        self.pending = {}  # id -> Future
        self.running = True

    async def connect(self):
        self.ws = await asyncio.wait_for(
            websockets.connect(self.ws_url),
            timeout=10.0
        )
        # Enable console and runtime domains - send without waiting for response
        # (responses will be processed by the message handler in run())
        await self.ws.send(json.dumps({"id": 1, "method": "Runtime.enable"}))
        await self.ws.send(json.dumps({"id": 2, "method": "Console.enable"}))
        await self.ws.send(json.dumps({"id": 3, "method": "Log.enable"}))
        self.msg_id = 3  # Start command IDs after these

    async def send_command(self, method, params=None, timeout=5.0):
        """Send a CDP command and wait for response."""
        self.msg_id += 1
        msg_id = self.msg_id
        msg = {"id": msg_id, "method": method}
        if params:
            msg["params"] = params

        future = asyncio.get_event_loop().create_future()
        self.pending[msg_id] = future

        await self.ws.send(json.dumps(msg))
        try:
            return await asyncio.wait_for(future, timeout=timeout)
        except asyncio.TimeoutError:
            self.pending.pop(msg_id, None)
            return {"error": "timeout"}

    async def get_object_properties(self, object_id, max_depth=2):
        """Recursively get object properties."""
        try:
            result = await asyncio.wait_for(
                self.send_command("Runtime.getProperties", {
                    "objectId": object_id,
                    "ownProperties": True,
                    "generatePreview": True
                }),
                timeout=2.0
            )

            if "result" not in result:
                return "[Object]"

            props = result["result"]
            obj = {}

            for prop in props:
                name = prop.get("name", "?")
                value_desc = prop.get("value", {})

                if "value" in value_desc:
                    obj[name] = value_desc["value"]
                elif value_desc.get("type") == "object" and max_depth > 0:
                    if "objectId" in value_desc:
                        # Recursively get nested object (with depth limit)
                        obj[name] = await self.get_object_properties(
                            value_desc["objectId"], max_depth - 1
                        )
                    elif "preview" in value_desc:
                        obj[name] = self.preview_to_dict(value_desc["preview"])
                    else:
                        obj[name] = value_desc.get("description", "[Object]")
                elif "description" in value_desc:
                    obj[name] = value_desc["description"]
                elif value_desc.get("type") == "undefined":
                    obj[name] = "undefined"

            return obj
        except asyncio.TimeoutError:
            return "[Object: timeout]"
        except Exception as e:
            return f"[Object: {e}]"

    def preview_to_dict(self, preview):
        """Convert a CDP preview to a dict."""
        obj = {}
        for prop in preview.get("properties", []):
            name = prop.get("name", "?")
            obj[name] = prop.get("value", prop.get("description", "..."))
        if preview.get("overflow"):
            obj["..."] = "(truncated)"
        return obj

    async def format_arg(self, arg, is_object_result=False):
        """Format a console argument, fetching object details if needed.

        Returns tuple: (formatted_string, is_complex_object)
        is_complex_object=True means it should be on its own line
        """
        arg_type = arg.get("type", "")

        if "value" in arg:
            val = arg["value"]
            if isinstance(val, (dict, list)):
                return (json.dumps(val, ensure_ascii=False, indent=2), True)
            return (str(val), False)

        if arg_type == "object":
            # Try preview first
            if "preview" in arg:
                obj = self.preview_to_dict(arg["preview"])
                class_name = arg.get("className", "")
                formatted = json.dumps(obj, ensure_ascii=False, indent=2)
                if class_name and class_name not in ("Object", "Array"):
                    return (f"[{class_name}]\n{formatted}", True)
                return (formatted, True)

            # No preview - try to fetch object properties
            if "objectId" in arg:
                obj = await self.get_object_properties(arg["objectId"])
                if isinstance(obj, dict):
                    class_name = arg.get("className", "")
                    formatted = json.dumps(obj, ensure_ascii=False, indent=2)
                    if class_name and class_name not in ("Object", "Array"):
                        return (f"[{class_name}]\n{formatted}", True)
                    return (formatted, True)
                return (str(obj), False)

            # Fallback to description
            return (arg.get("description", "[Object]"), False)

        if "description" in arg:
            return (str(arg["description"]), False)

        if arg_type == "undefined":
            return ("undefined", False)

        if arg_type == "null":
            return ("null", False)

        return (str(arg), False)

    async def handle_message(self, msg):
        """Handle incoming CDP message."""
        # Handle command responses
        if "id" in msg and msg["id"] in self.pending:
            future = self.pending.pop(msg["id"])
            future.set_result(msg)
            return

        method = msg.get("method", "")

        if method == "Runtime.consoleAPICalled":
            params = msg.get("params", {})
            log_type = params.get("type", "log")
            args = params.get("args", [])

            # Format all arguments, separating simple values from complex objects
            simple_parts = []
            complex_parts = []

            for arg in args:
                formatted, is_complex = await self.format_arg(arg)
                if is_complex:
                    complex_parts.append(formatted)
                else:
                    simple_parts.append(formatted)

            # Build output: simple parts on main line, complex objects indented below
            if simple_parts or complex_parts:
                main_line = " ".join(simple_parts) if simple_parts else ""
                print(f"[console.{log_type}] {main_line}", flush=True)

                # Print complex objects indented on subsequent lines
                for obj_str in complex_parts:
                    # Indent each line of the object
                    indented = "\n".join("    " + line for line in obj_str.split("\n"))
                    print(indented, flush=True)

        elif method == "Runtime.exceptionThrown":
            params = msg.get("params", {})
            details = params.get("exceptionDetails", {})
            exc = details.get("exception", {})
            desc = exc.get("description", details.get("text", "Unknown error"))
            print(f"[console.error] EXCEPTION: {desc}", flush=True)

        elif method == "Log.entryAdded":
            params = msg.get("params", {})
            entry = params.get("entry", {})
            level = entry.get("level", "info")
            text = entry.get("text", "")
            if text:
                print(f"[{level}] {text}", flush=True)

    async def run(self):
        """Main loop to receive and process messages."""
        try:
            async for message in self.ws:
                if not self.running:
                    break
                try:
                    msg = json.loads(message)
                    await self.handle_message(msg)
                except json.JSONDecodeError:
                    pass
                except Exception as e:
                    print(f"[parse-error] {e}", flush=True)
        except websockets.exceptions.ConnectionClosed:
            print("[cdp-console] Connection closed", flush=True)

    async def close(self):
        self.running = False
        if self.ws:
            await self.ws.close()


async def main():
    if len(sys.argv) < 2:
        print("Usage: cdp-console.py <websocket-url>", flush=True)
        sys.exit(1)

    ws_url = sys.argv[1]
    console = CDPConsole(ws_url)

    # Handle shutdown gracefully
    loop = asyncio.get_event_loop()

    def shutdown():
        asyncio.create_task(console.close())

    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, shutdown)

    try:
        await console.connect()
        await console.run()
    except Exception as e:
        print(f"[cdp-console] Error: {e}", flush=True)
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
