/**
 * Daemon Utilities
 *
 * Shared utilities for daemon socket management.
 */

import * as net from "net";

/**
 * Probe a Unix domain socket to check if a live daemon is listening.
 *
 * Attempts a brief TCP connection to the socket path. If the connection
 * succeeds within the timeout, the socket is considered alive.
 *
 * @param socketPath - Path to the Unix domain socket
 * @param timeoutMs - Connection timeout in milliseconds (default: 500)
 * @returns true if a process is listening on the socket, false otherwise
 */
export function probeSocket(
  socketPath: string,
  timeoutMs = 500,
): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection(socketPath);

    const timer = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, timeoutMs);

    socket.on("connect", () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(true);
    });

    socket.on("error", () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(false);
    });
  });
}
