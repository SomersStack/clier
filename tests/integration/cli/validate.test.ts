/**
 * Integration tests for validate command
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { validateCommand } from "../../../src/cli/commands/validate.js";

describe("validate command", () => {
  let tempDir: string;

  beforeEach(async () => {
    // Create temporary directory for test files
    tempDir = await mkdtemp(path.join(tmpdir(), "clier-test-"));
  });

  afterEach(async () => {
    // Clean up temporary directory
    await rm(tempDir, { recursive: true, force: true });
  });

  it("should validate a valid configuration file", async () => {
    const configPath = path.join(tempDir, "clier-pipeline.json");
    const validConfig = {
      project_name: "test-project",
      global_env: true,
      safety: {
        max_ops_per_minute: 60,
        debounce_ms: 100,
      },
      pipeline: [
        {
          name: "backend",
          command: "npm start",
          type: "service",
          events: {
            on_stdout: [{ pattern: "ready", emit: "backend:ready" }],
            on_stderr: true,
            on_crash: true,
          },
        },
      ],
    };

    await writeFile(configPath, JSON.stringify(validConfig, null, 2));

    const exitCode = await validateCommand(configPath);

    expect(exitCode).toBe(0);
  });

  it("should fail for invalid configuration schema", async () => {
    const configPath = path.join(tempDir, "clier-pipeline.json");
    const invalidConfig = {
      project_name: "test-project",
      // Missing safety field
      pipeline: [],
    };

    await writeFile(configPath, JSON.stringify(invalidConfig, null, 2));

    const exitCode = await validateCommand(configPath);

    expect(exitCode).toBe(1);
  });

  it("should fail for missing configuration file", async () => {
    const configPath = path.join(tempDir, "nonexistent.json");

    const exitCode = await validateCommand(configPath);

    expect(exitCode).toBe(1);
  });

  it("should fail for invalid JSON", async () => {
    const configPath = path.join(tempDir, "clier-pipeline.json");
    await writeFile(configPath, "{ invalid json }");

    const exitCode = await validateCommand(configPath);

    expect(exitCode).toBe(1);
  });

  it("should validate configuration with all optional fields", async () => {
    const configPath = path.join(tempDir, "clier-pipeline.json");
    const validConfig = {
      project_name: "test-project",
      global_env: false,
      safety: {
        max_ops_per_minute: 120,
        debounce_ms: 200,
      },
      pipeline: [
        {
          name: "backend",
          command: "npm start",
          type: "service",
          trigger_on: ["build:complete"],
          continue_on_failure: true,
          env: {
            PORT: "3000",
            NODE_ENV: "production",
          },
          cwd: "/app/backend",
          events: {
            on_stdout: [
              { pattern: "Server listening", emit: "backend:ready" },
              { pattern: "Error:", emit: "backend:error" },
            ],
            on_stderr: true,
            on_crash: true,
          },
        },
      ],
    };

    await writeFile(configPath, JSON.stringify(validConfig, null, 2));

    const exitCode = await validateCommand(configPath);

    expect(exitCode).toBe(0);
  });
});
