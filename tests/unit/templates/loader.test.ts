import { describe, it, expect, beforeEach, vi } from "vitest";
import { existsSync, readFileSync } from "fs";
import {
  loadTemplateManifest,
  loadTemplate,
  listTemplates,
  getTemplatesByCategory,
  templateExists,
  getTemplateIds,
  loadBundledScript,
} from "../../../src/templates/loader.js";

vi.mock("fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

const mockExistsSync = vi.mocked(existsSync);
const mockReadFileSync = vi.mocked(readFileSync);

const validTemplate = {
  id: "node-api",
  name: "Node.js API",
  description: "A Node.js API server",
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
};

const validTemplate2 = {
  id: "build-task",
  name: "Build Task",
  description: "Run a build step",
  category: "task",
  stage: {
    name: "build",
    command: "npm run build",
    type: "task",
  },
};

const validTemplate3 = {
  id: "health-check",
  name: "Health Check",
  description: "A utility health checker",
  category: "utility",
  stage: {
    name: "health",
    command: "curl localhost:3000/health",
    type: "task",
  },
};

describe("Template Loader", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("loadTemplateManifest", () => {
    it("should load a valid manifest", () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        JSON.stringify({ templates: ["node-api", "build-task"] })
      );

      const result = loadTemplateManifest();
      expect(result).toEqual({ templates: ["node-api", "build-task"] });
    });

    it("should return null when manifest file does not exist", () => {
      mockExistsSync.mockReturnValue(false);

      const result = loadTemplateManifest();
      expect(result).toBeNull();
      expect(mockReadFileSync).not.toHaveBeenCalled();
    });

    it("should return null for malformed JSON", () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue("{ not valid json }}}");

      const result = loadTemplateManifest();
      expect(result).toBeNull();
    });

    it("should return null when JSON does not match schema", () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify({ wrong: "field" }));

      const result = loadTemplateManifest();
      expect(result).toBeNull();
    });

    it("should return null when readFileSync throws", () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockImplementation(() => {
        throw new Error("EACCES: permission denied");
      });

      const result = loadTemplateManifest();
      expect(result).toBeNull();
    });
  });

  describe("loadTemplate", () => {
    it("should load a valid template", () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(validTemplate));

      const result = loadTemplate("node-api");
      expect(result).not.toBeNull();
      expect(result!.id).toBe("node-api");
      expect(result!.category).toBe("service");
      expect(result!.variables).toHaveLength(2);
    });

    it("should return null when template file does not exist", () => {
      mockExistsSync.mockReturnValue(false);

      const result = loadTemplate("nonexistent");
      expect(result).toBeNull();
    });

    it("should return null for malformed JSON", () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue("not json at all");

      const result = loadTemplate("broken");
      expect(result).toBeNull();
    });

    it("should return null when template fails schema validation", () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        JSON.stringify({ id: "test", name: "Test" })
      );

      const result = loadTemplate("test");
      expect(result).toBeNull();
    });

    it("should return null when readFileSync throws", () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockImplementation(() => {
        throw new Error("EACCES: permission denied");
      });

      const result = loadTemplate("test");
      expect(result).toBeNull();
    });
  });

  describe("listTemplates", () => {
    it("should list all templates from manifest", () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockImplementation((path) => {
        const p = String(path);
        if (p.endsWith("index.json")) {
          return JSON.stringify({
            templates: ["node-api", "build-task"],
          });
        }
        if (p.includes("node-api")) return JSON.stringify(validTemplate);
        if (p.includes("build-task")) return JSON.stringify(validTemplate2);
        return "";
      });

      const result = listTemplates();
      expect(result).toHaveLength(2);
      expect(result[0]!.id).toBe("node-api");
      expect(result[1]!.id).toBe("build-task");
    });

    it("should return empty array when manifest is missing", () => {
      mockExistsSync.mockReturnValue(false);

      const result = listTemplates();
      expect(result).toEqual([]);
    });

    it("should filter by category", () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockImplementation((path) => {
        const p = String(path);
        if (p.endsWith("index.json")) {
          return JSON.stringify({
            templates: ["node-api", "build-task"],
          });
        }
        if (p.includes("node-api")) return JSON.stringify(validTemplate);
        if (p.includes("build-task")) return JSON.stringify(validTemplate2);
        return "";
      });

      const result = listTemplates({ category: "task" });
      expect(result).toHaveLength(1);
      expect(result[0]!.id).toBe("build-task");
    });

    it("should skip templates that fail to load", () => {
      mockExistsSync.mockImplementation((path) => {
        const p = String(path);
        if (p.endsWith("index.json")) return true;
        if (p.includes("node-api")) return true;
        if (p.includes("broken")) return true;
        return false;
      });
      mockReadFileSync.mockImplementation((path) => {
        const p = String(path);
        if (p.endsWith("index.json")) {
          return JSON.stringify({ templates: ["node-api", "broken"] });
        }
        if (p.includes("node-api")) return JSON.stringify(validTemplate);
        if (p.includes("broken")) return "not json";
        return "";
      });

      const result = listTemplates();
      expect(result).toHaveLength(1);
      expect(result[0]!.id).toBe("node-api");
    });

    it("should return empty array when no templates match category", () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockImplementation((path) => {
        const p = String(path);
        if (p.endsWith("index.json")) {
          return JSON.stringify({ templates: ["node-api"] });
        }
        return JSON.stringify(validTemplate);
      });

      const result = listTemplates({ category: "utility" });
      expect(result).toEqual([]);
    });
  });

  describe("getTemplatesByCategory", () => {
    it("should group templates by category", () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockImplementation((path) => {
        const p = String(path);
        if (p.endsWith("index.json")) {
          return JSON.stringify({
            templates: ["node-api", "build-task", "health-check"],
          });
        }
        if (p.includes("node-api")) return JSON.stringify(validTemplate);
        if (p.includes("build-task")) return JSON.stringify(validTemplate2);
        if (p.includes("health-check")) return JSON.stringify(validTemplate3);
        return "";
      });

      const result = getTemplatesByCategory();
      expect(result.service).toHaveLength(1);
      expect(result.service[0]!.id).toBe("node-api");
      expect(result.task).toHaveLength(1);
      expect(result.task[0]!.id).toBe("build-task");
      expect(result.utility).toHaveLength(1);
      expect(result.utility[0]!.id).toBe("health-check");
    });

    it("should return empty arrays when no templates exist", () => {
      mockExistsSync.mockReturnValue(false);

      const result = getTemplatesByCategory();
      expect(result.service).toEqual([]);
      expect(result.task).toEqual([]);
      expect(result.utility).toEqual([]);
    });
  });

  describe("templateExists", () => {
    it("should return true when template file exists", () => {
      mockExistsSync.mockReturnValue(true);

      expect(templateExists("node-api")).toBe(true);
    });

    it("should return false when template file does not exist", () => {
      mockExistsSync.mockReturnValue(false);

      expect(templateExists("nonexistent")).toBe(false);
    });
  });

  describe("getTemplateIds", () => {
    it("should return template IDs from manifest", () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        JSON.stringify({ templates: ["node-api", "build-task"] })
      );

      const result = getTemplateIds();
      expect(result).toEqual(["node-api", "build-task"]);
    });

    it("should return empty array when manifest is missing", () => {
      mockExistsSync.mockReturnValue(false);

      const result = getTemplateIds();
      expect(result).toEqual([]);
    });
  });

  describe("loadBundledScript", () => {
    it("should load script content", () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue("#!/bin/bash\necho hello");

      const result = loadBundledScript("build.sh");
      expect(result).toBe("#!/bin/bash\necho hello");
    });

    it("should return null when script file does not exist", () => {
      mockExistsSync.mockReturnValue(false);

      const result = loadBundledScript("missing.sh");
      expect(result).toBeNull();
    });

    it("should return null when readFileSync throws", () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockImplementation(() => {
        throw new Error("EACCES: permission denied");
      });

      const result = loadBundledScript("broken.sh");
      expect(result).toBeNull();
    });
  });
});
