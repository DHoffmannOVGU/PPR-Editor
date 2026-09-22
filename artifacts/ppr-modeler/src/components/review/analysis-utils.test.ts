import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PprRelationshipKind, type PprModel } from '@workspace/api-client-react';
import { RelationshipInputKind } from '@workspace/api-zod';
import {
  getElementMap,
  getProductBom,
  getRelatedElements,
  getRelationshipProblems,
  getResourceAncestorIds,
  getResourceTree,
  RELATIONSHIP_RULES,
} from './analysis-utils';
import { getProcessSpecification } from './process-specification-utils';

function modelWith(
  elements: PprModel['elements'],
  relationships: PprModel['relationships'],
): PprModel {
  return {
    id: 'bom-test-model',
    name: 'BOM test model',
    description: '',
    elements,
    relationships,
  };
}

function product(id: string, name = id) {
  return {
    id,
    name,
    type: 'product' as const,
    kind: 'definition' as const,
    definition_id: null,
    description: '',
    attributes: [],
    x: 0,
    y: 0,
  };
}

function process(id: string, name = id) {
  return {
    id,
    name,
    type: 'process' as const,
    kind: 'definition' as const,
    definition_id: null,
    description: '',
    attributes: [],
    x: 0,
    y: 0,
  };
}

function resource(id: string, name = id) {
  return {
    id,
    name,
    type: 'resource' as const,
    kind: 'definition' as const,
    definition_id: null,
    description: '',
    attributes: [],
    x: 0,
    y: 0,
  };
}

test('derives a multi-level BOM and marks shared inputs', () => {
  const model = modelWith(
    [product('raw'), product('subassembly'), product('finished'), process('assemble'), process('finish')],
    [
      { id: 'raw-assemble', source_id: 'raw', target_id: 'assemble', kind: 'consumed_by' },
      { id: 'assemble-subassembly', source_id: 'assemble', target_id: 'subassembly', kind: 'produces' },
      { id: 'subassembly-finish', source_id: 'subassembly', target_id: 'finish', kind: 'consumed_by', quantity: 2, unit: 'm' },
      { id: 'finish-finished', source_id: 'finish', target_id: 'finished', kind: 'produces' },
      { id: 'raw-finish', source_id: 'raw', target_id: 'finish', kind: 'consumed_by', quantity: 3, unit: 'kg' },
    ],
  );

  const bom = getProductBom(model);

  assert.deepEqual(bom.roots.map((element) => element.id), ['finished']);
  assert.deepEqual(
    bom.childrenByProductId.get('finished')?.map((edge) => [edge.childProductId, edge.processId]),
    [['subassembly', 'finish'], ['raw', 'finish']],
  );
  assert.equal(bom.childrenByProductId.get('subassembly')?.[0].childProductId, 'raw');
  assert.deepEqual(
    bom.childrenByProductId.get('finished')?.map((edge) => [edge.quantity, edge.unit]),
    [[2, 'm'], [3, 'kg']],
  );
  assert.deepEqual([...bom.sharedProductIds], ['raw']);
  assert.deepEqual([...bom.orphanProductIds], []);
});

test('keeps standalone products and cycle components finite', () => {
  const model = modelWith(
    [product('cycle-a'), product('cycle-b'), product('standalone')],
    [
      { id: 'a-to-b', source_id: 'cycle-a', target_id: 'process-a', kind: 'consumed_by' },
      { id: 'a-output', source_id: 'process-a', target_id: 'cycle-b', kind: 'produces' },
      { id: 'b-to-a', source_id: 'cycle-b', target_id: 'process-b', kind: 'consumed_by' },
      { id: 'b-output', source_id: 'process-b', target_id: 'cycle-a', kind: 'produces' },
    ],
  );

  const bom = getProductBom({
    ...model,
    elements: [...model.elements, process('process-a'), process('process-b')],
  });

  assert.deepEqual(bom.roots.map((element) => element.id), ['standalone', 'cycle-a']);
  assert.deepEqual([...bom.orphanProductIds], ['standalone']);
  assert.deepEqual([...bom.cycleProductIds].sort(), ['cycle-a', 'cycle-b']);
});

test('keeps projections usable with mixed standalone and definition-backed usages', () => {
  const standalone = { ...product('standalone'), kind: 'usage' as const, definition_id: null };
  const backed = { ...product('backed'), kind: 'usage' as const, definition_id: 'product-definition' };
  const processUsage = { ...process('weld'), kind: 'usage' as const, definition_id: 'process-definition' };
  const model = modelWith(
    [standalone, backed, processUsage],
    [
      { id: 'standalone-input', source_id: 'standalone', target_id: 'weld', kind: 'consumed_by' },
      { id: 'weld-output', source_id: 'weld', target_id: 'backed', kind: 'produces' },
    ],
  );

  const bom = getProductBom(model);
  const specification = getProcessSpecification(model);
  const tree = getResourceTree(model);

  assert.deepEqual(bom.roots.map((element) => element.id), ['backed']);
  assert.deepEqual(specification.externalProducts.map((item) => item.product.id), ['standalone']);
  assert.deepEqual(specification.terminalOutputs.map((item) => item.product.id), ['backed']);
  assert.deepEqual(tree.resources, []);
});

test('marks inferred links from multi-output processes as ambiguous', () => {
  const model = modelWith(
    [product('raw'), product('output-a'), product('output-b'), process('split')],
    [
      { id: 'raw-split', source_id: 'raw', target_id: 'split', kind: 'consumed_by' },
      { id: 'split-a', source_id: 'split', target_id: 'output-a', kind: 'produces' },
      { id: 'split-b', source_id: 'split', target_id: 'output-b', kind: 'produces' },
    ],
  );

  const bom = getProductBom(model);

  assert.equal(bom.childrenByProductId.get('output-a')?.[0].isAmbiguous, true);
  assert.equal(bom.childrenByProductId.get('output-b')?.[0].isAmbiguous, true);
});

test('projects resource capability links with shared children and cycle-safe roots', () => {
  const model = modelWith(
    [resource('cell'), resource('robot'), resource('fixture'), resource('inspection'), resource('cycle-a'), resource('cycle-b'), process('weld')],
    [
      { id: 'cell-robot', source_id: 'cell', target_id: 'robot', kind: 'contains' },
      { id: 'cell-fixture', source_id: 'cell', target_id: 'fixture', kind: 'contains' },
      { id: 'robot-inspection', source_id: 'robot', target_id: 'inspection', kind: 'contains' },
      { id: 'fixture-inspection', source_id: 'fixture', target_id: 'inspection', kind: 'contains' },
      { id: 'cycle-a-b', source_id: 'cycle-a', target_id: 'cycle-b', kind: 'contains' },
      { id: 'cycle-b-a', source_id: 'cycle-b', target_id: 'cycle-a', kind: 'contains' },
      { id: 'robot-weld', source_id: 'robot', target_id: 'weld', kind: 'performs' },
    ],
  );

  const tree = getResourceTree(model);

  assert.deepEqual(tree.roots.map((element) => element.id), ['cell', 'cycle-a']);
  assert.deepEqual([...tree.sharedResourceIds], ['inspection']);
  assert.deepEqual([...tree.cycleResourceIds].sort(), ['cycle-a', 'cycle-b']);
  assert.deepEqual([...tree.processLinkedResourceIds], ['robot']);
  assert.equal(tree.childrenByResourceId.get('cell')?.[1].kind, 'contains');
});

test('shares relationship integrity rules and directional selectors across reviews', () => {
  const model = modelWith(
    [product('input'), process('weld'), resource('robot'), resource('fixture')],
    [
      { id: 'valid-input', source_id: 'input', target_id: 'weld', kind: 'consumed_by' },
      { id: 'invalid-input', source_id: 'weld', target_id: 'input', kind: 'consumed_by' },
      { id: 'resource-child', source_id: 'robot', target_id: 'fixture', kind: 'contains' },
    ],
  );
  const elementsById = getElementMap(model);

  assert.deepEqual(
    getRelatedElements(model, elementsById, 'weld', 'consumed_by').map((element) => element.id),
    ['input'],
  );
  assert.deepEqual(
    getRelationshipProblems(model).map(({ relationship, problem }) => [relationship.id, problem.title]),
    [['invalid-input', 'Unexpected direction'], ['resource-child', 'Outside process review']],
  );
  assert.deepEqual(
    [...getResourceAncestorIds(getResourceTree(model), 'fixture')],
    ['robot'],
  );
});

test('keeps the shared relationship contract aligned with generated API kinds', () => {
  assert.deepEqual(
    Object.keys(RELATIONSHIP_RULES).sort(),
    Object.values(PprRelationshipKind).sort(),
  );
  assert.ok(Object.values(PprRelationshipKind).every((kind) =>
    Object.values(RelationshipInputKind).includes(kind as RelationshipInputKind)));
  assert.deepEqual(RELATIONSHIP_RULES, {
    consumed_by: [{ source: 'product', target: 'process' }],
    produces: [{ source: 'process', target: 'product' }],
    performs: [{ source: 'resource', target: 'process' }],
    succeeds: [{ source: 'process', target: 'process' }],
    contains: [
      { source: 'product', target: 'product' },
      { source: 'process', target: 'process' },
      { source: 'resource', target: 'resource' },
    ],
    becomes: [{ source: 'product', target: 'product' }],
  });
});

test('projects process stages, boundary products, parallel branches, and nested subprocesses', () => {
  const model = modelWith(
    [
      product('raw'),
      product('handoff'),
      product('finished'),
      product('external'),
      product('standalone'),
      process('cut'),
      process('weld'),
      process('inspect'),
      process('idle'),
      process('sub-weld'),
      process('cycle-a'),
      process('cycle-b'),
    ],
    [
      { id: 'raw-cut', source_id: 'raw', target_id: 'cut', kind: 'consumed_by' },
      { id: 'cut-handoff', source_id: 'cut', target_id: 'handoff', kind: 'produces' },
      { id: 'handoff-weld', source_id: 'handoff', target_id: 'weld', kind: 'consumed_by' },
      { id: 'weld-finished', source_id: 'weld', target_id: 'finished', kind: 'produces' },
      { id: 'external-inspect', source_id: 'external', target_id: 'inspect', kind: 'consumed_by' },
      { id: 'weld-sub-weld', source_id: 'weld', target_id: 'sub-weld', kind: 'contains' },
      { id: 'cycle-a-b', source_id: 'cycle-a', target_id: 'cycle-b', kind: 'contains' },
      { id: 'cycle-b-a', source_id: 'cycle-b', target_id: 'cycle-a', kind: 'contains' },
    ],
  );

  const projection = getProcessSpecification(model);

  assert.deepEqual(projection.boundaryProducts.map(({ product }) => product.id), ['handoff']);
  assert.deepEqual(projection.externalProducts.map(({ product }) => product.id), ['raw', 'external']);
  assert.deepEqual(projection.terminalOutputs.map(({ product }) => product.id), ['finished']);
  assert.deepEqual(projection.standaloneProducts.map(({ product }) => product.id), ['standalone']);
  assert.deepEqual(
    projection.flows.map(({ sourceProcessId, targetProcessId, productId }) => [sourceProcessId, targetProcessId, productId]),
    [['cut', 'weld', 'handoff']],
  );
  assert.deepEqual(
    projection.rows.find((row) => row.rank === 0)?.processes.map(({ process }) => process.id),
    ['cut', 'inspect', 'idle', 'cycle-a'],
  );
  assert.equal(projection.processRootIds.get('sub-weld'), 'weld');
  assert.equal(projection.nodeByProcessId.get('weld')?.children[0].process.id, 'sub-weld');
  assert.equal(projection.nodeByProcessId.get('cycle-a')?.children[0].process.id, 'cycle-b');
  assert.equal(projection.nodeByProcessId.get('cycle-a')?.children[0].children[0].isCycle, true);
  assert.deepEqual([...projection.cycleProcessIds].sort(), ['cycle-a', 'cycle-b']);
});
