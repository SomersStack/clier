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
      expect(result.pipeline[0]?.events?.on_stderr).toBe(true); // default value
      expect(result.pipeline[0]?.events?.on_crash).toBe(true); // default value
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
      expect(result.pipeline[0]?.events?.on_stdout).toHaveLength(2);
      expect(result.pipeline[0]?.events?.on_stdout[0]?.pattern).toBe("ready");
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
      expect(result.pipeline[0]?.events?.on_stderr).toBe(false);
      expect(result.pipeline[0]?.events?.on_crash).toBe(false);
    });

    it("should allow omitting events configuration entirely", () => {
      const config = {
        project_name: "no-events-test",
        safety: {
          max_ops_per_minute: 60,
          debounce_ms: 100,
        },
        pipeline: [
          {
            name: "test-service",
            command: "node server.js",
            type: "service",
          },
        ],
      };

      const result = configSchema.parse(config);
      expect(result).toBeDefined();
      expect(result.pipeline[0]?.events).toBeUndefined();
      expect(result.pipeline[0]?.name).toBe("test-service");
    });

    it("should allow mixed configurations with and without events", () => {
      const config = {
        project_name: "mixed-events-test",
        safety: {
          max_ops_per_minute: 60,
          debounce_ms: 100,
        },
        pipeline: [
          {
            name: "service-with-events",
            command: "npm start",
            type: "service",
            events: {
              on_stdout: [{ pattern: "ready", emit: "service:ready" }],
              on_stderr: true,
              on_crash: true,
            },
          },
          {
            name: "service-without-events",
            command: "npm run watch",
            type: "service",
          },
          {
            name: "task-without-events",
            command: "npm test",
            type: "task",
          },
        ],
      };

      const result = configSchema.parse(config);
      expect(result.pipeline).toHaveLength(3);
      expect(result.pipeline[0]?.events).toBeDefined();
      expect(result.pipeline[1]?.events).toBeUndefined();
      expect(result.pipeline[2]?.events).toBeUndefined();
    });
  });

  describe("Event Template Configuration", () => {
    it("should validate enable_event_templates field", () => {
      const config = {
        project_name: "template-test",
        safety: {
          max_ops_per_minute: 60,
          debounce_ms: 100,
        },
        pipeline: [
          {
            name: "test",
            command: "node app.js --source={{event.source}}",
            type: "task",
            enable_event_templates: true,
          },
        ],
      };

      const result = configSchema.parse(config);
      expect(result.pipeline[0]?.enable_event_templates).toBe(true);
    });

    it("should default enable_event_templates to false", () => {
      const config = {
        project_name: "default-test",
        safety: {
          max_ops_per_minute: 60,
          debounce_ms: 100,
        },
        pipeline: [
          {
            name: "test",
            command: "node app.js",
            type: "task",
          },
        ],
      };

      const result = configSchema.parse(config);
      expect(result.pipeline[0]?.enable_event_templates).toBe(false);
    });

    it("should allow enable_event_templates with trigger_on", () => {
      const config = {
        project_name: "triggered-template-test",
        safety: {
          max_ops_per_minute: 60,
          debounce_ms: 100,
        },
        pipeline: [
          {
            name: "producer",
            command: "node producer.js",
            type: "task",
            events: {
              on_stdout: [{ pattern: "done", emit: "producer:done" }],
            },
          },
          {
            name: "consumer",
            command: "node consumer.js --source={{event.source}}",
            type: "task",
            trigger_on: ["producer:done"],
            enable_event_templates: true,
          },
        ],
      };

      const result = configSchema.parse(config);
      expect(result.pipeline).toHaveLength(2);
      expect(result.pipeline[1]?.enable_event_templates).toBe(true);
      expect(result.pipeline[1]?.trigger_on).toEqual(["producer:done"]);
    });

    it("should work with backward compatibility (old configs without enable_event_templates)", () => {
      const config = {
        project_name: "legacy-test",
        safety: {
          max_ops_per_minute: 60,
          debounce_ms: 100,
        },
        pipeline: [
          {
            name: "old-service",
            command: "npm start",
            type: "service",
            events: {
              on_stdout: [{ pattern: "ready", emit: "service:ready" }],
              on_stderr: true,
              on_crash: true,
            },
          },
          {
            name: "old-task",
            command: "npm test",
            type: "task",
            trigger_on: ["service:ready"],
          },
        ],
      };

      // Should parse successfully without enable_event_templates field
      const result = configSchema.parse(config);
      expect(result).toBeDefined();
      expect(result.pipeline).toHaveLength(2);
      expect(result.pipeline[0]?.enable_event_templates).toBe(false);
      expect(result.pipeline[1]?.enable_event_templates).toBe(false);
    });

    it("should reject invalid enable_event_templates type", () => {
      const config = {
        project_name: "invalid-test",
        safety: {
          max_ops_per_minute: 60,
          debounce_ms: 100,
        },
        pipeline: [
          {
            name: "test",
            command: "node app.js",
            type: "task",
            enable_event_templates: "yes", // Should be boolean
          },
        ],
      };

      expect(() => configSchema.parse(config)).toThrow();
    });
  });

  describe("Stage Configuration", () => {
    it("should parse a valid stage with steps", () => {
      const config = {
        project_name: "stage-test",
        safety: {
          max_ops_per_minute: 60,
          debounce_ms: 100,
        },
        pipeline: [
          {
            name: "build-stage",
            type: "stage",
            steps: [
              {
                name: "frontend",
                command: "npm run build:frontend",
                type: "service",
              },
              {
                name: "backend",
                command: "npm run build:backend",
                type: "service",
              },
            ],
          },
        ],
      };

      const result = configSchema.parse(config);
      expect(result).toBeDefined();
      expect(result.pipeline).toHaveLength(1);
      expect(result.pipeline[0]?.type).toBe("stage");
      if (result.pipeline[0]?.type === "stage") {
        expect(result.pipeline[0]?.steps).toHaveLength(2);
      }
    });

    it("should parse a stage with manual and trigger_on", () => {
      const config = {
        project_name: "stage-options-test",
        safety: {
          max_ops_per_minute: 60,
          debounce_ms: 100,
        },
        pipeline: [
          {
            name: "deploy-stage",
            type: "stage",
            manual: true,
            trigger_on: ["build:complete"],
            steps: [
              {
                name: "deploy-frontend",
                command: "npm run deploy:frontend",
                type: "task",
              },
            ],
          },
        ],
      };

      const result = configSchema.parse(config);
      expect(result.pipeline[0]?.type).toBe("stage");
      if (result.pipeline[0]?.type === "stage") {
        expect(result.pipeline[0]?.manual).toBe(true);
        expect(result.pipeline[0]?.trigger_on).toEqual(["build:complete"]);
      }
    });

    it("should reject a stage without steps", () => {
      const config = {
        project_name: "empty-stage-test",
        safety: {
          max_ops_per_minute: 60,
          debounce_ms: 100,
        },
        pipeline: [
          {
            name: "empty-stage",
            type: "stage",
            steps: [],
          },
        ],
      };

      expect(() => configSchema.parse(config)).toThrow();
    });

    it("should reject a stage with empty name", () => {
      const config = {
        project_name: "no-name-stage-test",
        safety: {
          max_ops_per_minute: 60,
          debounce_ms: 100,
        },
        pipeline: [
          {
            name: "",
            type: "stage",
            steps: [
              {
                name: "step1",
                command: "npm test",
                type: "task",
              },
            ],
          },
        ],
      };

      expect(() => configSchema.parse(config)).toThrow();
    });

    it("should parse mixed pipeline with stages and individual items", () => {
      const config = {
        project_name: "mixed-test",
        safety: {
          max_ops_per_minute: 60,
          debounce_ms: 100,
        },
        pipeline: [
          {
            name: "db",
            command: "docker-compose up db",
            type: "service",
          },
          {
            name: "build-stage",
            type: "stage",
            steps: [
              {
                name: "frontend",
                command: "npm run build:frontend",
                type: "task",
              },
              {
                name: "backend",
                command: "npm run build:backend",
                type: "task",
              },
            ],
          },
          {
            name: "tests",
            command: "npm test",
            type: "task",
          },
        ],
      };

      const result = configSchema.parse(config);
      expect(result.pipeline).toHaveLength(3);
      expect(result.pipeline[0]?.type).toBe("service");
      expect(result.pipeline[1]?.type).toBe("stage");
      expect(result.pipeline[2]?.type).toBe("task");
    });

    it("should reject duplicate names across stages and steps", () => {
      const config = {
        project_name: "duplicate-test",
        safety: {
          max_ops_per_minute: 60,
          debounce_ms: 100,
        },
        pipeline: [
          {
            name: "frontend",
            command: "npm run frontend",
            type: "service",
          },
          {
            name: "build-stage",
            type: "stage",
            steps: [
              {
                name: "frontend", // Duplicate name
                command: "npm run build:frontend",
                type: "task",
              },
            ],
          },
        ],
      };

      expect(() => configSchema.parse(config)).toThrow(/duplicate.*name/i);
    });

    it("should reject duplicate names within a stage's steps", () => {
      const config = {
        project_name: "duplicate-in-stage-test",
        safety: {
          max_ops_per_minute: 60,
          debounce_ms: 100,
        },
        pipeline: [
          {
            name: "build-stage",
            type: "stage",
            steps: [
              {
                name: "step",
                command: "npm run step1",
                type: "task",
              },
              {
                name: "step", // Duplicate name
                command: "npm run step2",
                type: "task",
              },
            ],
          },
        ],
      };

      expect(() => configSchema.parse(config)).toThrow(/duplicate.*name/i);
    });

    it("should use discriminatedUnion for better error messages", () => {
      const config = {
        project_name: "invalid-type-test",
        safety: {
          max_ops_per_minute: 60,
          debounce_ms: 100,
        },
        pipeline: [
          {
            name: "invalid",
            type: "unknown", // Invalid type
            command: "npm test",
          },
        ],
      };

      // Should throw with clear message about invalid discriminator
      expect(() => configSchema.parse(config)).toThrow();
    });
  });
});
