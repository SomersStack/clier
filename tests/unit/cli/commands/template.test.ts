/**
 * Unit tests for the template commands
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  templateListCommand,
  templateApplyCommand,
  templateShowCommand,
} from "../../../../src/cli/commands/template.js";
import * as templateLoader from "../../../../src/templates/loader.js";
import * as templateRenderer from "../../../../src/templates/renderer.js";

// Mock template loader
vi.mock("../../../../src/templates/loader.js", () => ({
  loadTemplate: vi.fn(),
  getTemplatesByCategory: vi.fn(),
  getTemplateIds: vi.fn(),
  loadBundledScript: vi.fn(),
}));

// Mock template renderer
vi.mock("../../../../src/templates/renderer.js", () => ({
  renderTemplate: vi.fn(),
  getDefaultVariables: vi.fn(),
  validateRequiredVariables: vi.fn(),
  formatVariableInfo: vi.fn(),
}));

// Mock fs
vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return {
    ...actual,
    existsSync: vi.fn(() => false),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    chmodSync: vi.fn(),
    readFileSync: vi.fn(() => "{}"),
  };
});

// Mock chalk to pass through strings for easier assertion
vi.mock("chalk", () => {
  const handler: ProxyHandler<any> = {
    get(_target, _prop) {
      const fn = (...args: any[]) => args.join("");
      return new Proxy(fn, handler);
    },
    apply(_target, _thisArg, args) {
      return args.join("");
    },
  };
  return { default: new Proxy((...args: any[]) => args.join(""), handler) };
});

describe("Template Commands", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(process, "cwd").mockReturnValue("/fake/project");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("templateListCommand", () => {
    it("should list templates grouped by category and return 0", async () => {
      vi.mocked(templateLoader.getTemplatesByCategory).mockReturnValue({
        service: [
          {
            id: "web-server",
            name: "Web Server",
            description: "A basic web server",
            category: "service",
            stage: {
              name: "web-server",
              type: "service",
              command: "node server.js",
            },
          } as any,
        ],
        task: [],
        utility: [],
      });

      const exitCode = await templateListCommand();

      expect(exitCode).toBe(0);
      expect(console.log).toHaveBeenCalled();
    });

    it("should return 1 when no templates are found", async () => {
      vi.mocked(templateLoader.getTemplatesByCategory).mockReturnValue({
        service: [],
        task: [],
        utility: [],
      });

      const exitCode = await templateListCommand();

      expect(exitCode).toBe(1);
    });
  });

  describe("templateApplyCommand", () => {
    it("should output stage JSON to stdout and return 0", async () => {
      const mockTemplate = {
        id: "web-server",
        name: "Web Server",
        description: "A basic web server",
        category: "service",
        stage: { name: "{{name}}", type: "service", command: "node server.js" },
        variables: [
          {
            name: "name",
            label: "Name",
            required: true,
            default: "web-server",
          },
        ],
      };
      const renderedStage = {
        name: "my-server",
        type: "service",
        command: "node server.js",
      };

      vi.mocked(templateLoader.loadTemplate).mockReturnValue(
        mockTemplate as any,
      );
      vi.mocked(templateRenderer.getDefaultVariables).mockReturnValue({
        name: "web-server",
      });
      vi.mocked(templateRenderer.validateRequiredVariables).mockReturnValue([]);
      vi.mocked(templateRenderer.renderTemplate).mockReturnValue(
        renderedStage as any,
      );

      const exitCode = await templateApplyCommand("web-server", {
        name: "my-server",
      });

      expect(exitCode).toBe(0);
      expect(console.log).toHaveBeenCalledWith(
        JSON.stringify(renderedStage, null, 2),
      );
    });

    it("should add stage to clier-pipeline.json with --add flag", async () => {
      const fs = await import("fs");
      const mockTemplate = {
        id: "web-server",
        name: "Web Server",
        description: "A basic web server",
        category: "service",
        stage: { name: "{{name}}", type: "service", command: "node server.js" },
        variables: [],
      };
      const renderedStage = {
        name: "web-server",
        type: "service",
        command: "node server.js",
      };

      vi.mocked(templateLoader.loadTemplate).mockReturnValue(
        mockTemplate as any,
      );
      vi.mocked(templateRenderer.getDefaultVariables).mockReturnValue({});
      vi.mocked(templateRenderer.validateRequiredVariables).mockReturnValue([]);
      vi.mocked(templateRenderer.renderTemplate).mockReturnValue(
        renderedStage as any,
      );

      vi.mocked(fs.existsSync).mockImplementation((p: any) => {
        if (String(p).includes("clier-pipeline.json")) return true;
        return false;
      });
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({ project_name: "test", pipeline: [] }),
      );

      const exitCode = await templateApplyCommand("web-server", { add: true });

      expect(exitCode).toBe(0);
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining("clier-pipeline.json"),
        expect.stringContaining("web-server"),
        "utf-8",
      );
    });

    it("should return 1 when template is not found", async () => {
      vi.mocked(templateLoader.loadTemplate).mockReturnValue(null);
      vi.mocked(templateLoader.getTemplateIds).mockReturnValue([
        "web-server",
        "worker",
      ]);

      const exitCode = await templateApplyCommand("nonexistent");

      expect(exitCode).toBe(1);
    });

    it("should return 1 when required variables are missing", async () => {
      const mockTemplate = {
        id: "web-server",
        name: "Web Server",
        description: "A basic web server",
        category: "service",
        stage: { name: "{{name}}", type: "service", command: "node server.js" },
        variables: [
          {
            name: "port",
            label: "Port",
            required: true,
            description: "Server port",
          },
        ],
      };

      vi.mocked(templateLoader.loadTemplate).mockReturnValue(
        mockTemplate as any,
      );
      vi.mocked(templateRenderer.getDefaultVariables).mockReturnValue({});
      vi.mocked(templateRenderer.validateRequiredVariables).mockReturnValue([
        "port",
      ]);

      const exitCode = await templateApplyCommand("web-server");

      expect(exitCode).toBe(1);
    });
  });

  describe("templateShowCommand", () => {
    it("should show template details and return 0", async () => {
      const mockTemplate = {
        id: "web-server",
        name: "Web Server",
        description: "A basic web server",
        category: "service",
        tags: ["node", "http"],
        stage: { name: "{{name}}", type: "service", command: "node server.js" },
        variables: [
          {
            name: "name",
            label: "Name",
            required: true,
            default: "web-server",
            description: "Service name",
          },
        ],
      };

      vi.mocked(templateLoader.loadTemplate).mockReturnValue(
        mockTemplate as any,
      );
      vi.mocked(templateRenderer.formatVariableInfo).mockReturnValue([
        {
          name: "name",
          label: "Name",
          required: true,
          default: "web-server",
          description: "Service name",
        },
      ]);

      const exitCode = await templateShowCommand("web-server");

      expect(exitCode).toBe(0);
      expect(console.log).toHaveBeenCalled();
    });

    it("should return 1 when template is not found", async () => {
      vi.mocked(templateLoader.loadTemplate).mockReturnValue(null);
      vi.mocked(templateLoader.getTemplateIds).mockReturnValue(["web-server"]);

      const exitCode = await templateShowCommand("nonexistent");

      expect(exitCode).toBe(1);
    });
  });
});
