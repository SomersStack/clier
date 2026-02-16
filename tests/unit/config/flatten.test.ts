import { describe, it, expect } from "vitest";
import { flattenPipeline } from "../../../src/config/flatten.js";
import type {
  ClierConfig,
  PipelineItem,
  StageItem,
  WorkflowItem,
} from "../../../src/config/types.js";

describe("Pipeline Flattening", () => {
  describe("Top-level steps (no stages)", () => {
    it("should pass through top-level steps unchanged", () => {
      const config = createConfig([
        createService("backend", "npm start"),
        createTask("migrate", "npm run migrate"),
      ]);

      const { config: flattenedConfig, stageMap } = flattenPipeline(config);

      expect(flattenedConfig.pipeline).toHaveLength(2);
      expect(flattenedConfig.pipeline[0]?.name).toBe("backend");
      expect(flattenedConfig.pipeline[1]?.name).toBe("migrate");
      expect(stageMap.size).toBe(0);
    });

    it("should preserve all properties of top-level steps", () => {
      const step: PipelineItem = {
        name: "backend",
        command: "npm start",
        type: "service",
        trigger_on: ["db:ready"],
        manual: true,
        env: { PORT: "3000" },
        cwd: "/app",
        events: {
          on_stdout: [{ pattern: "ready", emit: "backend:ready" }],
          on_stderr: true,
          on_crash: true,
        },
      };

      const config = createConfig([step]);
      const { config: flattenedConfig } = flattenPipeline(config);

      expect(flattenedConfig.pipeline[0]).toEqual(step);
    });
  });

  describe("Stage flattening", () => {
    it("should flatten stage steps into individual pipeline items", () => {
      const stage: StageItem = {
        name: "build-stage",
        type: "stage",
        steps: [
          createService("frontend", "npm run build:frontend"),
          createService("backend", "npm run build:backend"),
        ],
      };

      const config = createConfig([stage]);
      const { config: flattenedConfig, stageMap } = flattenPipeline(config);

      expect(flattenedConfig.pipeline).toHaveLength(2);
      expect(flattenedConfig.pipeline[0]?.name).toBe("frontend");
      expect(flattenedConfig.pipeline[1]?.name).toBe("backend");
      expect(stageMap.get("frontend")).toBe("build-stage");
      expect(stageMap.get("backend")).toBe("build-stage");
    });

    it("should propagate stage.manual to all steps", () => {
      const stage: StageItem = {
        name: "manual-stage",
        type: "stage",
        manual: true,
        steps: [createService("step1", "cmd1"), createService("step2", "cmd2")],
      };

      const config = createConfig([stage]);
      const { config: flattenedConfig } = flattenPipeline(config);

      expect(flattenedConfig.pipeline[0]?.manual).toBe(true);
      expect(flattenedConfig.pipeline[1]?.manual).toBe(true);
    });

    it("should merge step.manual with stage.manual (OR logic)", () => {
      const stage: StageItem = {
        name: "partial-manual-stage",
        type: "stage",
        manual: false,
        steps: [
          { ...createService("step1", "cmd1"), manual: true },
          createService("step2", "cmd2"),
        ],
      };

      const config = createConfig([stage]);
      const { config: flattenedConfig } = flattenPipeline(config);

      expect(flattenedConfig.pipeline[0]?.manual).toBe(true);
      expect(flattenedConfig.pipeline[1]?.manual).toBeUndefined();
    });

    it("should propagate stage.trigger_on to non-manual steps", () => {
      const stage: StageItem = {
        name: "triggered-stage",
        type: "stage",
        trigger_on: ["db:ready"],
        steps: [createService("step1", "cmd1"), createService("step2", "cmd2")],
      };

      const config = createConfig([stage]);
      const { config: flattenedConfig } = flattenPipeline(config);

      expect(flattenedConfig.pipeline[0]?.trigger_on).toEqual(["db:ready"]);
      expect(flattenedConfig.pipeline[1]?.trigger_on).toEqual(["db:ready"]);
    });

    it("should merge step.trigger_on with stage.trigger_on", () => {
      const stage: StageItem = {
        name: "merged-triggers-stage",
        type: "stage",
        trigger_on: ["stage:trigger"],
        steps: [
          { ...createService("step1", "cmd1"), trigger_on: ["step:trigger"] },
          createService("step2", "cmd2"),
        ],
      };

      const config = createConfig([stage]);
      const { config: flattenedConfig } = flattenPipeline(config);

      expect(flattenedConfig.pipeline[0]?.trigger_on).toEqual([
        "stage:trigger",
        "step:trigger",
      ]);
      expect(flattenedConfig.pipeline[1]?.trigger_on).toEqual([
        "stage:trigger",
      ]);
    });

    it("should NOT propagate stage.trigger_on to manual steps", () => {
      const stage: StageItem = {
        name: "manual-no-inherit",
        type: "stage",
        trigger_on: ["stage:trigger"],
        steps: [
          { ...createService("step1", "cmd1"), manual: true },
          createService("step2", "cmd2"),
        ],
      };

      const config = createConfig([stage]);
      const { config: flattenedConfig } = flattenPipeline(config);

      // Manual step should not inherit stage trigger_on
      expect(flattenedConfig.pipeline[0]?.trigger_on).toBeUndefined();
      expect(flattenedConfig.pipeline[0]?.manual).toBe(true);

      // Non-manual step should inherit
      expect(flattenedConfig.pipeline[1]?.trigger_on).toEqual([
        "stage:trigger",
      ]);
    });

    it("should not propagate trigger_on when stage is manual", () => {
      const stage: StageItem = {
        name: "fully-manual-stage",
        type: "stage",
        manual: true,
        trigger_on: ["stage:trigger"],
        steps: [createService("step1", "cmd1"), createService("step2", "cmd2")],
      };

      const config = createConfig([stage]);
      const { config: flattenedConfig } = flattenPipeline(config);

      // When stage is manual, steps become manual and don't inherit trigger_on
      expect(flattenedConfig.pipeline[0]?.manual).toBe(true);
      expect(flattenedConfig.pipeline[0]?.trigger_on).toBeUndefined();
      expect(flattenedConfig.pipeline[1]?.manual).toBe(true);
      expect(flattenedConfig.pipeline[1]?.trigger_on).toBeUndefined();
    });
  });

  describe("Mixed pipelines (stages and top-level steps)", () => {
    it("should handle mixed stages and steps correctly", () => {
      const config = createConfig([
        createService("standalone", "npm run standalone"),
        {
          name: "build-stage",
          type: "stage" as const,
          steps: [
            createService("frontend", "npm run build:frontend"),
            createService("backend", "npm run build:backend"),
          ],
        },
        createTask("deploy", "npm run deploy"),
      ]);

      const { config: flattenedConfig, stageMap } = flattenPipeline(config);

      expect(flattenedConfig.pipeline).toHaveLength(4);
      expect(flattenedConfig.pipeline.map((p) => p.name)).toEqual([
        "standalone",
        "frontend",
        "backend",
        "deploy",
      ]);

      expect(stageMap.size).toBe(2);
      expect(stageMap.get("frontend")).toBe("build-stage");
      expect(stageMap.get("backend")).toBe("build-stage");
      expect(stageMap.has("standalone")).toBe(false);
      expect(stageMap.has("deploy")).toBe(false);
    });

    it("should handle multiple stages", () => {
      const config = createConfig([
        {
          name: "stage1",
          type: "stage" as const,
          steps: [
            createService("step1a", "cmd1a"),
            createService("step1b", "cmd1b"),
          ],
        },
        {
          name: "stage2",
          type: "stage" as const,
          steps: [createService("step2a", "cmd2a")],
        },
      ]);

      const { config: flattenedConfig, stageMap } = flattenPipeline(config);

      expect(flattenedConfig.pipeline).toHaveLength(3);
      expect(stageMap.get("step1a")).toBe("stage1");
      expect(stageMap.get("step1b")).toBe("stage1");
      expect(stageMap.get("step2a")).toBe("stage2");
    });
  });

  describe("Config preservation", () => {
    it("should preserve non-pipeline config properties", () => {
      const config: ClierConfig = {
        project_name: "test-project",
        global_env: false,
        safety: {
          max_ops_per_minute: 120,
          debounce_ms: 50,
        },
        pipeline: [createService("test", "npm test")],
      };

      const { config: flattenedConfig } = flattenPipeline(config);

      expect(flattenedConfig.project_name).toBe("test-project");
      expect(flattenedConfig.global_env).toBe(false);
      expect(flattenedConfig.safety.max_ops_per_minute).toBe(120);
      expect(flattenedConfig.safety.debounce_ms).toBe(50);
    });
  });
});

// Helper functions
function createConfig(pipeline: (PipelineItem | StageItem)[]): ClierConfig {
  return {
    project_name: "test",
    global_env: true,
    safety: {
      max_ops_per_minute: 60,
      debounce_ms: 100,
    },
    pipeline,
  };
}

function createService(name: string, command: string): PipelineItem {
  return {
    name,
    command,
    type: "service",
  };
}

function createTask(name: string, command: string): PipelineItem {
  return {
    name,
    command,
    type: "task",
  };
}

function createWorkflow(
  name: string,
  overrides?: Partial<WorkflowItem>,
): WorkflowItem {
  return {
    name,
    type: "workflow",
    steps: [{ action: "run", process: "backend" }],
    ...overrides,
  };
}

function createConfigWithWorkflows(
  pipeline: (PipelineItem | StageItem | WorkflowItem)[],
): ClierConfig {
  return {
    project_name: "test",
    global_env: true,
    safety: {
      max_ops_per_minute: 60,
      debounce_ms: 100,
    },
    pipeline,
  };
}

describe("Workflow extraction", () => {
  it("should extract workflows and not include them in flatItems", () => {
    const wf = createWorkflow("deploy-wf");
    const config = createConfigWithWorkflows([
      createService("backend", "npm start"),
      wf,
    ]);

    const { config: flattenedConfig, workflows } = flattenPipeline(config);

    // Workflow should NOT be in the flattened pipeline
    expect(flattenedConfig.pipeline).toHaveLength(1);
    expect(flattenedConfig.pipeline[0]?.name).toBe("backend");

    // Workflow should be in the workflows array
    expect(workflows).toHaveLength(1);
    expect(workflows[0]?.name).toBe("deploy-wf");
    expect(workflows[0]?.type).toBe("workflow");
  });

  it("should return workflows in the result", () => {
    const wf1 = createWorkflow("wf1");
    const wf2 = createWorkflow("wf2", {
      trigger_on: ["build:done"],
      on_failure: "continue",
    });

    const config = createConfigWithWorkflows([
      createService("backend", "npm start"),
      wf1,
      wf2,
    ]);

    const { workflows } = flattenPipeline(config);

    expect(workflows).toHaveLength(2);
    expect(workflows[0]?.name).toBe("wf1");
    expect(workflows[1]?.name).toBe("wf2");
    expect(workflows[1]?.trigger_on).toEqual(["build:done"]);
    expect(workflows[1]?.on_failure).toBe("continue");
  });

  it("should handle mixed pipeline with stages, items, and workflows", () => {
    const stage: StageItem = {
      name: "build-stage",
      type: "stage",
      steps: [
        createService("frontend", "npm run build:frontend"),
        createService("api", "npm run build:api"),
      ],
    };

    const config = createConfigWithWorkflows([
      createService("db", "docker-compose up db"),
      stage,
      createWorkflow("deploy-wf", {
        steps: [
          { action: "run", process: "frontend" },
          { action: "emit", event: "deploy:done" },
        ],
      }),
      createTask("tests", "npm test"),
    ]);

    const { config: flattenedConfig, stageMap, workflows } =
      flattenPipeline(config);

    // Flat items: db + frontend + api (from stage) + tests = 4
    expect(flattenedConfig.pipeline).toHaveLength(4);
    expect(flattenedConfig.pipeline.map((p) => p.name)).toEqual([
      "db",
      "frontend",
      "api",
      "tests",
    ]);

    // Stage map should track stage steps
    expect(stageMap.get("frontend")).toBe("build-stage");
    expect(stageMap.get("api")).toBe("build-stage");

    // Workflows should be extracted separately
    expect(workflows).toHaveLength(1);
    expect(workflows[0]?.name).toBe("deploy-wf");
    expect(workflows[0]?.steps).toHaveLength(2);
  });

  it("should return empty workflows array when no workflows exist", () => {
    const config = createConfig([
      createService("backend", "npm start"),
      createTask("migrate", "npm run migrate"),
    ]);

    const { workflows } = flattenPipeline(config);

    expect(workflows).toHaveLength(0);
  });
});
