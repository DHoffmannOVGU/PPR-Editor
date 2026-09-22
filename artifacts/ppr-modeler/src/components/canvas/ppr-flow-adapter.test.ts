import assert from 'node:assert/strict';
import test from 'node:test';
import type { PprModel } from '@workspace/api-client-react';
import {
  getAlignedNodePositions,
  getAlignmentGuideTolerance,
  getAlignmentGuides,
  getAutoLayoutPositions,
  getRelationshipHandles,
  getVisibleResourceIds,
  getSnappedNodePosition,
  missingEndpointNodeId,
  modelToFlowEdges,
  modelToFlowNodes,
} from './ppr-flow-adapter';

const model: PprModel = {
  id: 'model-1',
  name: 'Adapter test model',
  description: '',
  elements: [
    {
      id: 'product-input',
      name: 'Input',
      type: 'product',
      kind: 'definition',
      definition_id: null,
      description: '',
      attributes: [],
      x: 120,
      y: 250,
    },
    {
      id: 'process-work',
      name: 'Work',
      type: 'process',
      kind: 'definition',
      definition_id: null,
      description: '',
      attributes: [],
      x: 450,
      y: 250,
    },
    {
      id: 'product-output',
      name: 'Output',
      type: 'product',
      kind: 'definition',
      definition_id: null,
      description: '',
      attributes: [],
      x: 780,
      y: 250,
    },
  ],
  relationships: [
    { id: 'rel-input', source_id: 'product-input', target_id: 'process-work', kind: 'consumed_by' },
    { id: 'rel-output', source_id: 'process-work', target_id: 'product-output', kind: 'produces' },
    { id: 'rel-flow', source_id: 'product-input', target_id: 'product-output', kind: 'succeeds' },
    { id: 'rel-invalid', source_id: 'product-input', target_id: 'process-work', kind: 'produces' },
    { id: 'rel-missing', source_id: 'process-work', target_id: 'missing-product', kind: 'produces' },
  ],
};

test('converts model elements to typed nodes and preserves selection and positions', () => {
  const nodes = modelToFlowNodes(model, new Set(['process-work']));
  const process = nodes.find((node) => node.id === 'process-work');

  assert.equal(nodes.filter((node) => node.type === 'pprNode').length, 3);
  assert.deepEqual(process?.position, { x: 450, y: 250 });
  assert.equal(process?.selected, true);
  assert.equal(nodes.some((node) => node.id === missingEndpointNodeId('target', 'missing-product')), true);
});

test('converts nested process layout metadata into parent nodes and relative child positions', () => {
  const nestedModel = structuredClone(model);
  nestedModel.elements.push({
    id: 'process-parent',
    name: 'Parent',
    type: 'process',
    kind: 'definition',
    definition_id: null,
    description: '',
    attributes: [],
    x: 120,
    y: 250,
  });
  const nestedNodes = modelToFlowNodes(
    nestedModel,
    new Set(),
    new Set(),
    new Set(),
    undefined,
    new Map(),
    {
      parentByElementId: new Map([['process-work', 'process-parent']]),
      containerDimensions: new Map([['process-parent', { width: 560, height: 300 }]]),
    },
  );
  const child = nestedNodes.find((node) => node.id === 'process-work');

  assert.equal(child?.parentId, 'process-parent');
  assert.deepEqual(child?.position, { x: 330, y: 0 });
  assert.equal(child?.data.parentProcessId, 'process-parent');
  assert.equal(child?.data.isProcessContainer, false);
  assert.equal(child?.extent, 'parent');
});

test('projects collaborator selections onto assets and their relationships', () => {
  const collaborator = { participantId: 'guest', name: 'Guest', color: '#c2410c' };
  const nodes = modelToFlowNodes(
    model,
    new Set(),
    new Set(),
    new Set(),
    undefined,
    new Map([['process-work', [collaborator]]]),
  );
  const edges = modelToFlowEdges(
    model,
    new Set(),
    undefined,
    undefined,
    true,
    new Set(),
    new Set(),
    undefined,
    new Map([['rel-output', [collaborator]]]),
  );

  assert.deepEqual(nodes.find((node) => node.id === 'process-work')?.data.remoteSelections, [collaborator]);
  assert.deepEqual(edges.find((edge) => edge.id === 'rel-output')?.data.remoteSelections, [collaborator]);
  assert.equal(edges.find((edge) => edge.id === 'rel-output')?.data.showLabel, true);
});

test('converts relationships to edges without dropping missing endpoints', () => {
  const edges = modelToFlowEdges(model, new Set(['rel-output']));
  const output = edges.find((edge) => edge.id === 'rel-output');
  const missing = edges.find((edge) => edge.id === 'rel-missing');

  assert.equal(edges.length, 5);
  assert.equal(output?.source, 'process-work');
  assert.equal(output?.target, 'product-output');
  assert.equal(output?.selected, true);
  assert.equal(missing?.target, missingEndpointNodeId('target', 'missing-product'));
  assert.equal(missing?.data?.problem?.title, 'Missing endpoint');
});

test('keeps valid extended relationships neutral and flags invalid PPR directions', () => {
  const edges = modelToFlowEdges(model, new Set());
  const flow = edges.find((edge) => edge.id === 'rel-flow');
  const invalid = edges.find((edge) => edge.id === 'rel-invalid');

  assert.equal(flow?.data?.problem, undefined);
  assert.equal(invalid?.data?.problem?.title, 'Unexpected direction');
});

test('lays out the PPR spine vertically and resources to the right of their process', () => {
  const layoutModel: PprModel = {
    ...model,
    elements: [
      ...model.elements,
      {
        id: 'resource-tool',
        name: 'Tool',
        type: 'resource',
        kind: 'definition',
        definition_id: null,
        description: '',
        attributes: [],
        x: 0,
        y: 0,
      },
    ],
    relationships: [
      ...model.relationships,
      { id: 'rel-tool', source_id: 'resource-tool', target_id: 'process-work', kind: 'performs' },
    ],
  };
  const positions = getAutoLayoutPositions(layoutModel);
  const input = positions.get('product-input');
  const process = positions.get('process-work');
  const output = positions.get('product-output');
  const resource = positions.get('resource-tool');

  assert.ok(input && process && output && resource);
  assert.equal(input.x, process.x);
  assert.equal(process.x, output.x);
  assert.ok(input.y < process.y && process.y < output.y);
  assert.ok(resource.x > process.x);
  assert.equal(resource.y, process.y);
});

test('aligns and distributes only the selected diagram nodes', () => {
  const nodes = modelToFlowNodes(model, new Set()).map((node) => {
    if (node.type !== 'pprNode') return node;
    const offsets: Record<string, { x: number; y: number }> = {
      'product-input': { x: 100, y: 360 },
      'process-work': { x: 420, y: 100 },
      'product-output': { x: 760, y: 240 },
    };
    return { ...node, position: offsets[node.id] };
  });
  const selected = new Set(['product-input', 'process-work', 'product-output']);

  assert.deepEqual(
    getAlignedNodePositions(nodes, selected, 'top'),
    new Map([
      ['product-input', { x: 100, y: 100 }],
      ['process-work', { x: 420, y: 100 }],
      ['product-output', { x: 760, y: 100 }],
    ]),
  );
  assert.deepEqual(
    getAlignedNodePositions(nodes, selected, 'center-horizontal'),
    new Map([
      ['product-input', { x: 426.6666666666667, y: 360 }],
      ['process-work', { x: 426.6666666666667, y: 100 }],
      ['product-output', { x: 426.6666666666667, y: 240 }],
    ]),
  );
  assert.deepEqual(
    getAlignedNodePositions(nodes, selected, 'distribute-vertical'),
    new Map([
      ['process-work', { x: 420, y: 100 }],
      ['product-output', { x: 760, y: 230 }],
      ['product-input', { x: 100, y: 360 }],
    ]),
  );
  assert.equal(getAlignedNodePositions(nodes, new Set(['product-input']), 'left').size, 0);
});

test('finds deterministic edge and center guides using rendered dimensions', () => {
  const nodes = modelToFlowNodes(model, new Set());
  const dragged = nodes.find((node) => node.id === 'product-input');
  const target = nodes.find((node) => node.id === 'process-work');
  assert.ok(dragged?.type === 'pprNode' && target?.type === 'pprNode');

  const draggedNode = {
    ...dragged,
    position: { x: 104, y: 196 },
    measured: { width: 200, height: 80 },
  };
  const targetNode = {
    ...target,
    position: { x: 100, y: 200 },
    measured: { width: 200, height: 80 },
  };
  const duplicateTarget = {
    ...targetNode,
    id: 'product-duplicate',
  };
  const hiddenTarget = {
    ...targetNode,
    id: 'hidden-target',
    hidden: true,
  };

  const guides = getAlignmentGuides(draggedNode, [
    draggedNode,
    targetNode,
    duplicateTarget,
    hiddenTarget,
    nodes.find((node) => node.type === 'missingEndpoint')!,
  ]);

  assert.deepEqual(
    guides.map(({ axis, coordinate, draggedAnchor, matchedAnchor, matchedNodeId }) => ({
      axis,
      coordinate,
      draggedAnchor,
      matchedAnchor,
      matchedNodeId,
    })),
    [
      { axis: 'horizontal', coordinate: 240, draggedAnchor: 'center', matchedAnchor: 'center', matchedNodeId: 'process-work' },
      { axis: 'vertical', coordinate: 200, draggedAnchor: 'center', matchedAnchor: 'center', matchedNodeId: 'process-work' },
    ],
  );
  assert.deepEqual(getSnappedNodePosition(draggedNode, guides), { x: 100, y: 200 });
});

test('keeps alignment tolerance constant in screen space across zoom levels', () => {
  assert.equal(getAlignmentGuideTolerance(0.5), 12);
  assert.equal(getAlignmentGuideTolerance(1), 6);
  assert.equal(getAlignmentGuideTolerance(2), 3);
  assert.equal(getAlignmentGuideTolerance(0), 6);
});

test('ignores hidden nodes and positions outside the guide tolerance', () => {
  const nodes = modelToFlowNodes(model, new Set());
  const dragged = nodes.find((node) => node.id === 'product-input');
  const target = nodes.find((node) => node.id === 'process-work');
  assert.ok(dragged?.type === 'pprNode' && target?.type === 'pprNode');

  const guides = getAlignmentGuides(
    { ...dragged, position: { x: 108, y: 208 } },
    [
      { ...target, position: { x: 100, y: 200 }, hidden: true },
      { ...target, id: 'far-target', position: { x: 500, y: 500 } },
    ],
    6,
  );

  assert.deepEqual(guides, []);
});

test('ranks products by PPR direction instead of usage or relationship array order', () => {
  const shuffledModel: PprModel = {
    ...model,
    elements: [...model.elements].reverse(),
    relationships: [...model.relationships].reverse(),
  };
  const positions = getAutoLayoutPositions(shuffledModel);
  const input = positions.get('product-input');
  const process = positions.get('process-work');
  const output = positions.get('product-output');

  assert.ok(input && process && output);
  assert.ok(input.y < process.y);
  assert.ok(process.y < output.y);
  assert.deepEqual(positions, getAutoLayoutPositions({
    ...model,
    elements: [...model.elements].sort((left, right) => left.id.localeCompare(right.id)),
    relationships: [...model.relationships].sort((left, right) => left.id.localeCompare(right.id)),
  }));
});

test('keeps branches and process succession in stable semantic layers', () => {
  const branchModel: PprModel = {
    ...model,
    elements: [
      {
        id: 'product-branch-input',
        name: 'Branch input',
        type: 'product',
        kind: 'definition',
        definition_id: null,
        description: '',
        attributes: [],
        x: 0,
        y: 0,
      },
      {
        id: 'product-branch-input-two',
        name: 'Branch input two',
        type: 'product',
        kind: 'definition',
        definition_id: null,
        description: '',
        attributes: [],
        x: 0,
        y: 0,
      },
      {
        id: 'process-branch',
        name: 'Branch',
        type: 'process',
        kind: 'definition',
        definition_id: null,
        description: '',
        attributes: [],
        x: 0,
        y: 0,
      },
      {
        id: 'product-shared',
        name: 'Shared output',
        type: 'product',
        kind: 'definition',
        definition_id: null,
        description: '',
        attributes: [],
        x: 0,
        y: 0,
      },
      {
        id: 'process-next',
        name: 'Next',
        type: 'process',
        kind: 'definition',
        definition_id: null,
        description: '',
        attributes: [],
        x: 0,
        y: 0,
      },
      {
        id: 'product-final',
        name: 'Final output',
        type: 'product',
        kind: 'definition',
        definition_id: null,
        description: '',
        attributes: [],
        x: 0,
        y: 0,
      },
    ],
    relationships: [
      { id: 'branch-output', source_id: 'process-branch', target_id: 'product-shared', kind: 'produces' },
      { id: 'branch-input-two', source_id: 'product-branch-input-two', target_id: 'process-branch', kind: 'consumed_by' },
      { id: 'next-output', source_id: 'process-next', target_id: 'product-final', kind: 'produces' },
      { id: 'shared-input', source_id: 'product-shared', target_id: 'process-next', kind: 'consumed_by' },
      { id: 'branch-input', source_id: 'product-branch-input', target_id: 'process-branch', kind: 'consumed_by' },
      { id: 'process-succession', source_id: 'process-branch', target_id: 'process-next', kind: 'succeeds' },
    ],
  };
  const positions = getAutoLayoutPositions(branchModel);
  const branchInput = positions.get('product-branch-input');
  const branchInputTwo = positions.get('product-branch-input-two');
  const branch = positions.get('process-branch');
  const shared = positions.get('product-shared');
  const next = positions.get('process-next');
  const final = positions.get('product-final');

  assert.ok(branchInput && branchInputTwo && branch && shared && next && final);
  assert.ok(branchInput.y < branch.y && branchInputTwo.y < branch.y);
  assert.ok(branch.y < shared.y && branch.y < next.y);
  assert.ok(shared.y < next.y && next.y < final.y);
  assert.notDeepEqual(branchInput, branchInputTwo);

  const reversed = {
    ...branchModel,
    elements: [...branchModel.elements].reverse(),
    relationships: [...branchModel.relationships].reverse(),
  };
  assert.deepEqual(positions, getAutoLayoutPositions(reversed));
});

test('uses deterministic non-overlapping fallbacks for cycles, missing endpoints, and isolated nodes', () => {
  const fallbackModel: PprModel = {
    ...model,
    elements: [
      {
        id: 'product-cycle-a',
        name: 'Cycle A',
        type: 'product',
        kind: 'definition',
        definition_id: null,
        description: '',
        attributes: [],
        x: 0,
        y: 0,
      },
      {
        id: 'process-cycle',
        name: 'Cycle process',
        type: 'process',
        kind: 'definition',
        definition_id: null,
        description: '',
        attributes: [],
        x: 0,
        y: 0,
      },
      {
        id: 'product-cycle-b',
        name: 'Cycle B',
        type: 'product',
        kind: 'definition',
        definition_id: null,
        description: '',
        attributes: [],
        x: 0,
        y: 0,
      },
      {
        id: 'product-isolated',
        name: 'Isolated',
        type: 'product',
        kind: 'definition',
        definition_id: null,
        description: '',
        attributes: [],
        x: 0,
        y: 0,
      },
    ],
    relationships: [
      { id: 'cycle-input', source_id: 'product-cycle-a', target_id: 'process-cycle', kind: 'consumed_by' },
      { id: 'cycle-output', source_id: 'process-cycle', target_id: 'product-cycle-b', kind: 'produces' },
      { id: 'cycle-return', source_id: 'product-cycle-b', target_id: 'process-cycle', kind: 'consumed_by' },
      { id: 'missing-output', source_id: 'process-cycle', target_id: 'missing-product', kind: 'produces' },
    ],
  };
  const positions = getAutoLayoutPositions(fallbackModel);
  const cyclePositions = ['product-cycle-a', 'process-cycle', 'product-cycle-b']
    .map((id) => positions.get(id));
  const allPositionKeys = [...positions.values()].map(({ x, y }) => `${x}:${y}`);

  assert.ok(cyclePositions.every((position) => position));
  assert.equal(new Set(allPositionKeys).size, allPositionKeys.length);
  assert.ok(positions.get('product-isolated'));
  assert.deepEqual(positions, getAutoLayoutPositions({
    ...fallbackModel,
    elements: [...fallbackModel.elements].reverse(),
    relationships: [...fallbackModel.relationships].reverse(),
  }));
});

test('routes products vertically and resource-process relationships horizontally', () => {
  const product = model.elements.find((element) => element.id === 'product-input');
  const process = model.elements.find((element) => element.id === 'process-work');
  const resource = {
    id: 'resource-tool',
    name: 'Tool',
    type: 'resource' as const,
    kind: 'definition' as const,
    definition_id: null,
    description: '',
    attributes: [],
    x: 0,
    y: 0,
  };

  assert.deepEqual(getRelationshipHandles(product, process), {
    sourceHandle: 'source-bottom',
    targetHandle: 'target-top',
  });
  assert.deepEqual(getRelationshipHandles(resource, process), {
    sourceHandle: 'source-right',
    targetHandle: 'target-left',
  });
  assert.deepEqual(getRelationshipHandles(process, resource), {
    sourceHandle: 'source-right',
    targetHandle: 'target-left',
  });
});

test('renders canonical resource-process relationships from the process to the resource', () => {
  const resource = {
    id: 'resource-tool',
    name: 'Tool',
    type: 'resource' as const,
    kind: 'definition' as const,
    definition_id: null,
    description: '',
    attributes: [],
    x: 0,
    y: 0,
  };
  const process = model.elements.find((element) => element.id === 'process-work');
  assert.ok(process);
  const resourceProcessModel: PprModel = {
    ...model,
    elements: [...model.elements, resource],
    relationships: [{ id: 'rel-performs', source_id: resource.id, target_id: process.id, kind: 'performs' }],
  };
  const [edge] = modelToFlowEdges(resourceProcessModel, new Set());

  assert.equal(edge.source, process.id);
  assert.equal(edge.target, resource.id);
  assert.equal(edge.sourceHandle, 'source-right');
  assert.equal(edge.targetHandle, 'target-left');
});

test('shows process-linked resource ancestors and expands descendants without changing the model', () => {
  const cell = {
    id: 'resource-cell',
    name: 'Cell',
    type: 'resource' as const,
    kind: 'definition' as const,
    definition_id: null,
    description: '',
    attributes: [],
    x: 0,
    y: 0,
  };
  const tool = {
    id: 'resource-tool',
    name: 'Tool',
    type: 'resource' as const,
    kind: 'definition' as const,
    definition_id: null,
    description: '',
    attributes: [],
    x: 0,
    y: 0,
  };
  const fixture = { ...tool, id: 'resource-fixture', name: 'Fixture' };
  const visibilityModel: PprModel = {
    ...model,
    elements: [...model.elements, cell, tool, fixture],
    relationships: [
      { id: 'rel-cell-tool', source_id: cell.id, target_id: tool.id, kind: 'contains' },
      { id: 'rel-tool-fixture', source_id: tool.id, target_id: fixture.id, kind: 'contains' },
      { id: 'rel-tool-process', source_id: tool.id, target_id: 'process-work', kind: 'performs' },
    ],
  };

  assert.deepEqual(
    [...getVisibleResourceIds(visibilityModel)].sort(),
    ['resource-cell', 'resource-tool'],
  );
  assert.deepEqual(
    [...getVisibleResourceIds(visibilityModel, new Set(['resource-cell', 'resource-tool']))].sort(),
    ['resource-cell', 'resource-fixture', 'resource-tool'],
  );
  assert.equal(visibilityModel.relationships.length, 3);
});