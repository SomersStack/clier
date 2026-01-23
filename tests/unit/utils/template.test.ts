import { describe, it, expect } from "vitest";
import {
  substituteEventTemplates,
  validateTemplateString,
  getAvailableVariables,
  hasTemplates,
  createTemplateContext,
  type TemplateContext,
} from "../../../src/utils/template.js";
import type { ClierEvent } from "../../../src/types/events.js";

describe("Template Engine", () => {
  // Sample template context
  const createContext = (
    eventOverrides?: Partial<TemplateContext["event"]>,
  ): TemplateContext => ({
    event: {
      name: "backend:ready",
      type: "custom",
      timestamp: 1706012345678,
      source: "backend",
      ...eventOverrides,
    },
    process: {
      name: "frontend",
      type: "service",
    },
    clier: {
      project: "my-app",
    },
  });

  describe("substituteEventTemplates", () => {
    it("should substitute event.name", () => {
      const template = "cmd --event={{event.name}}";
      const result = substituteEventTemplates(template, createContext());
      expect(result).toBe("cmd --event=backend:ready");
    });

    it("should substitute event.type", () => {
      const template = "cmd --type={{event.type}}";
      const result = substituteEventTemplates(template, createContext());
      expect(result).toBe("cmd --type=custom");
    });

    it("should substitute event.timestamp", () => {
      const template = "cmd --ts={{event.timestamp}}";
      const result = substituteEventTemplates(template, createContext());
      expect(result).toBe("cmd --ts=1706012345678");
    });

    it("should substitute event.source", () => {
      const template = "cmd --source={{event.source}}";
      const result = substituteEventTemplates(template, createContext());
      expect(result).toBe("cmd --source=backend");
    });

    it("should substitute process.name", () => {
      const template = "cmd --proc={{process.name}}";
      const result = substituteEventTemplates(template, createContext());
      expect(result).toBe("cmd --proc=frontend");
    });

    it("should substitute process.type", () => {
      const template = "cmd --ptype={{process.type}}";
      const result = substituteEventTemplates(template, createContext());
      expect(result).toBe("cmd --ptype=service");
    });

    it("should substitute clier.project", () => {
      const template = "cmd --project={{clier.project}}";
      const result = substituteEventTemplates(template, createContext());
      expect(result).toBe("cmd --project=my-app");
    });

    it("should substitute clier.timestamp with current time", () => {
      const template = "cmd --now={{clier.timestamp}}";
      const result = substituteEventTemplates(template, createContext());

      // Should be a valid timestamp string
      expect(result).toMatch(/^cmd --now=\d+$/);

      // Should be close to current time (within 1 second)
      const timestamp = parseInt(result.split("=")[1] || "0");
      const now = Date.now();
      expect(Math.abs(timestamp - now)).toBeLessThan(1000);
    });

    it("should substitute multiple templates in one string", () => {
      const template =
        "node app.js --source={{event.source}} --event={{event.name}} --proc={{process.name}}";
      const result = substituteEventTemplates(template, createContext());
      expect(result).toBe(
        "node app.js --source=backend --event=backend:ready --proc=frontend",
      );
    });

    it("should substitute same template multiple times", () => {
      const template = "{{event.source}} triggered {{event.source}}";
      const result = substituteEventTemplates(template, createContext());
      expect(result).toBe("backend triggered backend");
    });

    it("should handle strings with no templates", () => {
      const template = "node server.js --port=3000";
      const result = substituteEventTemplates(template, createContext());
      expect(result).toBe("node server.js --port=3000");
    });

    it("should handle empty strings", () => {
      const result = substituteEventTemplates("", createContext());
      expect(result).toBe("");
    });

    it("should leave unknown templates unchanged", () => {
      const template = "cmd --unknown={{event.unknown}}";
      const result = substituteEventTemplates(template, createContext());
      expect(result).toBe("cmd --unknown={{event.unknown}}");
    });

    it("should handle context without event (entry point process)", () => {
      const contextNoEvent: TemplateContext = {
        event: undefined,
        process: { name: "entry", type: "service" },
        clier: { project: "test" },
      };

      const template = "cmd --event={{event.name}}";
      const result = substituteEventTemplates(template, contextNoEvent);

      // Should return unchanged since no event context
      expect(result).toBe(template);
    });

    it("should handle templates with different event types", () => {
      const contexts = [
        createContext({ type: "success" }),
        createContext({ type: "error" }),
        createContext({ type: "crashed" }),
      ];

      contexts.forEach((ctx) => {
        const result = substituteEventTemplates(
          "{{event.type}}",
          ctx,
        );
        expect(result).toBe(ctx.event!.type);
      });
    });

    it("should handle special characters in values", () => {
      const context = createContext({
        name: "test:event:with:colons",
        source: "my-process-name",
      });

      const result = substituteEventTemplates(
        "{{event.name}}|{{event.source}}",
        context,
      );
      expect(result).toBe("test:event:with:colons|my-process-name");
    });
  });

  describe("validateTemplateString", () => {
    it("should validate correct template syntax", () => {
      const template = "cmd --event={{event.name}}";
      const result = validateTemplateString(template);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.usedVariables).toContain("event.name");
    });

    it("should detect unclosed template brackets", () => {
      const template = "cmd --event={{event.name}";
      const result = validateTemplateString(template);

      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain("Mismatched template brackets");
    });

    it("should detect extra closing brackets", () => {
      const template = "cmd --event={{event.name}}}}";
      const result = validateTemplateString(template);

      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain("Mismatched template brackets");
    });

    it("should warn about unknown variables", () => {
      const template = "cmd --unknown={{event.invalid}}";
      const result = validateTemplateString(template);

      expect(result.valid).toBe(true); // Valid syntax, just unknown var
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain("Unknown template variable");
    });

    it("should track all used variables", () => {
      const template =
        "{{event.name}} {{event.source}} {{process.name}} {{clier.project}}";
      const result = validateTemplateString(template);

      expect(result.usedVariables).toHaveLength(4);
      expect(result.usedVariables).toContain("event.name");
      expect(result.usedVariables).toContain("event.source");
      expect(result.usedVariables).toContain("process.name");
      expect(result.usedVariables).toContain("clier.project");
    });

    it("should handle empty templates", () => {
      const result = validateTemplateString("");

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.usedVariables).toHaveLength(0);
    });

    it("should handle templates with no variables", () => {
      const template = "plain command with no templates";
      const result = validateTemplateString(template);

      expect(result.valid).toBe(true);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain("No template variables found");
    });

    it("should validate all known variables without warnings", () => {
      const template = `
        {{event.name}}
        {{event.type}}
        {{event.timestamp}}
        {{event.source}}
        {{process.name}}
        {{process.type}}
        {{clier.project}}
        {{clier.timestamp}}
      `;
      const result = validateTemplateString(template);

      expect(result.valid).toBe(true);
      expect(result.warnings).toHaveLength(0);
      expect(result.usedVariables).toHaveLength(8);
    });

    it("should handle requiresEvent=false for entry point processes", () => {
      const template = "cmd --proc={{process.name}}";
      const result = validateTemplateString(template, false);

      expect(result.valid).toBe(true);
      expect(result.warnings).toHaveLength(0);
    });

    it("should warn if event variables used in entry point", () => {
      const template = "cmd --event={{event.name}}";
      const result = validateTemplateString(template, false);

      expect(result.valid).toBe(true);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain("may not have event context");
    });
  });

  describe("getAvailableVariables", () => {
    it("should return all available template variables", () => {
      const variables = getAvailableVariables();

      expect(variables).toHaveLength(8);
      expect(variables.map((v) => v.name)).toContain("{{event.name}}");
      expect(variables.map((v) => v.name)).toContain("{{event.type}}");
      expect(variables.map((v) => v.name)).toContain("{{event.timestamp}}");
      expect(variables.map((v) => v.name)).toContain("{{event.source}}");
      expect(variables.map((v) => v.name)).toContain("{{process.name}}");
      expect(variables.map((v) => v.name)).toContain("{{process.type}}");
      expect(variables.map((v) => v.name)).toContain("{{clier.project}}");
      expect(variables.map((v) => v.name)).toContain("{{clier.timestamp}}");
    });

    it("should include descriptions and examples", () => {
      const variables = getAvailableVariables();

      variables.forEach((variable) => {
        expect(variable.name).toBeTruthy();
        expect(variable.description).toBeTruthy();
        expect(variable.example).toBeTruthy();
      });
    });
  });

  describe("hasTemplates", () => {
    it("should detect templates", () => {
      expect(hasTemplates("{{event.name}}")).toBe(true);
      expect(hasTemplates("cmd --arg={{value}}")).toBe(true);
      expect(hasTemplates("start {{a}} middle {{b}} end")).toBe(true);
    });

    it("should return false for strings without templates", () => {
      expect(hasTemplates("plain text")).toBe(false);
      expect(hasTemplates("cmd --arg=value")).toBe(false);
      expect(hasTemplates("")).toBe(false);
    });

    it("should handle malformed brackets", () => {
      expect(hasTemplates("{{incomplete")).toBe(false);
      expect(hasTemplates("incomplete}}")).toBe(false);
      expect(hasTemplates("{single}")).toBe(false);
    });
  });

  describe("createTemplateContext", () => {
    it("should create context from ClierEvent", () => {
      const event: ClierEvent = {
        name: "test:event",
        processName: "source-process",
        type: "custom",
        timestamp: 1234567890,
      };

      const context = createTemplateContext(
        event,
        "target-process",
        "task",
        "test-project",
      );

      expect(context.event).toEqual({
        name: "test:event",
        type: "custom",
        timestamp: 1234567890,
        source: "source-process",
      });
      expect(context.process).toEqual({
        name: "target-process",
        type: "task",
      });
      expect(context.clier).toEqual({
        project: "test-project",
      });
    });

    it("should handle different event types", () => {
      const eventTypes: Array<ClierEvent["type"]> = [
        "success",
        "error",
        "crashed",
        "custom",
        "stdout",
        "stderr",
      ];

      eventTypes.forEach((type) => {
        const event: ClierEvent = {
          name: "test",
          processName: "proc",
          type,
          timestamp: Date.now(),
        };

        const context = createTemplateContext(event, "test", "service", "proj");
        expect(context.event?.type).toBe(type);
      });
    });
  });

  describe("Integration scenarios", () => {
    it("should handle realistic command template", () => {
      const template =
        'node logger.js --event="{{event.name}}" --source="{{event.source}}" --timestamp={{event.timestamp}}';
      const result = substituteEventTemplates(template, createContext());

      expect(result).toBe(
        'node logger.js --event="backend:ready" --source="backend" --timestamp=1706012345678',
      );
    });

    it("should handle realistic env var template", () => {
      const template = "TRIGGER_{{event.type}}_FROM_{{event.source}}";
      const result = substituteEventTemplates(template, createContext());

      expect(result).toBe("TRIGGER_custom_FROM_backend");
    });

    it("should handle mixed valid and invalid templates", () => {
      const template = "{{event.name}} {{unknown.var}} {{process.name}}";
      const result = substituteEventTemplates(template, createContext());

      expect(result).toBe("backend:ready {{unknown.var}} frontend");
    });

    it("should validate and substitute consistently", () => {
      const template = "cmd --arg={{event.source}}";

      // Validate first
      const validation = validateTemplateString(template);
      expect(validation.valid).toBe(true);
      expect(validation.usedVariables).toContain("event.source");

      // Then substitute
      const result = substituteEventTemplates(template, createContext());
      expect(result).toBe("cmd --arg=backend");
    });
  });
});
