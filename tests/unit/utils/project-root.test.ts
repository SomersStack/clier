/**
 * Tests for project root discovery
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  findProjectRoot,
  findProjectRootForDaemon,
  findProjectRootForConfig,
  resolveConfigPath,
} from "../../../src/utils/project-root.js";

describe("findProjectRoot", () => {
  let tempDir: string;
  let projectRoot: string;
  let subDir1: string;
  let subDir2: string;

  beforeEach(() => {
    // Create a temporary directory structure:
    // temp/
    //   project/
    //     .clier/
    //     clier-pipeline.json
    //     src/
    //       components/
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "clier-test-"));
    projectRoot = path.join(tempDir, "project");
    subDir1 = path.join(projectRoot, "src");
    subDir2 = path.join(subDir1, "components");

    fs.mkdirSync(projectRoot);
    fs.mkdirSync(subDir1);
    fs.mkdirSync(subDir2);
  });

  afterEach(() => {
    // Clean up
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe("findProjectRoot with .clier directory", () => {
    beforeEach(() => {
      // Create .clier directory
      fs.mkdirSync(path.join(projectRoot, ".clier"));
    });

    it("should find project root from project root", () => {
      const result = findProjectRoot(projectRoot, "daemon");
      expect(result).toBe(projectRoot);
    });

    it("should find project root from subdirectory", () => {
      const result = findProjectRoot(subDir1, "daemon");
      expect(result).toBe(projectRoot);
    });

    it("should find project root from nested subdirectory", () => {
      const result = findProjectRoot(subDir2, "daemon");
      expect(result).toBe(projectRoot);
    });

    it("should find project root with 'any' lookup mode", () => {
      const result = findProjectRoot(subDir2, "any");
      expect(result).toBe(projectRoot);
    });
  });

  describe("findProjectRoot with clier-pipeline.json", () => {
    beforeEach(() => {
      // Create config file
      fs.writeFileSync(
        path.join(projectRoot, "clier-pipeline.json"),
        JSON.stringify({ project_name: "test" })
      );
    });

    it("should find project root from project root", () => {
      const result = findProjectRoot(projectRoot, "config");
      expect(result).toBe(projectRoot);
    });

    it("should find project root from subdirectory", () => {
      const result = findProjectRoot(subDir1, "config");
      expect(result).toBe(projectRoot);
    });

    it("should find project root from nested subdirectory", () => {
      const result = findProjectRoot(subDir2, "config");
      expect(result).toBe(projectRoot);
    });

    it("should find project root with 'any' lookup mode", () => {
      const result = findProjectRoot(subDir2, "any");
      expect(result).toBe(projectRoot);
    });
  });

  describe("findProjectRoot with both indicators", () => {
    beforeEach(() => {
      // Create both .clier and config file
      fs.mkdirSync(path.join(projectRoot, ".clier"));
      fs.writeFileSync(
        path.join(projectRoot, "clier-pipeline.json"),
        JSON.stringify({ project_name: "test" })
      );
    });

    it("should find project root with daemon lookup", () => {
      const result = findProjectRoot(subDir2, "daemon");
      expect(result).toBe(projectRoot);
    });

    it("should find project root with config lookup", () => {
      const result = findProjectRoot(subDir2, "config");
      expect(result).toBe(projectRoot);
    });

    it("should find project root with any lookup", () => {
      const result = findProjectRoot(subDir2, "any");
      expect(result).toBe(projectRoot);
    });
  });

  describe("findProjectRoot when not found", () => {
    it("should return null when no project found (daemon)", () => {
      const result = findProjectRoot(subDir2, "daemon");
      expect(result).toBeNull();
    });

    it("should return null when no project found (config)", () => {
      const result = findProjectRoot(subDir2, "config");
      expect(result).toBeNull();
    });

    it("should return null when no project found (any)", () => {
      const result = findProjectRoot(subDir2, "any");
      expect(result).toBeNull();
    });

    it("should stop at home directory", () => {
      // This test ensures we don't traverse above home directory
      const homeDir = os.homedir();
      const result = findProjectRoot(homeDir, "any");
      expect(result).toBeNull();
    });
  });

  describe("findProjectRootForDaemon", () => {
    it("should throw error when no daemon found", () => {
      expect(() => findProjectRootForDaemon(subDir2)).toThrow(
        "No Clier project found"
      );
    });

    it("should return project root when daemon found", () => {
      fs.mkdirSync(path.join(projectRoot, ".clier"));
      const result = findProjectRootForDaemon(subDir2);
      expect(result).toBe(projectRoot);
    });
  });

  describe("findProjectRootForConfig", () => {
    it("should throw error when no config found", () => {
      expect(() => findProjectRootForConfig(subDir2)).toThrow(
        "No Clier project found"
      );
    });

    it("should return project root when config found", () => {
      fs.writeFileSync(
        path.join(projectRoot, "clier-pipeline.json"),
        JSON.stringify({ project_name: "test" })
      );
      const result = findProjectRootForConfig(subDir2);
      expect(result).toBe(projectRoot);
    });
  });

  describe("resolveConfigPath", () => {
    beforeEach(() => {
      // Create config file
      fs.writeFileSync(
        path.join(projectRoot, "clier-pipeline.json"),
        JSON.stringify({ project_name: "test" })
      );
    });

    it("should resolve absolute path directly", () => {
      const configPath = path.join(projectRoot, "clier-pipeline.json");
      const result = resolveConfigPath(configPath);
      expect(result).toBe(configPath);
    });

    it("should resolve relative path from startDir", () => {
      const result = resolveConfigPath("clier-pipeline.json", projectRoot);
      expect(result).toBe(path.join(projectRoot, "clier-pipeline.json"));
    });

    it("should search upward when no path provided", () => {
      const result = resolveConfigPath(undefined, subDir2);
      expect(result).toBe(path.join(fs.realpathSync(projectRoot), "clier-pipeline.json"));
    });

    it("should throw error when absolute path not found", () => {
      const nonExistentPath = path.join(tempDir, "nonexistent.json");
      expect(() => resolveConfigPath(nonExistentPath)).toThrow(
        "Config file not found"
      );
    });

    it("should throw error when relative path not found", () => {
      expect(() =>
        resolveConfigPath("nonexistent.json", projectRoot)
      ).toThrow("Config file not found");
    });

    it("should throw error when no config found upward", () => {
      // Remove the config file
      fs.unlinkSync(path.join(projectRoot, "clier-pipeline.json"));
      expect(() => resolveConfigPath(undefined, subDir2)).toThrow(
        "No Clier project found"
      );
    });
  });

  describe("multiple nested projects", () => {
    let outerProject: string;
    let innerProject: string;

    beforeEach(() => {
      // Create nested project structure:
      // temp/
      //   outer-project/
      //     .clier/
      //     clier-pipeline.json
      //     packages/
      //       inner-project/
      //         .clier/
      //         clier-pipeline.json
      //         src/
      outerProject = path.join(tempDir, "outer-project");
      innerProject = path.join(outerProject, "packages", "inner-project");
      const innerSrc = path.join(innerProject, "src");

      fs.mkdirSync(outerProject);
      fs.mkdirSync(path.join(outerProject, ".clier"));
      fs.writeFileSync(
        path.join(outerProject, "clier-pipeline.json"),
        JSON.stringify({ project_name: "outer" })
      );

      fs.mkdirSync(path.join(outerProject, "packages"));
      fs.mkdirSync(innerProject);
      fs.mkdirSync(path.join(innerProject, ".clier"));
      fs.writeFileSync(
        path.join(innerProject, "clier-pipeline.json"),
        JSON.stringify({ project_name: "inner" })
      );
      fs.mkdirSync(innerSrc);
    });

    it("should find nearest project (inner project)", () => {
      const innerSrc = path.join(innerProject, "src");
      const result = findProjectRoot(innerSrc, "config");
      expect(result).toBe(fs.realpathSync(innerProject));
    });

    it("should find outer project from packages directory", () => {
      const packagesDir = path.join(outerProject, "packages");
      const result = findProjectRoot(packagesDir, "config");
      expect(result).toBe(fs.realpathSync(outerProject));
    });
  });
});
