import assert from 'node:assert/strict';
import test from 'node:test';
import type { PprModel } from '@workspace/api-client-react';
import {
  createPprProjectFile,
  getProjectModel,
  getSavedProjectLayouts,
  getSavedProjectViewports,
  isPprProjectFile,
  parsePprProjectFile,
} from './project-file';

const model: PprModel = {
  id: 'project-file-test',
  name: 'Robot cell project',
  description: 'Round-trip fixture',
  library: {
    definitions: [
      {
        id: 'robot-definition',
        name: 'Industrial robot',
        type: 'resource',
        kind: 'definition',
        definition_id: null,
        domain: 'Robotics',
        parent_definition_id: null,
        description: '',
        attributes: [],
        x: 0,
        y: 0,
      },
    ],
  },
  diagram: {
    usages: [
      { id: 'part', name: 'Part', type: 'product', kind: 'usage', definition_id: null, description: '', attributes: [], x: 100, y: 100 },
      { id: 'weld', name: 'Weld', type: 'process', kind: 'usage', definition_id: null, description: '', attributes: [], x: 400, y: 100 },
      { id: 'robot', name: 'Robot', type: 'resource', kind: 'usage', definition_id: 'robot-definition', description: '', attributes: [], x: 400, y: 300 },
    ],
    relationships: [
      { id: 'input', source_id: 'part', target_id: 'weld', kind: 'consumed_by' },
      { id: 'performs', source_id: 'robot', target_id: 'weld', kind: 'performs' },
    ],
  },
};

test('creates a complete project file with the Library and five React Flow snapshots', () => {
  const file = createPprProjectFile(model, {
    surface: 'product',
    product_view_mode: 'bom',
    resource_view_mode: 'nested',
    layouts: {
      'product:bom': { part: { x: 72, y: 84 } },
      'resource:nested': { robot: { x: 36, y: 48 } },
    },
    viewports: { ppr: { x: 12, y: 24, zoom: 0.8 } },
  });

  assert.equal(file.file_type, 'ppr-modeler-project');
  assert.equal(file.schema_version, 1);
  assert.deepEqual(Object.keys(file.react_flow), ['ppr', 'levels', 'process', 'product', 'resource']);
  assert.equal(file.library.definitions[0].domain, 'Robotics');
  assert.equal(file.react_flow.ppr.nodes.length, 3);
  assert.equal(file.react_flow.process.nodes.every((node) => node.data.element?.type === 'process'), true);
  assert.deepEqual(file.react_flow.ppr.viewport, { x: 12, y: 24, zoom: 0.8 });
  assert.equal(file.react_flow.ppr.viewport_saved, true);
  assert.equal(file.react_flow.resource.viewport_saved, false);
  assert.equal(file.workspace.process_view_mode, 'nested');
  assert.equal(file.workspace.resource_view_mode, 'nested');
  assert.deepEqual(file.react_flow.product.nodes.find((node) => node.id === 'part')?.position, { x: 72, y: 84 });
  assert.deepEqual(file.react_flow.resource.nodes.find((node) => node.id === 'robot')?.position, { x: 36, y: 48 });
  assert.deepEqual(getSavedProjectLayouts(file), {
    'levels:0': {
      part: file.react_flow.levels.nodes.find((node) => node.id === 'part')?.position,
      weld: file.react_flow.levels.nodes.find((node) => node.id === 'weld')?.position,
      robot: file.react_flow.levels.nodes.find((node) => node.id === 'robot')?.position,
    },
    process: {
      weld: file.react_flow.process.nodes.find((node) => node.id === 'weld')?.position,
    },
    'product:bom': { part: { x: 72, y: 84 } },
    'resource:nested': { robot: { x: 36, y: 48 } },
  });
  assert.deepEqual(getSavedProjectViewports(file), { ppr: { x: 12, y: 24, zoom: 0.8 } });
});

test('parses a project file and reconstructs its canonical model', () => {
  const created = createPprProjectFile(model, {
    surface: 'graph',
    product_view_mode: 'ppr',
  });
  const serialized = JSON.parse(JSON.stringify(created)) as unknown;
  const parsed = parsePprProjectFile(serialized);

  assert.equal(isPprProjectFile(parsed), true);
  assert.deepEqual(getProjectModel(parsed), model);
  assert.throws(() => parsePprProjectFile({ ...parsed, schema_version: 99 }), /not a supported PPR project/i);
});
