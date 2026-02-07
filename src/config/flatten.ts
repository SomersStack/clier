/**
 * Pipeline Flattening
 *
 * Expands stages into flat pipeline items with property propagation.
 * The orchestrator always works with a flat PipelineItem[].
 */

import type {
  ClierConfig,
  PipelineItem,
  FlattenedConfig,
  PipelineEntry,
} from "./types.js";

export type FlattenResult = {
  config: FlattenedConfig;
  stageMap: Map<string, string>;
};

/**
 * Flatten a pipeline config by expanding stages into their constituent steps.
 *
 * - Top-level steps pass through unchanged
 * - Stage steps are expanded with:
 *   - `manual = stage.manual || step.manual`
 *   - Non-manual steps get `trigger_on = [...stage.trigger_on, ...step.trigger_on]`
 *   - Manual steps don't inherit stage `trigger_on`
 *
 * @returns The flattened config and a map of step name → stage name
 */
export function flattenPipeline(config: ClierConfig): FlattenResult {
  const flatItems: PipelineItem[] = [];
  const stageMap = new Map<string, string>();

  for (const entry of config.pipeline as PipelineEntry[]) {
    if (entry.type === "stage") {
      for (const step of entry.steps) {
        const effectiveManual = entry.manual || step.manual || false;

        let effectiveTriggerOn = step.trigger_on;
        if (
          !effectiveManual &&
          entry.trigger_on &&
          entry.trigger_on.length > 0
        ) {
          effectiveTriggerOn = [
            ...entry.trigger_on,
            ...(step.trigger_on ?? []),
          ];
        }

        flatItems.push({
          ...step,
          manual: effectiveManual || undefined,
          trigger_on: effectiveTriggerOn,
        });

        stageMap.set(step.name, entry.name);
      }
    } else {
      flatItems.push(entry);
    }
  }

  const flattenedConfig: FlattenedConfig = {
    ...config,
    pipeline: flatItems,
  };

  return { config: flattenedConfig, stageMap };
}
