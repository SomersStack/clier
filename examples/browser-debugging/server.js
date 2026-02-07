const http = require('http');

const html = `<!DOCTYPE html>
<html>
<head>
  <title>Browser Debugging Demo</title>
</head>
<body>
  <h1>Browser Debugging Demo</h1>
  <p>Open the terminal running <code>clier trigger browser</code> to see console output.</p>
  <button onclick="logMessage()">Log Message</button>
  <button onclick="logObject()">Log Object</button>
  <button onclick="throwError()">Throw Error</button>

  <script>
    console.log('Page loaded at', new Date().toISOString());

    function logMessage() {
      console.log('Button clicked!', 'timestamp:', Date.now());
    }

    function logObject() {
      console.log('User data:', {
        name: 'Alice',
        role: 'developer',
        preferences: { theme: 'dark', notifications: true }
      });
    }

    function throwError() {
      throw new Error('Intentional error for debugging demo');
    }

    // Periodic log
    setInterval(() => {
      console.log('Heartbeat:', new Date().toLocaleTimeString());
    }, 5000);
  </script>
</body>
</html>`;

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(html);
});

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
