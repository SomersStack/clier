import { describe, it, expect } from "vitest";
import {
  substituteVariables,
  getDefaultVariables,
  validateRequiredVariables,
  getUsedVariables,
  renderTemplate,
  formatVariableInfo,
} from "../../../src/templates/renderer.js";
import type {
  StageTemplate,
  VariableDefinition,
} from "../../../src/templates/types.js";

function makeTemplate(overrides: Partial<StageTemplate> = {}): StageTemplate {
  return {
    id: "test-template",
    name: "Test Template",
    description: "A test template",
    category: "service",
    stage: {
      name: "{{name}}",
      command: "node {{entrypoint}}",
      type: "service",
    },
    variables: [
      { name: "name", label: "Name", default: "api", required: true },
      { name: "entrypoint", label: "Entry Point", default: "server.js" },
    ],
    ...overrides,
  };
}

describe("Template Renderer", () => {
  describe("substituteVariables", () => {
    it("should replace placeholders with variable values", () => {
      const result = substituteVariables("Hello {{name}}", { name: "world" });
      expect(result).toBe("Hello world");
    });

    it("should replace multiple placeholders", () => {
      const result = substituteVariables("{{greeting}} {{name}}!", {
        greeting: "Hi",
        name: "Alice",
      });
      expect(result).toBe("Hi Alice!");
    });

    it("should keep unmatched placeholders as-is", () => {
      const result = substituteVariables("{{known}} and {{unknown}}", {
        known: "yes",
      });
      expect(result).toBe("yes and {{unknown}}");
    });

    it("should return the string unchanged when no placeholders exist", () => {
      const result = substituteVariables("no placeholders here", {
        name: "value",
      });
      expect(result).toBe("no placeholders here");
    });

    it("should return the string unchanged with empty variables", () => {
      const result = substituteVariables("{{name}}", {});
      expect(result).toBe("{{name}}");
    });

    it("should handle empty string template", () => {
      const result = substituteVariables("", { name: "value" });
      expect(result).toBe("");
    });

    it("should replace duplicate placeholders", () => {
      const result = substituteVariables("{{x}} and {{x}}", { x: "val" });
      expect(result).toBe("val and val");
    });

    it("should substitute empty string values", () => {
      const result = substituteVariables("prefix-{{name}}-suffix", {
        name: "",
      });
      expect(result).toBe("prefix--suffix");
    });

    it("should only match word characters in placeholders", () => {
      const result = substituteVariables("{{valid_name}} {{with-dash}}", {
        valid_name: "yes",
        "with-dash": "no",
      });
      expect(result).toBe("yes {{with-dash}}");
    });
  });

  describe("getDefaultVariables", () => {
    it("should extract default values from variables", () => {
      const template = makeTemplate();
      const defaults = getDefaultVariables(template);
      expect(defaults).toEqual({ name: "api", entrypoint: "server.js" });
    });

    it("should skip variables without defaults", () => {
      const template = makeTemplate({
        variables: [
          { name: "required_var", label: "Required", required: true },
          { name: "with_default", label: "With Default", default: "val" },
        ],
      });

      const defaults = getDefaultVariables(template);
      expect(defaults).toEqual({ with_default: "val" });
      expect("required_var" in defaults).toBe(false);
    });

    it("should return empty object when template has no variables", () => {
      const template = makeTemplate({ variables: undefined });
      const defaults = getDefaultVariables(template);
      expect(defaults).toEqual({});
    });

    it("should return empty object when variables array is empty", () => {
      const template = makeTemplate({ variables: [] });
      const defaults = getDefaultVariables(template);
      expect(defaults).toEqual({});
    });
  });

  describe("validateRequiredVariables", () => {
    it("should return empty array when all required variables are provided", () => {
      const template = makeTemplate();
      const missing = validateRequiredVariables(template, { name: "my-api" });
      expect(missing).toEqual([]);
    });

    it("should return missing required variable names", () => {
      const template = makeTemplate({
        variables: [
          { name: "name", label: "Name", required: true },
          { name: "port", label: "Port", required: true },
          { name: "host", label: "Host" },
        ],
      });

      const missing = validateRequiredVariables(template, {});
      expect(missing).toEqual(["name", "port"]);
    });

    it("should not flag optional variables as missing", () => {
      const template = makeTemplate({
        variables: [
          { name: "optional", label: "Optional" },
          { name: "also_optional", label: "Also Optional", required: false },
        ],
      });

      const missing = validateRequiredVariables(template, {});
      expect(missing).toEqual([]);
    });

    it("should return empty array when template has no variables", () => {
      const template = makeTemplate({ variables: undefined });
      const missing = validateRequiredVariables(template, {});
      expect(missing).toEqual([]);
    });

    it("should detect partially provided required variables", () => {
      const template = makeTemplate({
        variables: [
          { name: "a", label: "A", required: true },
          { name: "b", label: "B", required: true },
          { name: "c", label: "C", required: true },
        ],
      });

      const missing = validateRequiredVariables(template, {
        a: "val",
        c: "val",
      });
      expect(missing).toEqual(["b"]);
    });
  });

  describe("getUsedVariables", () => {
    it("should find variables in stage config", () => {
      const template = makeTemplate();
      const used = getUsedVariables(template);
      expect(used).toContain("name");
      expect(used).toContain("entrypoint");
    });

    it("should return empty array when no variables are used", () => {
      const template = makeTemplate({
        stage: {
          name: "static",
          command: "echo hello",
          type: "task",
        },
      });

      const used = getUsedVariables(template);
      expect(used).toEqual([]);
    });

    it("should find variables in nested stage properties", () => {
      const template = makeTemplate({
        stage: {
          name: "{{name}}",
          command: "node app.js",
          type: "service",
          env: { PORT: "{{port}}" },
          events: {
            on_stdout: [{ pattern: "{{pattern}}", emit: "{{name}}:ready" }],
            on_stderr: true,
            on_crash: true,
          },
        },
      });

      const used = getUsedVariables(template);
      expect(used).toContain("name");
      expect(used).toContain("port");
      expect(used).toContain("pattern");
    });

    it("should deduplicate repeated variable references", () => {
      const template = makeTemplate({
        stage: {
          name: "{{name}}",
          command: "echo {{name}}",
          type: "task",
        },
      });

      const used = getUsedVariables(template);
      const nameOccurrences = used.filter((v) => v === "name");
      expect(nameOccurrences).toHaveLength(1);
    });
  });

  describe("renderTemplate", () => {
    it("should render with provided variables", () => {
      const template = makeTemplate();
      const result = renderTemplate(template, {
        name: "my-api",
        entrypoint: "index.js",
      });

      expect(result.name).toBe("my-api");
      expect(result.command).toBe("node index.js");
    });

    it("should use defaults when no variables provided", () => {
      const template = makeTemplate();
      const result = renderTemplate(template);

      expect(result.name).toBe("api");
      expect(result.command).toBe("node server.js");
    });

    it("should override defaults with provided variables", () => {
      const template = makeTemplate();
      const result = renderTemplate(template, { name: "custom" });

      expect(result.name).toBe("custom");
      expect(result.command).toBe("node server.js"); // default for entrypoint
    });

    it("should keep unmatched placeholders in output", () => {
      const template = makeTemplate({
        stage: {
          name: "{{name}}",
          command: "{{unknown_var}} run",
          type: "task",
        },
        variables: [],
      });

      const result = renderTemplate(template);
      expect(result.command).toBe("{{unknown_var}} run");
    });

    it("should substitute in nested objects like env", () => {
      const template = makeTemplate({
        stage: {
          name: "api",
          command: "node server.js",
          type: "service",
          env: { PORT: "{{port}}", HOST: "{{host}}" },
        },
        variables: [
          { name: "port", label: "Port", default: "3000" },
          { name: "host", label: "Host", default: "localhost" },
        ],
      });

      const result = renderTemplate(template);
      expect(result.env).toEqual({ PORT: "3000", HOST: "localhost" });
    });

    it("should substitute in arrays like trigger_on", () => {
      const template = makeTemplate({
        stage: {
          name: "consumer",
          command: "node consumer.js",
          type: "task",
          trigger_on: ["{{dependency}}:ready"],
        },
        variables: [{ name: "dependency", label: "Dependency", default: "db" }],
      });

      const result = renderTemplate(template);
      expect(result.trigger_on).toEqual(["db:ready"]);
    });

    it("should preserve non-string values", () => {
      const template = makeTemplate({
        stage: {
          name: "test",
          command: "test",
          type: "service",
          continue_on_failure: true,
          manual: false,
        },
        variables: [],
      });

      const result = renderTemplate(template);
      expect(result.continue_on_failure).toBe(true);
      expect(result.manual).toBe(false);
    });
  });

  describe("formatVariableInfo", () => {
    it("should format variable definitions for display", () => {
      const variables: VariableDefinition[] = [
        {
          name: "port",
          label: "Port Number",
          default: "3000",
          description: "The port to listen on",
          required: true,
        },
        {
          name: "host",
          label: "Hostname",
        },
      ];

      const result = formatVariableInfo(variables);
      expect(result).toHaveLength(2);

      expect(result[0]).toEqual({
        name: "port",
        label: "Port Number",
        required: true,
        default: "3000",
        description: "The port to listen on",
      });

      expect(result[1]).toEqual({
        name: "host",
        label: "Hostname",
        required: false,
        default: undefined,
        description: undefined,
      });
    });

    it("should return empty array for empty input", () => {
      const result = formatVariableInfo([]);
      expect(result).toEqual([]);
    });

    it("should default required to false when not specified", () => {
      const variables: VariableDefinition[] = [{ name: "x", label: "X" }];

      const result = formatVariableInfo(variables);
      expect(result[0]!.required).toBe(false);
    });
  });
});
