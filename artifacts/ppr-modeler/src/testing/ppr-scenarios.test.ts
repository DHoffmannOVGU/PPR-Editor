import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PprModel } from '@workspace/api-client-react';
import {
  getProductBom,
  getRelationshipProblem,
  getResourceTree,
  RELATIONSHIP_RULES,
} from '../components/review/analysis-utils';
import { getProcessSpecification } from '../components/review/process-specification-utils';
import { clonePprScenarioModel, getPprScenario, PPR_SCENARIOS } from './ppr-scenarios';

test('the app example registry contains only coherent, loadable production models', () => {
  const ids = new Set<string>();

  assert.deepEqual(
    PPR_SCENARIOS.map((scenario) => scenario.id),
    [
      'two-stage-finished-product',
      'body-side-spot-welding',
      'ev-battery-module-assembly',
      'centrifugal-pump-final-assembly',
    ],
  );
  for (const scenario of PPR_SCENARIOS) {
    assert.equal(ids.has(scenario.id), false, `Scenario IDs must be unique: ${scenario.id}`);
    ids.add(scenario.id);
    assert.equal(scenario.loadable, true, scenario.id);
    assert.equal(scenario.expected.valid, true, scenario.id);
    assert.ok(scenario.label);
    assert.ok(scenario.description);
    assert.equal(scenario.model.diagram.usages.length, scenario.expected.elementCount, scenario.id);
    assert.equal(scenario.model.diagram.relationships.length, scenario.expected.relationshipCount, scenario.id);
    assert.ok(scenario.model.library.definitions.length > 0, scenario.id);
    assert.ok(scenario.model.diagram.usages.every((usage) => usage.kind === 'usage'), scenario.id);
    assert.ok(scenario.model.library.definitions.every((definition) => definition.kind === 'definition'), scenario.id);
    const clone = clonePprScenarioModel(scenario);
    assert.notEqual(clone, scenario.model);
    assert.deepEqual(clone, scenario.model);
  }
});

test('every production example has valid endpoints and review projections', () => {
  for (const scenario of PPR_SCENARIOS) {
    const model = clonePprScenarioModel(scenario);
    const elementsById = new Map(model.diagram.usages.map((element) => [element.id, element]));
    const allKinds = new Set(
      Object.keys(RELATIONSHIP_RULES) as PprModel['diagram']['relationships'][number]['kind'][],
    );

    assert.equal(
      model.diagram.relationships.filter((relationship) =>
        getRelationshipProblem(relationship, elementsById, allKinds),
      ).length,
      0,
      scenario.id,
    );
    assert.equal(
      getResourceTree(model).resources.length,
      model.diagram.usages.filter((element) => element.type === 'resource').length,
      scenario.id,
    );
    assert.ok(getProcessSpecification(model).rows.length > 0, scenario.id);
    assert.equal(model.diagram.relationships.every((relationship) => relationship.kind in RELATIONSHIP_RULES), true);
  }
});

test('the welding example models a nested cell and typed production data', () => {
  const model = getPprScenario('body-side-spot-welding').model;
  const tree = getResourceTree(model);
  const panel = model.library.definitions.find((element) => element.id === 'def_body_side_panel');
  const input = model.diagram.relationships.find((relationship) => relationship.id === 'rel_panel_input');

  assert.deepEqual([...tree.cycleResourceIds], []);
  assert.deepEqual(tree.roots.map((resource) => resource.id), ['use_welding_cell']);
  assert.deepEqual(
    tree.childrenByResourceId.get('use_welding_cell')?.map((edge) => edge.childResourceId),
    ['use_locating_fixture', 'use_welding_robot', 'use_weld_camera'],
  );
  assert.deepEqual(
    panel?.attributes.map(({ name, value, datatype, unit }) => ({ name, value, datatype, unit })),
    [
      { name: 'material', value: 'DX54D+Z', datatype: 'string', unit: null },
      { name: 'thickness', value: '0.8', datatype: 'real', unit: 'mm' },
    ],
  );
  assert.deepEqual(
    { quantity: input?.quantity, roleName: input?.role_name },
    { quantity: 1, roleName: 'panel' },
  );
});

test('the battery example preserves product flow and explicit process succession', () => {
  const model = getPprScenario('ev-battery-module-assembly').model;
  const bom = getProductBom(model);
  const processSpecification = getProcessSpecification(model);

  assert.deepEqual(bom.roots.map((product) => product.id), ['use_verified_module']);
  assert.equal(bom.orphanProductIds.size, 0);
  assert.deepEqual(
    model.diagram.relationships
      .filter((relationship) => relationship.kind === 'succeeds')
      .map((relationship) => relationship.id),
    ['rel_load_precedes_join', 'rel_join_precedes_test'],
  );
  assert.equal(processSpecification.flows.filter((flow) => flow.kind === 'direct').length, 2);
});

test('the pump example assigns one real resource to each operation', () => {
  const model = getPprScenario('centrifugal-pump-final-assembly').model;
  const performers = model.diagram.relationships.filter((relationship) => relationship.kind === 'performs');

  assert.deepEqual(
    performers.map(({ source_id, target_id }) => [source_id, target_id]),
    [
      ['use_assembly_station', 'use_assemble_pump'],
      ['use_pressure_test_bench', 'use_hydrostatic_test'],
      ['use_pump_test_bench', 'use_performance_test'],
    ],
  );
});
