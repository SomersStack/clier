import { describe, it, expect } from "vitest";
import { configSchema } from "../../../src/config/schema.js";
import type { ClierConfig } from "../../../src/config/types.js";

describe("Config Schema Validation", () => {
  describe("Valid Configuration", () => {
    it("should parse a minimal valid config", () => {
      const config = {
        project_name: "test-project",
        global_env: true,
        safety: {
          max_ops_per_minute: 60,
          debounce_ms: 100,
        },
        pipeline: [
          {
            name: "test-service",
            command: "node server.js",
            type: "service",
            events: {
              on_stdout: [],
            },
          },
        ],
      };

      const result = configSchema.parse(config);
      expect(result).toBeDefined();
      expect(result.project_name).toBe("test-project");
      expect(result.pipeline).toHaveLength(1);
    });

    it("should parse a full-featured config", () => {
      const config = {
        project_name: "full-project",
        global_env: false,
        safety: {
          max_ops_per_minute: 120,
          debounce_ms: 50,
        },
        pipeline: [
          {
            name: "backend",
            command: "npm start",
            type: "service",
            env: {
              PORT: "3000",
              NODE_ENV: "${NODE_ENV}",
            },
            cwd: "/app/backend",
            events: {
              on_stdout: [
                {
                  pattern: "Server listening",
                  emit: "backend:ready",
                },
              ],
              on_stderr: true,
              on_crash: true,
            },
          },
          {
            name: "migrate",
            command: "npm run migrate",
            type: "task",
            trigger_on: ["backend:ready"],
            continue_on_failure: false,
            env: {
              DATABASE_URL: "${DATABASE_URL}",
            },
            cwd: "/app/backend",
            events: {
              on_stdout: [
                {
                  pattern: "Migration complete",
                  emit: "migrate:done",
                },
              ],
              on_stderr: true,
              on_crash: false,
            },
          },
        ],
      };

      const result = configSchema.parse(config);
      expect(result).toBeDefined();
      expect(result.pipeline).toHaveLength(2);
      expect(result.pipeline[0]?.name).toBe("backend");
      expect(result.pipeline[0]?.env?.PORT).toBe("3000");
      expect(result.pipeline[1]?.trigger_on).toEqual(["backend:ready"]);
    });

    it("should apply default values correctly", () => {
      const config = {
        project_name: "defaults-test",
        safety: {
          max_ops_per_minute: 60,
          debounce_ms: 100,
        },
        pipeline: [
          {
            name: "service",
            command: "node app.js",
            type: "service",
            events: {
              on_stdout: [],
            },
          },
        ],
      };

      const result = configSchema.parse(config);
      expect(result.global_env).toBe(true); // default value
      expect(result.pipeline[0]?.events.on_stderr).toBe(true); // default value
      expect(result.pipeline[0]?.events.on_crash).toBe(true); // default value
    });
  });

  describe("Invalid Configuration", () => {
    it("should reject config without project_name", () => {
      const config = {
        global_env: true,
        safety: {
          max_ops_per_minute: 60,
          debounce_ms: 100,
        },
        pipeline: [],
      };

      expect(() => configSchema.parse(config)).toThrow();
    });

    it("should reject config without safety settings", () => {
      const config = {
        project_name: "test",
        pipeline: [],
      };

      expect(() => configSchema.parse(config)).toThrow();
    });

    it("should reject config with invalid pipeline type", () => {
      const config = {
        project_name: "test",
        safety: {
          max_ops_per_minute: 60,
          debounce_ms: 100,
        },
        pipeline: [
          {
            name: "invalid",
            command: "test",
            type: "invalid-type",
            events: {
              on_stdout: [],
            },
          },
        ],
      };

      expect(() => configSchema.parse(config)).toThrow();
    });

    it("should reject config with duplicate pipeline names", () => {
      const config = {
        project_name: "test",
        safety: {
          max_ops_per_minute: 60,
          debounce_ms: 100,
        },
        pipeline: [
          {
            name: "duplicate",
            command: "test1",
            type: "service",
            events: {
              on_stdout: [],
            },
          },
          {
            name: "duplicate",
            command: "test2",
            type: "service",
            events: {
              on_stdout: [],
            },
          },
        ],
      };

      expect(() => configSchema.parse(config)).toThrow(/duplicate.*name/i);
    });

    it("should reject config with missing required pipeline fields", () => {
      const config = {
        project_name: "test",
        safety: {
          max_ops_per_minute: 60,
          debounce_ms: 100,
        },
        pipeline: [
          {
            name: "incomplete",
            // missing command
            type: "service",
            events: {
              on_stdout: [],
            },
          },
        ],
      };

      expect(() => configSchema.parse(config)).toThrow();
    });

    it("should reject config with invalid stdout event pattern", () => {
      const config = {
        project_name: "test",
        safety: {
          max_ops_per_minute: 60,
          debounce_ms: 100,
        },
        pipeline: [
          {
            name: "test",
            command: "test",
            type: "service",
            events: {
              on_stdout: [
                {
                  pattern: "",
                  emit: "event",
                },
              ],
            },
          },
        ],
      };

      expect(() => configSchema.parse(config)).toThrow();
    });

    it("should reject config with invalid event emit name", () => {
      const config = {
        project_name: "test",
        safety: {
          max_ops_per_minute: 60,
          debounce_ms: 100,
        },
        pipeline: [
          {
            name: "test",
            command: "test",
            type: "service",
            events: {
              on_stdout: [
                {
                  pattern: "test",
                  emit: "",
                },
              ],
            },
          },
        ],
      };

      expect(() => configSchema.parse(config)).toThrow();
    });

    it("should reject config with extra unknown fields in strict mode", () => {
      const config = {
        project_name: "test",
        safety: {
          max_ops_per_minute: 60,
          debounce_ms: 100,
        },
        pipeline: [],
        unknown_field: "should-fail",
      };

      expect(() => configSchema.parse(config)).toThrow();
    });

    it("should reject config with negative safety values", () => {
      const config = {
        project_name: "test",
        safety: {
          max_ops_per_minute: -1,
          debounce_ms: 100,
        },
        pipeline: [],
      };

      expect(() => configSchema.parse(config)).toThrow();
    });
  });

  describe("Type Safety", () => {
    it("should infer correct TypeScript types", () => {
      const config: ClierConfig = {
        project_name: "type-test",
        global_env: true,
        safety: {
          max_ops_per_minute: 60,
          debounce_ms: 100,
        },
        pipeline: [
          {
            name: "test",
            command: "test",
            type: "service",
            events: {
              on_stdout: [],
              on_stderr: true,
              on_crash: true,
            },
          },
        ],
      };

      const result = configSchema.parse(config);

      // Type assertions to verify TypeScript types
      expect(typeof result.project_name).toBe("string");
      expect(typeof result.global_env).toBe("boolean");
      expect(typeof result.safety.max_ops_per_minute).toBe("number");
      expect(Array.isArray(result.pipeline)).toBe(true);
    });

    it("should handle optional fields correctly", () => {
      const config = {
        project_name: "optional-test",
        safety: {
          max_ops_per_minute: 60,
          debounce_ms: 100,
        },
        pipeline: [
          {
            name: "test",
            command: "test",
            type: "task",
            events: {
              on_stdout: [],
            },
          },
        ],
      };

      const result = configSchema.parse(config);

      expect(result.pipeline[0]?.trigger_on).toBeUndefined();
      expect(result.pipeline[0]?.continue_on_failure).toBeUndefined();
      expect(result.pipeline[0]?.env).toBeUndefined();
      expect(result.pipeline[0]?.cwd).toBeUndefined();
    });
  });

  describe("Environment Variable Substitution Support", () => {
    it("should accept ${VAR} syntax in env values", () => {
      const config = {
        project_name: "env-test",
        safety: {
          max_ops_per_minute: 60,
          debounce_ms: 100,
        },
        pipeline: [
          {
            name: "test",
            command: "test",
            type: "service",
            env: {
              PORT: "${PORT}",
              NODE_ENV: "${NODE_ENV}",
              STATIC_VALUE: "3000",
            },
            events: {
              on_stdout: [],
            },
          },
        ],
      };

      const result = configSchema.parse(config);
      expect(result.pipeline[0]?.env?.PORT).toBe("${PORT}");
      expect(result.pipeline[0]?.env?.STATIC_VALUE).toBe("3000");
    });
  });

  describe("Event Configuration", () => {
    it("should validate on_stdout patterns correctly", () => {
      const config = {
        project_name: "event-test",
        safety: {
          max_ops_per_minute: 60,
          debounce_ms: 100,
        },
        pipeline: [
          {
            name: "test",
            command: "test",
            type: "service",
            events: {
              on_stdout: [
                {
                  pattern: "ready",
                  emit: "service:ready",
                },
                {
                  pattern: "error",
                  emit: "service:error",
                },
              ],
            },
          },
        ],
      };

      const result = configSchema.parse(config);
      expect(result.pipeline[0]?.events.on_stdout).toHaveLength(2);
      expect(result.pipeline[0]?.events.on_stdout[0]?.pattern).toBe("ready");
    });

    it("should handle boolean event flags", () => {
      const config = {
        project_name: "flags-test",
        safety: {
          max_ops_per_minute: 60,
          debounce_ms: 100,
        },
        pipeline: [
          {
            name: "test",
            command: "test",
            type: "service",
            events: {
              on_stdout: [],
              on_stderr: false,
              on_crash: false,
            },
          },
        ],
      };

      const result = configSchema.parse(config);
      expect(result.pipeline[0]?.events.on_stderr).toBe(false);
      expect(result.pipeline[0]?.events.on_crash).toBe(false);
    });
  });
});
