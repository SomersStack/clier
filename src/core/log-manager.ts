/**
 * Log Manager
 *
 * Provides in-memory log storage with ring buffers for recent logs
 * and file-based persistence with rotation.
 *
 * Supports snapshot queries (last N lines, since timestamp) - no streaming.
 */

import * as fs from "fs";
import * as path from "path";
import { createContextLogger } from "../utils/logger.js";

const logger = createContextLogger("LogManager");

/**
 * A single log entry
 */
export interface LogEntry {
  /** Unix timestamp in milliseconds */
  timestamp: number;
  /** Source stream: stdout, stderr, or command (for logged commands sent to the process) */
  stream: "stdout" | "stderr" | "command";
  /** Log line content */
  data: string;
  /** Process name */
  processName: string;
}

/**
 * Options for LogManager
 */
export interface LogManagerOptions {
  /** Maximum entries per process in memory (default: 1000) */
  maxMemoryEntries?: number;
  /** Whether to persist logs to files (default: true) */
  persistLogs?: boolean;
  /** Directory for log files (default: .clier/logs) */
  logDir?: string;
  /** Max file size before rotation in bytes (default: 10MB) */
  maxFileSize?: number;
  /** Number of rotated files to keep (default: 5) */
  maxFiles?: number;
}

/**
 * Ring buffer implementation for efficient fixed-size storage
 */
class RingBuffer<T> {
  private buffer: (T | undefined)[];
  private head = 0;
  private _size = 0;

  constructor(private capacity: number) {
    this.buffer = new Array(capacity);
  }

  /**
   * Add an item to the buffer
   */
  push(item: T): void {
    this.buffer[this.head] = item;
    this.head = (this.head + 1) % this.capacity;
    if (this._size < this.capacity) {
      this._size++;
    }
  }

  /**
   * Get all items in order (oldest to newest)
   */
  toArray(): T[] {
    if (this._size < this.capacity) {
      return this.buffer.slice(0, this._size) as T[];
    }
    // Buffer is full, need to unwrap from head position
    return [
      ...this.buffer.slice(this.head),
      ...this.buffer.slice(0, this.head),
    ] as T[];
  }

  /**
   * Get the most recent N items
   */
  getRecent(count: number): T[] {
    const all = this.toArray();
    return all.slice(-Math.min(count, all.length));
  }

  /**
   * Get items since a timestamp (assumes items have timestamp property)
   */
  getSince(timestamp: number): T[] {
    return this.toArray().filter(
      (item) =>
        (item as unknown as { timestamp: number }).timestamp >= timestamp,
    );
  }

  /**
   * Current number of items
   */
  get size(): number {
    return this._size;
  }

  /**
   * Clear the buffer
   */
  clear(): void {
    this.buffer = new Array(this.capacity);
    this.head = 0;
    this._size = 0;
  }
}

/**
 * LogManager class
 *
 * Manages log storage for multiple processes with ring buffers
 * for memory efficiency and optional file persistence.
 *
 * @example
 * ```ts
 * const logManager = new LogManager({ logDir: '.clier/logs' });
 *
 * // Add log entries
 * logManager.add('backend', 'stdout', 'Server started');
 *
 * // Query logs
 * const recent = logManager.getLastN('backend', 100);
 * const sinceFiveMin = logManager.getSince('backend', Date.now() - 5 * 60 * 1000);
 * ```
 */
export class LogManager {
  private buffers = new Map<string, RingBuffer<LogEntry>>();
  private fileStreams = new Map<string, fs.WriteStream>();
  private fileSizes = new Map<string, number>();
  private pendingCloses: Promise<void>[] = [];
  private options: Required<LogManagerOptions>;

  constructor(options: LogManagerOptions = {}) {
    this.options = {
      maxMemoryEntries: options.maxMemoryEntries ?? 1000,
      persistLogs: options.persistLogs ?? true,
      logDir: options.logDir ?? ".clier/logs",
      maxFileSize: options.maxFileSize ?? 10 * 1024 * 1024, // 10MB
      maxFiles: options.maxFiles ?? 5,
    };

    // Ensure log directory exists
    if (this.options.persistLogs) {
      this.ensureLogDir();
    }
  }

  /**
   * Add a log entry
   *
   * @param processName - Name of the process
   * @param stream - stdout, stderr, or command
   * @param data - Log line content
   */
  add(
    processName: string,
    stream: "stdout" | "stderr" | "command",
    data: string,
  ): void {
    const entry: LogEntry = {
      timestamp: Date.now(),
      stream,
      data,
      processName,
    };

    // Add to ring buffer
    this.getOrCreateBuffer(processName).push(entry);

    // Persist to file if enabled
    if (this.options.persistLogs) {
      this.writeToFile(processName, entry);
    }
  }

  /**
   * Get the last N log entries for a process
   *
   * @param processName - Name of the process
   * @param count - Number of entries to retrieve (default: 100)
   * @returns Array of log entries, oldest first
   */
  getLastN(processName: string, count = 100): LogEntry[] {
    const buffer = this.buffers.get(processName);
    if (!buffer) {
      return [];
    }
    return buffer.getRecent(count);
  }

  /**
   * Get log entries since a timestamp
   *
   * @param processName - Name of the process
   * @param timestamp - Unix timestamp in milliseconds
   * @returns Array of log entries since timestamp, oldest first
   */
  getSince(processName: string, timestamp: number): LogEntry[] {
    const buffer = this.buffers.get(processName);
    if (!buffer) {
      return [];
    }
    return buffer.getSince(timestamp);
  }

  /**
   * Get all log entries for a process (up to maxMemoryEntries)
   *
   * @param processName - Name of the process
   * @returns Array of all log entries in memory
   */
  getAll(processName: string): LogEntry[] {
    const buffer = this.buffers.get(processName);
    if (!buffer) {
      return [];
    }
    return buffer.toArray();
  }

  /**
   * Clear logs for a process
   *
   * @param processName - Name of the process
   */
  clear(processName: string): void {
    const buffer = this.buffers.get(processName);
    if (buffer) {
      buffer.clear();
    }

    // Close file stream if open
    const stream = this.fileStreams.get(processName);
    if (stream) {
      stream.end();
      this.fileStreams.delete(processName);
      this.fileSizes.delete(processName);
    }
  }

  /**
   * Clear all logs
   */
  clearAll(): void {
    for (const name of this.buffers.keys()) {
      this.clear(name);
    }
    this.buffers.clear();
  }

  /**
   * Delete log files for a process (memory buffer + file on disk)
   *
   * @param processName - Name of the process
   */
  deleteLogFiles(processName: string): void {
    // Clear memory buffer and close stream
    this.clear(processName);

    // Delete the main log file and any rotated files
    const basePath = this.getLogFilePath(processName);

    try {
      // Delete main log file
      if (fs.existsSync(basePath)) {
        fs.unlinkSync(basePath);
        logger.debug("Deleted log file", { processName, path: basePath });
      }

      // Delete rotated files (.1, .2, etc.)
      for (let i = 1; i <= this.options.maxFiles; i++) {
        const rotatedPath = `${basePath}.${i}`;
        if (fs.existsSync(rotatedPath)) {
          fs.unlinkSync(rotatedPath);
          logger.debug("Deleted rotated log file", {
            processName,
            path: rotatedPath,
          });
        }
      }
    } catch (error) {
      logger.error("Failed to delete log files", {
        processName,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Delete all log files for all processes
   */
  deleteAllLogFiles(): void {
    // Get all process names before clearing
    const processNames = Array.from(this.buffers.keys());

    for (const name of processNames) {
      this.deleteLogFiles(name);
    }

    this.buffers.clear();
  }

  /**
   * Get list of all processes that have logs
   */
  getProcessNames(): string[] {
    return Array.from(this.buffers.keys());
  }

  /**
   * Flush all pending writes and close file streams
   */
  async flush(): Promise<void> {
    const closePromises = Array.from(this.fileStreams.values()).map(
      (stream) =>
        new Promise<void>((resolve) => {
          stream.end(() => resolve());
        }),
    );

    // Also await any streams closed during rotation
    const allPromises = [...closePromises, ...this.pendingCloses];
    this.pendingCloses = [];

    await Promise.all(allPromises);
    this.fileStreams.clear();
    this.fileSizes.clear();
    logger.debug("Log streams flushed");
  }

  /**
   * Get or create a ring buffer for a process
   */
  private getOrCreateBuffer(processName: string): RingBuffer<LogEntry> {
    let buffer = this.buffers.get(processName);
    if (!buffer) {
      buffer = new RingBuffer<LogEntry>(this.options.maxMemoryEntries);
      this.buffers.set(processName, buffer);
    }
    return buffer;
  }

  /**
   * Write a log entry to file
   */
  private writeToFile(processName: string, entry: LogEntry): void {
    try {
      const stream = this.getOrCreateFileStream(processName);
      const line = this.formatLogLine(entry);

      stream.write(line);

      // Track file size
      const currentSize = this.fileSizes.get(processName) ?? 0;
      const newSize = currentSize + Buffer.byteLength(line);
      this.fileSizes.set(processName, newSize);

      // Check if rotation is needed
      if (newSize >= this.options.maxFileSize) {
        this.rotateLogFile(processName);
      }
    } catch (error) {
      logger.error("Failed to write log to file", {
        processName,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Get or create a file stream for a process
   */
  private getOrCreateFileStream(processName: string): fs.WriteStream {
    let stream = this.fileStreams.get(processName);
    if (!stream || stream.closed) {
      const filePath = this.getLogFilePath(processName);
      stream = fs.createWriteStream(filePath, { flags: "a" });

      stream.on("error", (error) => {
        logger.error("Log file stream error", {
          processName,
          error: error.message,
        });
      });

      this.fileStreams.set(processName, stream);

      // Initialize file size
      try {
        const stats = fs.statSync(filePath);
        this.fileSizes.set(processName, stats.size);
      } catch {
        this.fileSizes.set(processName, 0);
      }
    }
    return stream;
  }

  /**
   * Format a log entry for file output
   */
  private formatLogLine(entry: LogEntry): string {
    const timestamp = new Date(entry.timestamp).toISOString();
    const streamLabels: Record<LogEntry["stream"], string> = {
      stdout: "OUT",
      stderr: "ERR",
      command: "CMD",
    };
    const stream = streamLabels[entry.stream];
    return `${timestamp} [${stream}] ${entry.data}\n`;
  }

  /**
   * Get the log file path for a process
   */
  private getLogFilePath(processName: string): string {
    const safeName = processName.replace(/[^a-zA-Z0-9_-]/g, "_");
    return path.join(this.options.logDir, `${safeName}.log`);
  }

  /**
   * Rotate log files for a process
   */
  private rotateLogFile(processName: string): void {
    // Close current stream and track the pending close
    const stream = this.fileStreams.get(processName);
    if (stream) {
      this.pendingCloses.push(
        new Promise<void>((resolve) => {
          stream.end(() => resolve());
        }),
      );
      this.fileStreams.delete(processName);
    }

    const basePath = this.getLogFilePath(processName);

    try {
      // Rotate existing files
      for (let i = this.options.maxFiles - 1; i >= 1; i--) {
        const oldPath = `${basePath}.${i}`;
        const newPath = `${basePath}.${i + 1}`;
        if (fs.existsSync(oldPath)) {
          if (i === this.options.maxFiles - 1) {
            // Delete oldest file
            fs.unlinkSync(oldPath);
          } else {
            fs.renameSync(oldPath, newPath);
          }
        }
      }

      // Rotate current file to .1
      if (fs.existsSync(basePath)) {
        fs.renameSync(basePath, `${basePath}.1`);
      }

      // Reset file size
      this.fileSizes.set(processName, 0);

      logger.debug("Rotated log file", { processName });
    } catch (error) {
      logger.error("Failed to rotate log file", {
        processName,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Ensure log directory exists
   */
  private ensureLogDir(): void {
    try {
      fs.mkdirSync(this.options.logDir, { recursive: true });
    } catch (error) {
      logger.error("Failed to create log directory", {
        logDir: this.options.logDir,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
