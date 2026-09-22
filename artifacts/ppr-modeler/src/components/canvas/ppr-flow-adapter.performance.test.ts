import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import test from 'node:test';
import type { PprModel } from '@workspace/api-client-react';
import {
  getPprFlowRenderProfile,
  modelToFlowEdges,
  modelToFlowNodes,
} from './ppr-flow-adapter';

function createRepresentativeLargeModel(): PprModel {
  const elements = Array.from({ length: 600 }, (_, index) => {
    const type = index % 3 === 0 ? 'product' : index % 3 === 1 ? 'process' : 'resource';
    return {
      id: `large-element-${index}`,
      name: `Engineering element ${index}`,
      type,
      kind: 'definition' as const,
      definition_id: null,
      description: index % 5 === 0 ? 'Representative large-model description.' : '',
      attributes: [],
      x: (index % 20) * 320,
      y: Math.floor(index / 20) * 180,
    };
  });

  const relationships = Array.from({ length: 1200 }, (_, index) => ({
    id: `large-relationship-${index}`,
    source_id: elements[index % elements.length].id,
    target_id: elements[(index * 7 + 11) % elements.length].id,
    kind: (index % 4 === 0
      ? 'consumed_by'
      : index % 4 === 1
        ? 'produces'
        : index % 4 === 2
          ? 'performs'
          : 'succeeds') as PprModel['relationships'][number]['kind'],
  }));

  return {
    id: 'representative-large-model',
    name: 'Representative large engineering model',
    description: '',
    elements,
    relationships,
  };
}

test('keeps dense graph affordances bounded for large models', () => {
  assert.deepEqual(getPprFlowRenderProfile(100, 150), {
    isDense: false,
    showEdgeLabels: true,
    showMiniMap: true,
    allowSelectionOnDrag: true,
  });
  assert.deepEqual(getPprFlowRenderProfile(101, 150), {
    isDense: true,
    showEdgeLabels: false,
    showMiniMap: false,
    allowSelectionOnDrag: false,
  });
});

test('adapts a representative 600-node, 1200-relationship model quickly', () => {
  const model = createRepresentativeLargeModel();
  const selectedElementIds = new Set(['large-element-12']);
  const selectedRelationshipIds = new Set(['large-relationship-12']);

  // Warm up module/JIT work so the reported sample reflects repeated updates.
  modelToFlowNodes(model, selectedElementIds);
  modelToFlowEdges(model, selectedRelationshipIds);

  const startedAt = performance.now();
  const nodes = modelToFlowNodes(model, selectedElementIds);
  const edges = modelToFlowEdges(model, selectedRelationshipIds);
  const durationMs = performance.now() - startedAt;

  console.info(
    `[PPR performance] ${nodes.length} nodes + ${edges.length} edges adapted in ${durationMs.toFixed(2)}ms`,
  );
  assert.equal(nodes.filter((node) => node.type === 'pprNode').length, model.elements.length);
  assert.equal(edges.length, model.relationships.length);
  // This is intentionally generous for shared CI runners while catching
  // accidental quadratic work in the adapter.
  assert.ok(durationMs < 500, `adapter conversion took ${durationMs.toFixed(2)}ms`);
});