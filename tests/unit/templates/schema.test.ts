import { describe, it, expect } from "vitest";
import {
  scriptDefinitionSchema,
  variableDefinitionSchema,
  stageTemplateSchema,
  templateManifestSchema,
} from "../../../src/templates/schema.js";

describe("Template Schema Validation", () => {
  describe("scriptDefinitionSchema", () => {
    it("should accept a script with bundledScript", () => {
      const script = {
        path: "scripts/build.sh",
        bundledScript: "build.sh",
        executable: true,
        description: "Build script",
      };

      const result = scriptDefinitionSchema.parse(script);
      expect(result.path).toBe("scripts/build.sh");
      expect(result.bundledScript).toBe("build.sh");
      expect(result.executable).toBe(true);
    });

    it("should accept a script with inline content", () => {
      const script = {
        path: "scripts/run.sh",
        content: "#!/bin/bash\necho hello",
      };

      const result = scriptDefinitionSchema.parse(script);
      expect(result.path).toBe("scripts/run.sh");
      expect(result.content).toBe("#!/bin/bash\necho hello");
    });

    it("should accept a script with both bundledScript and content", () => {
      const script = {
        path: "scripts/run.sh",
        bundledScript: "run.sh",
        content: "#!/bin/bash\necho hello",
      };

      const result = scriptDefinitionSchema.parse(script);
      expect(result.bundledScript).toBe("run.sh");
      expect(result.content).toBe("#!/bin/bash\necho hello");
    });

    it("should reject a script with neither bundledScript nor content", () => {
      const script = {
        path: "scripts/empty.sh",
        executable: true,
      };

      expect(() => scriptDefinitionSchema.parse(script)).toThrow(
        /must have either bundledScript or content/,
      );
    });

    it("should reject a script with empty path", () => {
      const script = {
        path: "",
        content: "echo hello",
      };

      expect(() => scriptDefinitionSchema.parse(script)).toThrow();
    });

    it("should accept a script with only required fields", () => {
      const script = {
        path: "run.sh",
        content: "echo hi",
      };

      const result = scriptDefinitionSchema.parse(script);
      expect(result.executable).toBeUndefined();
      expect(result.description).toBeUndefined();
    });
  });

  describe("variableDefinitionSchema", () => {
    it("should accept a valid variable definition", () => {
      const variable = {
        name: "port",
        label: "Port Number",
        default: "3000",
        description: "The port to listen on",
        required: true,
      };

      const result = variableDefinitionSchema.parse(variable);
      expect(result.name).toBe("port");
      expect(result.label).toBe("Port Number");
      expect(result.default).toBe("3000");
      expect(result.required).toBe(true);
    });

    it("should accept a minimal variable definition", () => {
      const variable = {
        name: "host",
        label: "Hostname",
      };

      const result = variableDefinitionSchema.parse(variable);
      expect(result.name).toBe("host");
      expect(result.default).toBeUndefined();
      expect(result.required).toBeUndefined();
    });

    it("should reject a variable with empty name", () => {
      const variable = {
        name: "",
        label: "Something",
      };

      expect(() => variableDefinitionSchema.parse(variable)).toThrow();
    });

    it("should reject a variable with empty label", () => {
      const variable = {
        name: "valid",
        label: "",
      };

      expect(() => variableDefinitionSchema.parse(variable)).toThrow();
    });

    it("should reject a variable with missing name", () => {
      const variable = {
        label: "Something",
      };

      expect(() => variableDefinitionSchema.parse(variable)).toThrow();
    });
  });

  describe("stageTemplateSchema", () => {
    const validStage = {
      name: "api",
      command: "node server.js",
      type: "service" as const,
    };

    it("should accept a minimal valid template", () => {
      const template = {
        id: "node-api",
        name: "Node.js API",
        description: "A Node.js API server",
        category: "service" as const,
        stage: validStage,
      };

      const result = stageTemplateSchema.parse(template);
      expect(result.id).toBe("node-api");
      expect(result.category).toBe("service");
      expect(result.tags).toBeUndefined();
      expect(result.variables).toBeUndefined();
      expect(result.scripts).toBeUndefined();
    });

    it("should accept a full-featured template", () => {
      const template = {
        id: "node-api",
        name: "Node.js API",
        description: "A Node.js API server",
        category: "service" as const,
        tags: ["node", "api"],
        stage: {
          name: "{{name}}",
          command: "node {{entrypoint}}",
          type: "service" as const,
          env: { PORT: "{{port}}" },
          cwd: "./backend",
          events: {
            on_stdout: [{ pattern: "listening", emit: "{{name}}:ready" }],
            on_stderr: true,
            on_crash: true,
          },
          trigger_on: ["db:ready"],
          continue_on_failure: false,
          enable_event_templates: true,
          manual: false,
        },
        variables: [
          { name: "name", label: "Name", default: "api", required: true },
          { name: "entrypoint", label: "Entry Point", default: "server.js" },
          { name: "port", label: "Port", default: "3000" },
        ],
        scripts: [
          {
            path: "scripts/start.sh",
            content: "#!/bin/bash\nnode server.js",
            executable: true,
            description: "Start script",
          },
        ],
      };

      const result = stageTemplateSchema.parse(template);
      expect(result.tags).toEqual(["node", "api"]);
      expect(result.variables).toHaveLength(3);
      expect(result.scripts).toHaveLength(1);
      expect(result.stage.events?.on_stdout).toHaveLength(1);
    });

    it("should reject a template with empty id", () => {
      const template = {
        id: "",
        name: "Test",
        description: "Test template",
        category: "service",
        stage: validStage,
      };

      expect(() => stageTemplateSchema.parse(template)).toThrow();
    });

    it("should reject a template with empty name", () => {
      const template = {
        id: "test",
        name: "",
        description: "Test template",
        category: "service",
        stage: validStage,
      };

      expect(() => stageTemplateSchema.parse(template)).toThrow();
    });

    it("should reject a template with empty description", () => {
      const template = {
        id: "test",
        name: "Test",
        description: "",
        category: "service",
        stage: validStage,
      };

      expect(() => stageTemplateSchema.parse(template)).toThrow();
    });

    it("should reject a template with invalid category", () => {
      const template = {
        id: "test",
        name: "Test",
        description: "Test template",
        category: "invalid",
        stage: validStage,
      };

      expect(() => stageTemplateSchema.parse(template)).toThrow();
    });

    it("should accept all valid category values", () => {
      for (const category of ["service", "task", "utility"]) {
        const template = {
          id: "test",
          name: "Test",
          description: "Test template",
          category,
          stage: validStage,
        };

        const result = stageTemplateSchema.parse(template);
        expect(result.category).toBe(category);
      }
    });

    it("should reject a stage with invalid type", () => {
      const template = {
        id: "test",
        name: "Test",
        description: "Test template",
        category: "service",
        stage: {
          name: "test",
          command: "test",
          type: "worker",
        },
      };

      expect(() => stageTemplateSchema.parse(template)).toThrow();
    });

    it("should reject a stage with empty command", () => {
      const template = {
        id: "test",
        name: "Test",
        description: "Test template",
        category: "task",
        stage: {
          name: "test",
          command: "",
          type: "task",
        },
      };

      expect(() => stageTemplateSchema.parse(template)).toThrow();
    });

    it("should reject a stage with empty stdout event pattern", () => {
      const template = {
        id: "test",
        name: "Test",
        description: "Test",
        category: "service",
        stage: {
          name: "test",
          command: "test",
          type: "service",
          events: {
            on_stdout: [{ pattern: "", emit: "test:ready" }],
          },
        },
      };

      expect(() => stageTemplateSchema.parse(template)).toThrow();
    });

    it("should apply event defaults for on_stderr and on_crash", () => {
      const template = {
        id: "test",
        name: "Test",
        description: "Test",
        category: "service",
        stage: {
          name: "test",
          command: "test",
          type: "service",
          events: {
            on_stdout: [],
          },
        },
      };

      const result = stageTemplateSchema.parse(template);
      expect(result.stage.events?.on_stderr).toBe(true);
      expect(result.stage.events?.on_crash).toBe(true);
    });
  });

  describe("templateManifestSchema", () => {
    it("should accept a valid manifest", () => {
      const manifest = {
        templates: ["node-api", "build-task", "lint-task"],
      };

      const result = templateManifestSchema.parse(manifest);
      expect(result.templates).toHaveLength(3);
      expect(result.templates).toContain("node-api");
    });

    it("should accept an empty manifest", () => {
      const manifest = {
        templates: [],
      };

      const result = templateManifestSchema.parse(manifest);
      expect(result.templates).toHaveLength(0);
    });

    it("should reject a manifest without templates field", () => {
      const manifest = {};

      expect(() => templateManifestSchema.parse(manifest)).toThrow();
    });

    it("should reject a manifest with non-string template IDs", () => {
      const manifest = {
        templates: [123, true],
      };

      expect(() => templateManifestSchema.parse(manifest)).toThrow();
    });
  });
});
