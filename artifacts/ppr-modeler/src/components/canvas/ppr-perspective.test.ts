import assert from 'node:assert/strict';
import test from 'node:test';
import type { PprElement, PprModel } from '@workspace/api-client-react';
import { getPprPerspectiveProjection } from './ppr-perspective';
import { PPR_SCENARIOS } from '../../testing/ppr-scenarios';

function element(
  id: string,
  type: PprElement['type'],
  name: string,
  x: number,
  y: number,
): PprElement {
  return {
    id,
    name,
    type,
    kind: 'usage',
    definition_id: null,
    description: '',
    attributes: [],
    x,
    y,
    visible_in_ppr: true,
  };
}

const perspectiveModel: PprModel = {
  id: 'perspective-model',
  name: 'Perspective test',
  description: '',
  library: { definitions: [] },
  diagram: {
    usages: [
      element('input', 'product', 'Input', 40, 40),
      element('intermediate', 'product', 'Intermediate', 40, 400),
      element('final', 'product', 'Final', 40, 800),
      element('build', 'process', 'Build', 400, 250),
      element('finish', 'process', 'Finish', 400, 650),
      element('cell', 'resource', 'Cell', 800, 250),
      element('tool', 'resource', 'Tool', 800, 500),
    ],
    relationships: [
      { id: 'input-build', source_id: 'input', target_id: 'build', kind: 'consumed_by' },
      { id: 'build-intermediate', source_id: 'build', target_id: 'intermediate', kind: 'produces' },
      { id: 'intermediate-finish', source_id: 'intermediate', target_id: 'finish', kind: 'consumed_by' },
      { id: 'finish-final', source_id: 'finish', target_id: 'final', kind: 'produces' },
      { id: 'tool-build', source_id: 'tool', target_id: 'build', kind: 'performs' },
      { id: 'cell-tool', source_id: 'cell', target_id: 'tool', kind: 'contains' },
    ],
  },
};

test('collapses becomes-linked product states into one PPR item node', () => {
  const model: PprModel = {
    ...perspectiveModel,
    diagram: {
      ...perspectiveModel.diagram,
      relationships: [
        ...perspectiveModel.diagram.relationships,
        { id: 'input-becomes-intermediate', source_id: 'input', target_id: 'intermediate', kind: 'becomes' },
        { id: 'intermediate-becomes-final', source_id: 'intermediate', target_id: 'final', kind: 'becomes' },
      ],
    },
  };

  const projection = getPprPerspectiveProjection(model, 'ppr', 'ppr', 0, 'contains', true);
  const productIds = projection.model.diagram.usages
    .filter((usage) => usage.type === 'product')
    .map((usage) => usage.id);

  assert.deepEqual(productIds, ['input']);
  assert.equal(projection.model.diagram.relationships.some((relationship) => relationship.kind === 'becomes'), false);
  assert.equal(projection.model.diagram.relationships.some((relationship) => relationship.source_id === 'intermediate' || relationship.target_id === 'intermediate'), false);
});

test('puts the final product at the top of a product-only derived hierarchy', () => {
  const projection = getPprPerspectiveProjection(perspectiveModel, 'product');
  const positions = new Map(projection.model.diagram.usages.map((usage) => [usage.id, usage.y]));

  assert.deepEqual(
    projection.model.diagram.usages.map((usage) => usage.type),
    ['product', 'product', 'product'],
  );
  assert.ok(positions.get('final')! < positions.get('intermediate')!);
  assert.ok(positions.get('intermediate')! < positions.get('input')!);
  assert.equal(projection.model.diagram.relationships.length, 2);
  assert.equal(projection.derivedEdges.get('bom-finish-final-intermediate')?.label, 'Built by Finish');
});

test('projects only process nodes and turns intermediate products into inferred flow relations', () => {
  const projection = getPprPerspectiveProjection(perspectiveModel, 'process');
  const usageIds = new Set(projection.model.diagram.usages.map((usage) => usage.id));
  const relationshipIds = new Set(projection.model.diagram.relationships.map((relationship) => relationship.id));
  const positions = new Map(projection.model.diagram.usages.map((usage) => [usage.id, usage.y]));

  assert.equal(usageIds.has('build'), true);
  assert.equal(usageIds.has('finish'), true);
  assert.equal(usageIds.has('input'), false);
  assert.equal(usageIds.has('tool'), false);
  assert.equal(usageIds.has('cell'), false);
  assert.equal(relationshipIds.has('process-flow-intermediate-build-finish'), true);
  assert.equal(projection.derivedEdges.get('process-flow-intermediate-build-finish')?.label, 'Intermediate');
  assert.ok(positions.get('build')! < positions.get('finish')!);
  assert.equal(relationshipIds.has('tool-build'), false);
  assert.equal(relationshipIds.has('cell-tool'), false);
});

test('projects process containment as React Flow parent metadata in the process view', () => {
  const nestedModel = structuredClone(perspectiveModel);
  nestedModel.diagram.usages.push(
    element('sub-build', 'process', 'Sub-build', 460, 520),
    element('sub-a-finish', 'process', 'Sub-finish', 460, 700),
  );
  nestedModel.diagram.relationships.push({
    id: 'build-sub-build',
    source_id: 'build',
    target_id: 'sub-build',
    kind: 'contains',
  });
  nestedModel.diagram.relationships.push({
    id: 'build-sub-a-finish',
    source_id: 'build',
    target_id: 'sub-a-finish',
    kind: 'contains',
  });
  nestedModel.diagram.relationships.push({
    id: 'sub-build-sub-a-finish',
    source_id: 'sub-build',
    target_id: 'sub-a-finish',
    kind: 'succeeds',
  });
  nestedModel.diagram.relationships.push({
    id: 'sub-build-finish',
    source_id: 'sub-build',
    target_id: 'finish',
    kind: 'succeeds',
  });

  const nested = getPprPerspectiveProjection(nestedModel, 'process');
  const usageIds = new Set(nested.model.diagram.usages.map((usage) => usage.id));
  const relationshipIds = new Set(nested.model.diagram.relationships.map((relationship) => relationship.id));
  const positions = new Map(nested.model.diagram.usages.map((usage) => [usage.id, { x: usage.x, y: usage.y }]));

  assert.deepEqual(usageIds, new Set(['build', 'finish', 'sub-build', 'sub-a-finish']));
  assert.equal(nested.parentByElementId?.get('sub-build'), 'build');
  assert.equal(nested.parentByElementId?.get('sub-a-finish'), 'build');
  assert.equal(nested.containerDimensions?.has('build'), true);
  assert.equal(relationshipIds.has('build-sub-build'), false);
  assert.equal(relationshipIds.has('build-sub-a-finish'), false);
  assert.equal(relationshipIds.has('sub-build-sub-a-finish'), true);
  assert.equal(relationshipIds.has('sub-build-finish'), true);
  assert.equal(relationshipIds.has('process-flow-intermediate-build-finish'), true);
  assert.ok((nested.containerDimensions?.get('build')?.width ?? 0) > 240);
  assert.equal(positions.get('sub-build')?.x, positions.get('sub-a-finish')?.x);
  assert.ok(positions.get('sub-build')!.y - positions.get('build')!.y >= 118);
  assert.ok(positions.get('sub-build')!.y < positions.get('sub-a-finish')!.y);
  assert.ok(positions.get('sub-a-finish')!.y - positions.get('sub-build')!.y >= 160);
});

test('projects only the explicit resource hierarchy with roots above descendants', () => {
  const projection = getPprPerspectiveProjection(perspectiveModel, 'resource');
  const positions = new Map(projection.model.diagram.usages.map((usage) => [usage.id, usage.y]));

  assert.deepEqual(
    new Set(projection.model.diagram.usages.map((usage) => usage.id)),
    new Set(['cell', 'tool']),
  );
  assert.deepEqual(projection.model.diagram.relationships.map((relationship) => relationship.id), ['cell-tool']);
  assert.ok(positions.get('cell')! < positions.get('tool')!);

  const nested = getPprPerspectiveProjection(perspectiveModel, 'resource', 'ppr', 0, 'nested');
  assert.equal(nested.parentByElementId?.get('tool'), 'cell');
  assert.equal(nested.containerKinds?.get('cell'), 'resource');
  assert.equal(nested.model.diagram.relationships.some((relationship) => relationship.id === 'cell-tool'), false);
});

test('preserves canonical IDs and coordinates when deriving perspectives', () => {
  const before = structuredClone(perspectiveModel);
  const ppr = getPprPerspectiveProjection(perspectiveModel, 'ppr');
  const product = getPprPerspectiveProjection(perspectiveModel, 'product');

  assert.equal(ppr.model, perspectiveModel);
  assert.equal(product.model.diagram.usages.find((usage) => usage.id === 'final')?.id, 'final');
  assert.deepEqual(perspectiveModel, before);
});

test('keeps lens-only usages out of PPR without removing them from their individual tree', () => {
  const model = structuredClone(perspectiveModel);
  model.diagram.usages.push({
    ...element('screw', 'product', 'Screw', 120, 920),
    visible_in_ppr: false,
  });
  model.diagram.relationships.push({
    id: 'final-screw',
    source_id: 'final',
    target_id: 'screw',
    kind: 'contains',
  });

  const ppr = getPprPerspectiveProjection(model, 'ppr');
  const product = getPprPerspectiveProjection(model, 'product', 'bom');

  assert.equal(ppr.model.diagram.usages.some((usage) => usage.id === 'screw'), false);
  assert.equal(ppr.model.diagram.relationships.some((relationship) => relationship.id === 'final-screw'), false);
  assert.equal(product.model.diagram.usages.some((usage) => usage.id === 'screw'), true);
  assert.equal(product.model.diagram.relationships.some((relationship) => relationship.id === 'final-screw'), true);
});

test('centers each derived layout on the canonical location of its visible nodes', () => {
  (['process', 'product', 'resource'] as const).forEach((perspective) => {
    const projection = getPprPerspectiveProjection(perspectiveModel, perspective);
    const visibleIds = new Set(projection.model.diagram.usages.map((usage) => usage.id));
    const canonicalUsages = perspectiveModel.diagram.usages.filter((usage) => visibleIds.has(usage.id));
    const canonicalCenter = {
      x: (Math.min(...canonicalUsages.map((usage) => usage.x)) + Math.max(...canonicalUsages.map((usage) => usage.x))) / 2,
      y: (Math.min(...canonicalUsages.map((usage) => usage.y)) + Math.max(...canonicalUsages.map((usage) => usage.y))) / 2,
    };
    const projectedCenter = {
      x: (
        Math.min(...projection.model.diagram.usages.map((usage) => usage.x))
        + Math.max(...projection.model.diagram.usages.map((usage) => usage.x))
      ) / 2,
      y: (
        Math.min(...projection.model.diagram.usages.map((usage) => usage.y))
        + Math.max(...projection.model.diagram.usages.map((usage) => usage.y))
      ) / 2,
    };

    assert.deepEqual(projectedCenter, canonicalCenter);
  });
});

test('collapses the body-side scenario to a product/process/resource summary and expands it by level', () => {
  const scenario = PPR_SCENARIOS.find((candidate) => candidate.id === 'body-side-spot-welding');
  assert.ok(scenario);

  const summary = getPprPerspectiveProjection(scenario.model, 'levels', 'ppr', 0);
  const summaryIds = new Set(summary.model.diagram.usages.map((usage) => usage.id));
  const summaryPositions = new Map(summary.model.diagram.usages.map((usage) => [usage.id, usage]));
  assert.deepEqual(
    [...summaryIds].sort(),
    [
      'use_body_side_panel',
      'use_body_side_production',
      'use_reinforcement_bracket',
      'use_inspected_body_side',
      'use_welding_cell',
    ].sort(),
  );
  assert.equal(summary.model.diagram.relationships.some((relationship) => relationship.id === 'levels-input-use_body_side_panel-use_body_side_production'), true);
  assert.equal(summary.model.diagram.relationships.some((relationship) => relationship.id === 'levels-output-use_body_side_production-use_inspected_body_side'), true);
  assert.equal(summary.parentByElementId?.size, 0);
  assert.equal(summaryPositions.get('use_body_side_panel')?.y, summaryPositions.get('use_reinforcement_bracket')?.y);

  const expanded = getPprPerspectiveProjection(scenario.model, 'levels', 'ppr', 1);
  const expandedIds = new Set(expanded.model.diagram.usages.map((usage) => usage.id));
  const expandedPositions = new Map(expanded.model.diagram.usages.map((usage) => [usage.id, usage]));
  assert.equal(expandedIds.has('use_fixture_components'), true);
  assert.equal(expandedIds.has('use_locating_fixture'), true);
  assert.equal(expandedIds.has('use_positioned_panel_assembly'), true);
  assert.equal(expanded.parentByElementId?.get('use_fixture_components'), 'use_body_side_production');
  assert.equal(expanded.parentByElementId?.get('use_locating_fixture'), 'use_welding_cell');
  assert.equal(expanded.containerKinds?.get('use_body_side_production'), 'process');
  assert.equal(expanded.containerKinds?.get('use_welding_cell'), 'resource');
  assert.equal(expanded.model.diagram.relationships.some((relationship) => relationship.kind === 'contains'), false);
  assert.equal(expanded.maxLevel, 1);
  assert.equal(expandedPositions.get('use_body_side_panel')?.y, expandedPositions.get('use_reinforcement_bracket')?.y);
  const productPositions = [...expandedPositions.values()].filter((usage) => usage.type === 'product');
  const processPositions = [...expandedPositions.values()].filter((usage) => usage.type === 'process');
  const resourcePositions = [...expandedPositions.values()].filter((usage) => usage.type === 'resource');
  assert.ok(Math.min(...processPositions.map((usage) => usage.x)) > Math.max(...productPositions.map((usage) => usage.x)) + 200);
  assert.ok(Math.min(...resourcePositions.map((usage) => usage.x)) > Math.max(...processPositions.map((usage) => usage.x)) + 200);
  assert.ok(expandedPositions.get('use_body_side_panel')!.y < expandedPositions.get('use_positioned_panel_assembly')!.y);
  assert.ok(expandedPositions.get('use_positioned_panel_assembly')!.y < expandedPositions.get('use_spot_weld_joint_set')!.y);
  assert.ok(expandedPositions.get('use_positioned_panel_assembly')!.y < expandedPositions.get('use_welded_body_side')!.y);
  assert.ok(expandedPositions.get('use_welded_body_side')!.y < expandedPositions.get('use_inspect_welds')!.y);
  assert.ok(expandedPositions.get('use_welded_body_side')!.y < expandedPositions.get('use_inspected_body_side')!.y);
  assert.equal(expandedPositions.get('use_welding_cell')?.y, expandedPositions.get('use_body_side_production')?.y);
  assert.equal(expandedPositions.get('use_locating_fixture')?.y, expandedPositions.get('use_fixture_components')?.y);
  assert.equal(expandedPositions.get('use_welding_robot')?.y, expandedPositions.get('use_spot_weld_joint_set')?.y);
  assert.equal(expandedPositions.get('use_weld_camera')?.y, expandedPositions.get('use_inspect_welds')?.y);
});

test('keeps cyclic process and resource containment finite in the levels projection', () => {
  const cyclic = structuredClone(perspectiveModel);
  cyclic.diagram.usages.push(
    element('sub-process', 'process', 'Sub-process', 420, 400),
    element('sub-resource', 'resource', 'Sub-resource', 820, 400),
  );
  cyclic.diagram.relationships.push(
    { id: 'build-sub-process', source_id: 'build', target_id: 'sub-process', kind: 'contains' },
    { id: 'sub-process-build', source_id: 'sub-process', target_id: 'build', kind: 'contains' },
    { id: 'cell-sub-resource', source_id: 'cell', target_id: 'sub-resource', kind: 'contains' },
    { id: 'sub-resource-cell', source_id: 'sub-resource', target_id: 'cell', kind: 'contains' },
  );

  const projection = getPprPerspectiveProjection(cyclic, 'levels', 'ppr', 3);
  assert.ok(projection.model.diagram.usages.length > 0);
  assert.ok((projection.maxLevel ?? 0) <= 3);
  assert.ok([...(projection.parentByElementId?.entries() ?? [])].every(([child, parent]) => child !== parent));
});
