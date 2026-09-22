import type { PprModel } from '@workspace/api-client-react';
import fixture from './ppr-scenarios.json';

export type PprScenarioExpectation = {
  valid: boolean;
  issueIncludes: string[];
  elementCount: number;
  relationshipCount: number;
};

export type PprScenario = {
  id: string;
  label: string;
  description: string;
  characteristics: string[];
  loadable: boolean;
  expected: PprScenarioExpectation;
  model: PprModel;
};

const LEGACY_SCENARIOS = fixture.scenarios as unknown as PprScenario[];

export const PPR_SCENARIOS = LEGACY_SCENARIOS.map((scenario) => ({
  ...scenario,
  model: {
    ...scenario.model,
    library: {
      definitions: scenario.model.library.definitions.map((definition) => ({
        ...definition,
        visible_in_ppr: definition.visible_in_ppr ?? true,
      })),
    },
    diagram: {
      ...scenario.model.diagram,
      usages: scenario.model.diagram.usages.map((usage) => ({
        ...usage,
        visible_in_ppr: usage.visible_in_ppr ?? true,
      })),
    },
  },
}));

export function getPprScenario(id: string): PprScenario {
  const scenario = PPR_SCENARIOS.find((candidate) => candidate.id === id);
  if (!scenario) {
    throw new Error(`Unknown PPR scenario: ${id}`);
  }
  return scenario;
}

export function getLoadablePprScenarios(): PprScenario[] {
  return PPR_SCENARIOS.filter((scenario) => scenario.loadable);
}

export function clonePprScenarioModel(scenario: PprScenario): PprModel {
  return structuredClone(scenario.model);
}
