import { expect, test, type Locator, type Page, type Request as PlaywrightRequest } from '@playwright/test';
import { readFileSync } from 'node:fs';
import type { PprModel } from '@workspace/api-client-react';
import { fileURLToPath } from 'node:url';

type ScenarioFixture = { scenarios: Array<{ id: string; model: PprModel }> };

const scenarioFixture = JSON.parse(
  readFileSync(fileURLToPath(new URL('../testing/ppr-scenarios.json', import.meta.url)), 'utf8'),
) as ScenarioFixture;

function scenarioModel(id: string): PprModel {
  const scenario = scenarioFixture.scenarios.find((candidate) => candidate.id === id);
  if (!scenario) throw new Error(`Unknown browser PPR scenario: ${id}`);
  return structuredClone(scenario.model);
}

function createBrowserFixtureModel(): PprModel {
  const usages: PprModel['diagram']['usages'] = [
    { id: 'product-input', name: 'Input', type: 'product', kind: 'usage', definition_id: 'def-product-input', description: 'Incoming material', attributes: [], x: 120, y: 220, visible_in_ppr: true },
    { id: 'process-work', name: 'Work', type: 'process', kind: 'usage', definition_id: 'def-process-work', description: 'Transforms the input', attributes: [], x: 470, y: 220, visible_in_ppr: true },
    { id: 'product-output', name: 'Output', type: 'product', kind: 'usage', definition_id: 'def-product-output', description: 'Finished material', attributes: [], x: 820, y: 220, visible_in_ppr: true },
    { id: 'product-intermediate', name: 'Intermediate', type: 'product', kind: 'usage', definition_id: 'def-product-intermediate', description: 'Output of the first operation', attributes: [], x: 820, y: 420, visible_in_ppr: true },
    { id: 'product-orphan', name: 'Orphan', type: 'product', kind: 'usage', definition_id: 'def-product-orphan', description: 'Unconnected review fixture', attributes: [], x: 120, y: 720, visible_in_ppr: true },
    { id: 'process-finish', name: 'Finish', type: 'process', kind: 'usage', definition_id: 'def-process-finish', description: 'Finishes the intermediate', attributes: [], x: 470, y: 420, visible_in_ppr: true },
    { id: 'resource-tool', name: 'Tool', type: 'resource', kind: 'usage', definition_id: 'def-resource-tool', description: 'Performs the work', attributes: [], x: 470, y: 520, visible_in_ppr: true },
    { id: 'resource-shared', name: 'Shared Fixture', type: 'resource', kind: 'usage', definition_id: 'def-resource-shared', description: 'Supports both operations', attributes: [], x: 820, y: 520, visible_in_ppr: true },
    { id: 'resource-unassigned', name: 'Unassigned', type: 'resource', kind: 'usage', definition_id: 'def-resource-unassigned', description: 'Unassigned test resource', attributes: [], x: 120, y: 920, visible_in_ppr: true },
  ];
  return {
    id: 'browser-interaction-fixture',
    name: 'Browser Interaction Fixture',
    description: 'Private browser-test data; not exposed as an app example.',
    library: {
      definitions: usages.map((usage) => ({
        ...usage,
        id: usage.definition_id!,
        name: `${usage.name} Definition`,
        kind: 'definition' as const,
        definition_id: null,
        domain: usage.type === 'resource' ? 'Robotics' : usage.type === 'process' ? 'Assembly' : 'Logistics',
        parent_definition_id: usage.id === 'resource-tool' ? 'def-resource-shared' : null,
      })),
    },
    diagram: {
      usages,
      relationships: [
        { id: 'rel-input', source_id: 'product-input', target_id: 'process-work', kind: 'consumed_by', quantity: 3, unit: 'kg' },
        { id: 'rel-output', source_id: 'process-work', target_id: 'product-intermediate', kind: 'produces' },
        { id: 'rel-intermediate-input', source_id: 'product-intermediate', target_id: 'process-finish', kind: 'consumed_by', quantity: 2, unit: 'm' },
        { id: 'rel-finish-output', source_id: 'process-finish', target_id: 'product-output', kind: 'produces' },
        { id: 'rel-performs', source_id: 'resource-tool', target_id: 'process-work', kind: 'performs' },
        { id: 'rel-shared-support-work', source_id: 'resource-shared', target_id: 'process-work', kind: 'performs', modality: 'supports' },
        { id: 'rel-shared-support-finish', source_id: 'resource-shared', target_id: 'process-finish', kind: 'performs', modality: 'supports' },
        { id: 'rel-invalid', source_id: 'product-input', target_id: 'process-finish', kind: 'produces' },
        { id: 'rel-missing', source_id: 'resource-missing', target_id: 'process-finish', kind: 'performs' },
      ],
    },
  };
}

const initialModel: PprModel = createBrowserFixtureModel();

function copyModel(sourceModel: PprModel = initialModel) {
  return structuredClone(sourceModel);
}

function createBrowserProjectFile(
  model: PprModel,
  workspace: {
    surface: 'graph' | 'library' | 'process' | 'product' | 'resource';
    process_view_mode: 'nested';
    product_view_mode: 'ppr' | 'bom';
  },
) {
  const snapshot = {
    nodes: model.diagram.usages.map((element) => ({
      id: element.id,
      type: 'pprNode',
      position: { x: element.x, y: element.y },
      data: { element },
    })),
    edges: model.diagram.relationships.map((relationship) => ({
      id: relationship.id,
      type: 'pprEdge',
      source: relationship.source_id,
      target: relationship.target_id,
      data: { relationship, is_derived: false },
    })),
    viewport: { x: 0, y: 0, zoom: 1 },
    viewport_saved: false,
  };
  return {
    file_type: 'ppr-modeler-project',
    schema_version: 1,
    saved_at: '2026-09-02T12:00:00.000Z',
    project: { id: model.id, name: model.name, description: model.description },
    library: model.library,
    diagram: model.diagram,
    react_flow: {
      ppr: structuredClone(snapshot),
      process: structuredClone(snapshot),
      product: structuredClone(snapshot),
      resource: structuredClone(snapshot),
    },
    workspace,
  };
}

async function installModelApi(page: Page, sourceModel: PprModel = initialModel, failurePaths: string[] = []) {
  const store = { model: copyModel(sourceModel) };
  const baselineModel = copyModel(sourceModel);
  baselineModel.name = 'Stable baseline';
  let checkpointModel = copyModel(sourceModel);
  let nextRevision = 3;
  const savedRevisions = [
    { id: 'browser-revision-current', revision: 2, model: checkpointModel },
    { id: 'browser-revision-baseline', revision: 1, model: baselineModel },
  ];
  let elementNumber = 0;
  let relationshipNumber = 0;
  const requests: PlaywrightRequest[] = [];

  await page.route(/\/api\/model(?:\/.*)?(?:\?.*)?$/, async (route) => {
    const request = route.request();
    requests.push(request);
    const url = new URL(request.url());
    const path = url.pathname;

    if (failurePaths.includes(`${request.method()} ${path}`)) {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'The model service rejected this change.' }),
      });
      return;
    }

    if (request.method() === 'GET' && path === '/api/model') {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(store.model) });
      return;
    }

    if (request.method() === 'GET' && path === '/api/model/revisions') {
      const revisions = savedRevisions.map((savedRevision, index) => ({
        id: savedRevision.id,
        revision: savedRevision.revision,
        created_at: index === 0 ? '2026-08-31T12:00:00Z' : '2026-08-31T11:45:00Z',
        created_by: 'Workspace user',
        summary: index === 0 ? 'Saved model snapshot' : 'Initial model snapshot',
        model_name: savedRevision.model.name,
        element_count: savedRevision.model.diagram.usages.length,
        relationship_count: savedRevision.model.diagram.relationships.length,
        is_current: JSON.stringify(store.model) === JSON.stringify(savedRevision.model),
      }));
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(revisions) });
      return;
    }

    if (request.method() === 'GET' && path === '/api/model/revisions/browser-revision-current') {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'browser-revision-current',
          revision: 2,
          created_at: '2026-08-31T12:00:00Z',
          created_by: 'Workspace user',
          summary: 'Saved model snapshot',
           model_name: checkpointModel.name,
           element_count: checkpointModel.diagram.usages.length,
           relationship_count: checkpointModel.diagram.relationships.length,
           is_current: JSON.stringify(store.model) === JSON.stringify(checkpointModel),
           model: checkpointModel,
        }),
      });
      return;
    }

    if (request.method() === 'GET' && path === '/api/model/revisions/browser-revision-baseline') {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'browser-revision-baseline',
          revision: 1,
          created_at: '2026-08-31T11:45:00Z',
          created_by: 'Workspace user',
          summary: 'Initial model snapshot',
          model_name: baselineModel.name,
          element_count: baselineModel.diagram.usages.length,
          relationship_count: baselineModel.diagram.relationships.length,
          is_current: false,
          model: baselineModel,
        }),
      });
      return;
    }

    if (request.method() === 'POST' && path === '/api/model/revisions/browser-revision-baseline/restore') {
      store.model = copyModel(baselineModel);
      checkpointModel = copyModel(baselineModel);
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(store.model) });
      return;
    }

    if (request.method() === 'PUT' && path === '/api/model') {
      store.model = copyModel(request.postDataJSON() as PprModel);
      if (url.searchParams.get('checkpoint') !== 'false' && JSON.stringify(store.model) !== JSON.stringify(checkpointModel)) {
        checkpointModel = copyModel(store.model);
        savedRevisions.unshift({
          id: `browser-revision-${nextRevision}`,
          revision: nextRevision++,
          model: checkpointModel,
        });
      }
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(store.model) });
      return;
    }

    if (request.method() === 'POST' && path === '/api/model/import/automationml') {
      expect(request.postData() ?? '').toContain('<CAEXFile');
      store.model = copyModel(scenarioModel('body-side-spot-welding'));
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(store.model) });
      return;
    }

    if (request.method() === 'POST' && path === '/api/model/import/sysml') {
      expect(request.postData() ?? '').toContain('package');
      store.model = copyModel(scenarioModel('battery-module-assembly'));
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(store.model) });
      return;
    }

    if (request.method() === 'POST' && path === '/api/model/elements') {
      const input = request.postDataJSON() as Omit<PprModel['diagram']['usages'][number], 'id'>;
      const created = {
        ...input,
        id: `browser-element-${++elementNumber}`,
        kind: 'usage' as const,
        description: input.description ?? '',
        attributes: input.attributes ?? [],
        x: input.x ?? 100,
        y: input.y ?? 100,
      };
      store.model = { ...store.model, diagram: { ...store.model.diagram, usages: [...store.model.diagram.usages, created] } };
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(created) });
      return;
    }

    if (request.method() === 'POST' && path === '/api/model/definitions') {
      const input = request.postDataJSON() as Omit<PprModel['library']['definitions'][number], 'id'>;
      const created = {
        ...input,
        id: `browser-definition-${++elementNumber}`,
        kind: 'definition' as const,
        definition_id: null,
        domain: input.domain ?? null,
        description: input.description ?? '',
        attributes: input.attributes ?? [],
        x: 0,
        y: 0,
      };
      store.model = { ...store.model, library: { definitions: [...store.model.library.definitions, created] } };
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(created) });
      return;
    }

    if (request.method() === 'PATCH' && path.startsWith('/api/model/definitions/')) {
      const definitionId = decodeURIComponent(path.split('/').at(-1) ?? '');
      const updates = request.postDataJSON() as Partial<PprModel['library']['definitions'][number]>;
      const definition = store.model.library.definitions.find((candidate) => candidate.id === definitionId);
      if (!definition) {
        await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ message: 'Not found' }) });
        return;
      }
      store.model = {
        ...store.model,
        library: {
          definitions: store.model.library.definitions.map((candidate) =>
            candidate.id === definitionId ? { ...candidate, ...updates } : candidate,
          ),
        },
      };
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(store.model.library.definitions.find((candidate) => candidate.id === definitionId)),
      });
      return;
    }

    if (request.method() === 'PATCH' && path.startsWith('/api/model/elements/')) {
      const elementId = decodeURIComponent(path.split('/').at(-1) ?? '');
      const updates = request.postDataJSON() as Partial<PprModel['diagram']['usages'][number]>;
      const element = store.model.diagram.usages.find((candidate) => candidate.id === elementId);
      if (!element) {
        await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ message: 'Not found' }) });
        return;
      }
      store.model = {
        ...store.model,
        diagram: {
          ...store.model.diagram,
          usages: store.model.diagram.usages.map((candidate) =>
            candidate.id === elementId ? { ...candidate, ...updates } : candidate,
          ),
        },
      };
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(store.model.diagram.usages.find((candidate) => candidate.id === elementId)),
      });
      return;
    }

    if (request.method() === 'DELETE' && path.startsWith('/api/model/elements/')) {
      const elementId = decodeURIComponent(path.split('/').at(-1) ?? '');
      store.model = {
        ...store.model,
        diagram: {
          ...store.model.diagram,
          usages: store.model.diagram.usages.filter((element) => element.id !== elementId),
          relationships: store.model.diagram.relationships.filter(
            (relationship) => relationship.source_id !== elementId && relationship.target_id !== elementId,
          ),
        },
      };
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({}) });
      return;
    }

    if (request.method() === 'POST' && path === '/api/model/merge') {
      const merge = request.postDataJSON() as {
        first_id: string;
        second_id: string;
        survivor_id: string;
        name_source: 'first' | 'second';
        description_source: 'first' | 'second';
        definition_source: 'first' | 'second' | 'none';
        self_loop_policy: 'reject' | 'drop';
      };
      const first = store.model.diagram.usages.find((element) => element.id === merge.first_id);
      const second = store.model.diagram.usages.find((element) => element.id === merge.second_id);
      if (!first || !second || first.type !== second.type) {
        await route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ detail: { error: 'Invalid merge' } }) });
        return;
      }
      const survivor = merge.survivor_id === first.id ? first : second;
      const endpointReplacement = new Map([[first.id, survivor.id], [second.id, survivor.id]]);
      const seenRelationships = new Set<string>();
      const relationships = store.model.diagram.relationships.flatMap((relationship) => {
        const sourceId = endpointReplacement.get(relationship.source_id) ?? relationship.source_id;
        const targetId = endpointReplacement.get(relationship.target_id) ?? relationship.target_id;
        if (sourceId === targetId) {
          if (merge.self_loop_policy === 'drop') return [];
          return [relationship];
        }
        const key = `${sourceId}|${targetId}|${relationship.kind}`;
        if (seenRelationships.has(key)) return [];
        seenRelationships.add(key);
        return [{ ...relationship, source_id: sourceId, target_id: targetId }];
      });
      const merged = {
        ...survivor,
        name: merge.name_source === 'first' ? first.name : second.name,
        description: merge.description_source === 'first' ? first.description : second.description,
        definition_id: merge.definition_source === 'none'
          ? null
          : merge.definition_source === 'first' ? first.definition_id : second.definition_id,
        attributes: [...survivor.attributes, ...(survivor.id === first.id ? second.attributes : first.attributes)],
      };
      store.model = {
        ...store.model,
        diagram: {
          usages: store.model.diagram.usages
            .filter((element) => element.id !== first.id && element.id !== second.id)
            .concat(merged),
          relationships,
        },
      };
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(store.model) });
      return;
    }

    if (request.method() === 'POST' && path === '/api/model/relationships') {
      const relationship = request.postDataJSON() as Omit<PprModel['diagram']['relationships'][number], 'id'>;
      const created = { ...relationship, id: `browser-rel-${++relationshipNumber}` };
      store.model = { ...store.model, diagram: { ...store.model.diagram, relationships: [...store.model.diagram.relationships, created] } };
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(created) });
      return;
    }

    if (request.method() === 'PATCH' && path.startsWith('/api/model/relationships/')) {
      const relationshipId = decodeURIComponent(path.split('/').at(-1) ?? '');
      const updates = request.postDataJSON() as Partial<PprModel['diagram']['relationships'][number]>;
      const relationship = store.model.diagram.relationships.find((candidate) => candidate.id === relationshipId);
      if (!relationship) {
        await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ message: 'Not found' }) });
        return;
      }
      store.model = {
        ...store.model,
        diagram: {
          ...store.model.diagram,
          relationships: store.model.diagram.relationships.map((candidate) =>
            candidate.id === relationshipId ? { ...candidate, ...updates } : candidate,
          ),
        },
      };
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(store.model.diagram.relationships.find((candidate) => candidate.id === relationshipId)),
      });
      return;
    }

    if (request.method() === 'DELETE' && path.startsWith('/api/model/relationships/')) {
      const relationshipId = decodeURIComponent(path.split('/').at(-1) ?? '');
      store.model = {
        ...store.model,
        diagram: {
          ...store.model.diagram,
          relationships: store.model.diagram.relationships.filter((relationship) => relationship.id !== relationshipId),
        },
      };
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({}) });
      return;
    }

    await route.continue();
  });

  return {
    requests,
    getModel: () => store.model,
  };
}

async function openModel(page: Page, sourceModel: PprModel = initialModel, failurePaths: string[] = []) {
  const api = await installModelApi(page, sourceModel, failurePaths);
  await page.goto('/');
  await expect(page.getByTestId(`node-ppr-${sourceModel.diagram.usages[0].id}`)).toBeVisible();
  return api;
}

function createLargeModel(): PprModel {
  const definitions = Array.from({ length: 140 }, (_, index) => ({
    id: `large-${index}`,
    name: `Large model definition ${index}`,
    type: (index % 3 === 0 ? 'product' : index % 3 === 1 ? 'process' : 'resource') as PprModel['diagram']['usages'][number]['type'],
    kind: 'definition' as const,
    definition_id: null,
    domain: ['Robotics', 'Logistics', 'Assembly systems', 'Quality'][index % 4],
    description: '',
    attributes: [],
    x: 0,
    y: 0,
    visible_in_ppr: true,
  }));
  const usages = definitions.map((definition, index) => ({
    ...definition,
    id: `large-usage-${index}`,
    name: `Large model usage ${index}`,
    kind: 'usage' as const,
    definition_id: definition.id,
    x: (index % 14) * 300,
    y: Math.floor(index / 14) * 210,
  }));
  const relationships = Array.from({ length: 220 }, (_, index) => ({
    id: `large-rel-${index}`,
    source_id: usages[index % usages.length].id,
    target_id: usages[(index * 11 + 7) % usages.length].id,
    kind: 'succeeds' as const,
  }));

  return {
    id: 'large-browser-model',
    name: 'Large browser interaction model',
    description: 'A dense model for graph navigation coverage.',
    library: { definitions },
    diagram: { usages, relationships },
  };
}

function bomElement(id: string, name: string, type: 'product' | 'process') {
  return {
    id,
    name,
    type,
    kind: 'definition' as const,
    definition_id: null,
    description: '',
    attributes: [],
    x: 0,
    y: 0,
    visible_in_ppr: true,
  };
}

function resourceElement(id: string, name: string) {
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
    visible_in_ppr: true,
  };
}

function createBomModel(): PprModel {
  const model = copyModel(initialModel);
  model.diagram.usages.push(
    bomElement('process-branch', 'Branch Assembly', 'process'),
    bomElement('product-cycle-a', 'Cycle A', 'product'),
    bomElement('process-cycle-a', 'Cycle A Step', 'process'),
    bomElement('product-cycle-b', 'Cycle B', 'product'),
    bomElement('process-cycle-b', 'Cycle B Step', 'process'),
  );
  model.diagram.relationships.push(
    { id: 'rel-branch-input', source_id: 'product-input', target_id: 'process-branch', kind: 'consumed_by' },
    { id: 'rel-branch-output', source_id: 'process-branch', target_id: 'product-output', kind: 'produces' },
    { id: 'rel-cycle-a-input', source_id: 'product-cycle-a', target_id: 'process-cycle-a', kind: 'consumed_by' },
    { id: 'rel-cycle-a-output', source_id: 'process-cycle-a', target_id: 'product-cycle-b', kind: 'produces' },
    { id: 'rel-cycle-b-input', source_id: 'product-cycle-b', target_id: 'process-cycle-b', kind: 'consumed_by' },
    { id: 'rel-cycle-b-output', source_id: 'process-cycle-b', target_id: 'product-cycle-a', kind: 'produces' },
  );
  return model;
}

function createResourceTreeModel(): PprModel {
  const model = copyModel(initialModel);
  model.diagram.usages.push(
    resourceElement('resource-cell', 'Welding Cell'),
    resourceElement('resource-inspection', 'Inspection Tool'),
    resourceElement('resource-loose', 'Loose Capability'),
    resourceElement('resource-cycle-a', 'Capability Loop A'),
    resourceElement('resource-cycle-b', 'Capability Loop B'),
  );
  model.diagram.relationships.push(
    { id: 'rel-cell-tool', source_id: 'resource-cell', target_id: 'resource-tool', kind: 'contains' },
    { id: 'rel-cell-shared', source_id: 'resource-cell', target_id: 'resource-shared', kind: 'contains' },
    { id: 'rel-tool-inspection', source_id: 'resource-tool', target_id: 'resource-inspection', kind: 'contains' },
    { id: 'rel-tool-shared', source_id: 'resource-tool', target_id: 'resource-shared', kind: 'contains' },
    { id: 'rel-cycle-a-b', source_id: 'resource-cycle-a', target_id: 'resource-cycle-b', kind: 'contains' },
    { id: 'rel-cycle-b-a', source_id: 'resource-cycle-b', target_id: 'resource-cycle-a', kind: 'contains' },
  );
  return model;
}

function relationshipHandle(page: Page, nodeId: string, handleType: 'source' | 'target', handleId: string) {
  return page
    .getByTestId(`node-ppr-${nodeId}`)
    .locator('..')
    .locator(`.react-flow__handle.${handleType}[data-handleid="${handleId}"]`);
}

async function dragBetween(page: Page, source: Locator, target: Locator) {
  await page.waitForTimeout(350);
  await expect(source).toHaveCount(1);
  await expect(target).toHaveCount(1);
  await expect(source).toBeVisible();
  await expect(target).toBeVisible();
  await page.locator('.react-flow__panel').evaluateAll((panels) => {
    panels.forEach((panel) => {
      (panel as HTMLElement).style.pointerEvents = 'none';
    });
  });
  await source.dragTo(target, { steps: 20 });
}

async function dragToEmptyCanvas(page: Page, source: Locator) {
  await page.waitForTimeout(350);
  await expect(source).toHaveCount(1);
  await expect(source).toBeVisible();
  await page.locator('.react-flow__panel').evaluateAll((panels) => {
    panels.forEach((panel) => {
      (panel as HTMLElement).style.pointerEvents = 'none';
    });
  });
  const pane = page.locator('.react-flow__pane');
  const box = await pane.boundingBox();
  if (!box) throw new Error('React Flow pane is not measurable');
  await source.dragTo(pane, {
    targetPosition: { x: box.width * 0.72, y: box.height * 0.86 },
    steps: 20,
  });
}

test('selects nodes and edges', async ({ page }) => {
  await openModel(page);

  const productNode = page.getByTestId('node-ppr-product-input');
  await expect(productNode).not.toContainText('usage');
  await productNode.click();
  await expect(page.locator('#name')).toHaveValue('Input');
  await expect(page.getByText('Diagram usage', { exact: true })).toHaveCount(0);
  await productNode.click({ modifiers: ['Control'] });
  await expect(page.getByText('Select an element or relationship on the canvas to inspect it.')).toBeVisible();
  await productNode.click();

  await page.getByTestId('rf__edge-rel-input').click();
  await expect(page.getByText('Relationship Selected')).toBeVisible();
  await expect(page.getByText('consumed_by', { exact: true })).toBeVisible();

  await page.getByTestId('node-ppr-product-output').click();
  await expect(page.locator('#name')).toHaveValue('Output');
  await expect(page.getByText('Select an element or relationship on the canvas to inspect it.')).toHaveCount(0);

  await page.locator('.react-flow__pane').click({ position: { x: 40, y: 40 } });
  await expect(page.getByText('Select an element or relationship on the canvas to inspect it.')).toBeVisible();

  await page.getByTestId('rf__edge-rel-input').click();
  await expect(page.getByText('Relationship Selected')).toBeVisible();
  await page.getByTestId('rf__edge-rel-input').click();
  await expect(page.getByText('Select an element or relationship on the canvas to inspect it.')).toBeVisible();
  await page.keyboard.press('Delete');
  await expect(page.getByTestId('edge-ppr-rel-input')).toBeVisible();

  await productNode.click();
  await expect(page.locator('#name')).toHaveValue('Input');
});

test('reprojects shared React Flow nodes across PPR, Process, Product, and Resource views', async ({ page }) => {
  await page.addInitScript(() => {
    const runtimeWindow = window as Window & { __capturedRuntimeErrors?: Array<{ message: string; stack?: string }> };
    runtimeWindow.__capturedRuntimeErrors = [];
    window.addEventListener('error', (event) => {
      runtimeWindow.__capturedRuntimeErrors?.push({
        message: event.message,
        stack: event.error instanceof Error ? event.error.stack : undefined,
      });
    });
  });
  await openModel(page);

  const canvas = page.getByTestId('ppr-flow-canvas');
  await expect(canvas).toHaveAttribute('data-perspective', 'ppr');
  await expect(page.getByTestId('node-ppr-product-output')).toBeVisible();
  await page.waitForTimeout(300);
  const viewport = page.locator('.react-flow__viewport');
  const pprViewportTransform = await viewport.evaluate((element) => getComputedStyle(element).transform);

  await page.getByTestId('button-view-product').click();
  await expect(canvas).toHaveAttribute('data-perspective', 'product');
  await expect(page.getByTestId('node-ppr-product-output')).toBeVisible();
  await expect.poll(
    () => viewport.evaluate((element) => getComputedStyle(element).transform),
    { timeout: 300, message: 'the camera should move while nodes are repositioning' },
  ).not.toBe(pprViewportTransform);
  await expect.poll(() => page.getByTestId('node-ppr-product-output').evaluate(
    (node) => getComputedStyle(node.parentElement!).transitionDuration,
  )).toContain('0.5s');
  await expect(page.getByTestId('node-ppr-process-work')).toHaveCount(0);
  await expect(page.getByTestId('edge-ppr-bom-process-finish-product-output-product-intermediate')).toContainText('Built by Finish');
  await page.waitForTimeout(650);

  const finalBox = await page.getByTestId('node-ppr-product-output').boundingBox();
  const intermediateBox = await page.getByTestId('node-ppr-product-intermediate').boundingBox();
  const inputBox = await page.getByTestId('node-ppr-product-input').boundingBox();
  expect(finalBox && intermediateBox && inputBox).toBeTruthy();
  expect(finalBox!.y).toBeLessThan(intermediateBox!.y);
  expect(intermediateBox!.y).toBeLessThan(inputBox!.y);

  await page.getByTestId('node-ppr-product-output').click();
  await expect(page.getByTestId('product-state-sidebar')).toContainText('Final product');
  await expect(page.getByTestId('product-state-sidebar')).toContainText('Finish');

  await page.getByTestId('button-view-process-specification').click();
  await expect(canvas).toHaveAttribute('data-perspective', 'process');
  await expect(page.getByTestId('node-ppr-process-work')).toBeVisible();
  await expect(page.getByTestId('node-ppr-product-output')).toHaveCount(0);
  await expect(page.getByTestId('node-ppr-resource-tool')).toHaveCount(0);
  await expect(page.getByTestId('node-ppr-resource-unassigned')).toHaveCount(0);
  await expect(page.getByTestId('edge-ppr-process-flow-product-intermediate-process-work-process-finish')).toContainText('Intermediate');

  await page.getByTestId('node-ppr-process-work').click();
  await expect(page.getByTestId('process-context-sidebar')).toContainText('Input');
  await expect(page.getByTestId('process-context-sidebar')).toContainText('Intermediate');
  await expect(page.getByTestId('process-context-sidebar')).toContainText('Tool');

  await page.getByTestId('button-view-resource').click();
  await expect(canvas).toHaveAttribute('data-perspective', 'resource');
  await expect(page.getByTestId('node-ppr-resource-tool')).toBeVisible();
  await expect(page.getByTestId('node-ppr-product-output')).toHaveCount(0);
  await page.getByTestId('node-ppr-resource-tool').click();
  await expect(page.getByTestId('resource-context-sidebar')).toContainText('Work');

  await page.getByTestId('button-view-graph').click();
  await expect(canvas).toHaveAttribute('data-perspective', 'ppr');
  await expect(page.getByTestId('node-ppr-product-output')).toBeVisible();
  expect(await page.evaluate(() => (
    window as Window & { __capturedRuntimeErrors?: Array<{ message: string; stack?: string }> }
  ).__capturedRuntimeErrors)).toEqual([]);
});

test('keeps manually arranged nodes movable in a subview without changing canonical coordinates', async ({ page }) => {
  const api = await openModel(page);
  await page.getByTestId('button-view-product').click();
  await expect(page.getByRole('button', { name: 'Auto layout' })).toBeVisible();
  const node = page.getByTestId('node-ppr-product-output');
  await expect(node).toBeVisible();
  await page.waitForTimeout(650);

  const before = await node.boundingBox();
  expect(before).not.toBeNull();
  const defaultNodeTransform = await node.evaluate((element) => getComputedStyle(element).transform);
  const patchCount = api.requests.filter((request) => request.method() === 'PATCH').length;
  await node.hover({ position: { x: 32, y: 20 } });
  await page.mouse.down();
  await page.mouse.move(before!.x + 132, before!.y + 70, { steps: 16 });
  await page.mouse.up();

  const moved = await node.boundingBox();
  expect(moved).not.toBeNull();
  expect(Math.abs(moved!.x - before!.x)).toBeGreaterThan(40);
  expect(Math.abs(moved!.y - before!.y)).toBeGreaterThan(20);
  expect(api.requests.filter((request) => request.method() === 'PATCH')).toHaveLength(patchCount);

  await page.getByTestId('button-view-graph').click();
  await page.getByTestId('button-view-product').click();
  await page.waitForTimeout(650);
  const restored = await node.boundingBox();
  expect(restored).not.toBeNull();
  expect(restored!.x).toBeCloseTo(moved!.x, 0);
  expect(restored!.y).toBeCloseTo(moved!.y, 0);

  await page.getByRole('button', { name: 'Auto layout' }).click();
  await expect.poll(() => node.evaluate((element) => getComputedStyle(element).transform))
    .toBe(defaultNodeTransform);
  expect(api.requests.filter((request) => request.method() === 'PATCH')).toHaveLength(patchCount);
});

test('groups secondary model commands under the header actions menu', async ({ page }) => {
  await openModel(page);

  await expect(page.getByRole('button', { name: 'Save' })).toBeVisible();
  await expect(page.getByTestId('button-aml-export')).toBeVisible();
  await expect(page.getByTestId('button-sysml-export')).toBeVisible();
  await expect(page.getByTestId('button-header-actions')).toBeVisible();
  await expect(page.getByText('Open engineering model', { exact: true })).toHaveCount(0);
  await page.getByTestId('button-header-actions').click();
  await expect(page.getByRole('menuitem', { name: 'Validate' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Export' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Import JSON' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Load Example' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Reset model' })).toBeVisible();
  await page.keyboard.press('Escape');
});

test('imports an AutomationML file and refreshes the workspace surfaces', async ({ page }) => {
  const api = await openModel(page);
  const imported = scenarioModel('body-side-spot-welding');

  await page.getByTestId('node-ppr-product-input').click();
  await expect(page.locator('#name')).toHaveValue('Input');
  await page.getByTestId('button-header-actions').click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('menu-import-exchange-file').click();
  await (await chooser).setFiles({
    name: 'body-side.aml',
    mimeType: 'application/xml',
    buffer: Buffer.from('<?xml version="1.0"?><CAEXFile />'),
  });

  await expect(page.getByTestId('model-name-input')).toHaveValue(imported.name);
  await expect(page.getByTestId(`node-ppr-${imported.diagram.usages[0].id}`)).toBeVisible();
  await expect(page.getByText('Select an element or relationship on the canvas to inspect it.')).toBeVisible();
  expect(api.getModel().name).toBe(imported.name);

  await page.getByTestId('button-view-library').click();
  await expect(page.getByTestId(`library-definition-${imported.library.definitions[0].id}`)).toBeVisible();
});

test('edits the model name directly in the workspace header', async ({ page }) => {
  const api = await openModel(page);
  const modelName = page.getByTestId('model-name-input');
  await expect(modelName).toHaveValue('Browser Interaction Fixture');

  const saveRequest = page.waitForRequest(
    (request) => request.method() === 'PUT' && new URL(request.url()).pathname === '/api/model',
  );
  await modelName.fill('Assembly Line Model');
  await modelName.blur();

  expect((await saveRequest).postDataJSON()).toMatchObject({ name: 'Assembly Line Model' });
  await expect(modelName).toHaveValue('Assembly Line Model');
  expect(api.getModel().name).toBe('Assembly Line Model');
});

test('renames a PPR node by double-clicking its name without accepting blank names', async ({ page }) => {
  const api = await openModel(page);
  const nodeName = page.getByTestId('node-name-product-input');
  await expect(nodeName).toHaveText('Input');

  await nodeName.dblclick();
  const nodeNameInput = page.getByTestId('node-name-input-product-input');
  await expect(nodeNameInput).toHaveValue('Input');
  await nodeNameInput.fill('   ');
  await nodeNameInput.press('Enter');
  await expect(page.getByTestId('node-name-input-product-input')).toHaveCount(0);
  await expect(nodeName).toHaveText('Input');
  expect(api.getModel().diagram.usages.find((element) => element.id === 'product-input')?.name).toBe('Input');

  const updateRequest = page.waitForRequest(
    (request) =>
      request.method() === 'PATCH' &&
      new URL(request.url()).pathname === '/api/model/elements/product-input',
  );
  await nodeName.dblclick();
  await expect(nodeNameInput).toHaveValue('Input');
  await nodeNameInput.fill('Renamed input');
  await nodeNameInput.press('Enter');

  expect((await updateRequest).postDataJSON()).toMatchObject({ name: 'Renamed input' });
  await expect(nodeName).toHaveText('Renamed input');
  expect(api.getModel().diagram.usages.find((element) => element.id === 'product-input')?.name).toBe('Renamed input');
});

test('downloads a complete project JSON with the Library and five React Flow snapshots', async ({ page }) => {
  await openModel(page);

  await page.getByTestId('button-project-file').click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('menu-download-project').click();
  const download = await downloadPromise;
  const downloadPath = await download.path();
  expect(download.suggestedFilename()).toBe('browser-interaction-fixture.ppr-project.json');
  expect(downloadPath).not.toBeNull();
  const project = JSON.parse(readFileSync(downloadPath!, 'utf8')) as ReturnType<typeof createBrowserProjectFile>;

  expect(project.file_type).toBe('ppr-modeler-project');
  expect(project.schema_version).toBe(1);
  expect(project.library.definitions).toHaveLength(initialModel.library.definitions.length);
  expect(project.diagram.usages).toHaveLength(initialModel.diagram.usages.length);
  expect(Object.keys(project.react_flow)).toEqual(['ppr', 'levels', 'process', 'product', 'resource']);
  for (const flow of Object.values(project.react_flow)) {
    expect(Array.isArray(flow.nodes)).toBe(true);
    expect(Array.isArray(flow.edges)).toBe(true);
    expect(flow.viewport).toEqual(expect.objectContaining({ x: expect.any(Number), y: expect.any(Number), zoom: expect.any(Number) }));
  }
});

test('opens a complete project JSON and restores its model, Library, and workspace surface', async ({ page }) => {
  const api = await openModel(page);
  const restoredModel = copyModel();
  restoredModel.name = 'Restored robot project';
  restoredModel.library.definitions[0].domain = 'Restored collection';
  const project = createBrowserProjectFile(restoredModel, {
    surface: 'library',
    process_view_mode: 'nested',
    product_view_mode: 'bom',
  });
  project.react_flow.product.viewport = { x: 40, y: 60, zoom: 0.75 };
  project.react_flow.product.viewport_saved = true;

  await page.getByTestId('input-open-project').setInputFiles({
    name: 'restored.ppr-project.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(project)),
  });

  await expect(page.getByText('Project opened')).toBeVisible();
  await expect(page.getByTestId('model-name-input')).toHaveValue('Restored robot project');
  await expect(page.getByTestId('ppr-library-view')).toBeVisible();
  await expect(page.getByTestId('library-collection-restored-collection')).toBeVisible();
  expect(api.getModel().library.definitions[0].domain).toBe('Restored collection');
});

test('searches a large Library catalog without expanding the collection sidebar', async ({ page }) => {
  await openModel(page, createLargeModel());

  await page.getByTestId('button-view-library').click();
  const library = page.getByTestId('ppr-library-view');
  await expect(library.getByTestId('library-collection-all')).toContainText('140');
  await expect(library.getByTestId('library-collection-robotics')).toBeVisible();
  await expect(library.getByTestId('library-definition-large-0')).toBeVisible();

  await library.getByTestId('library-search').fill('definition 139');
  await expect(library.getByTestId('library-definition-large-139')).toBeVisible();
  await expect(library.getByTestId('library-definition-large-0')).toHaveCount(0);
});

test('organizes reusable Library assets by collection and PPR type', async ({ page }) => {
  await openModel(page);
  await page.getByTestId('button-view-library').click();

  const library = page.getByTestId('ppr-library-view');
  await expect(library.getByTestId('library-collection-robotics')).toBeVisible();
  await expect(library.getByTestId('library-collection-logistics')).toBeVisible();
  await expect(library.getByTestId('library-collection-assembly')).toBeVisible();
  for (const type of ['product', 'process', 'resource']) {
    await expect(library.getByTestId(`library-type-section-${type}`)).toBeVisible();
  }
  await expect(library.getByTestId('library-type-section-product').getByTestId('library-definition-def-product-input')).toBeVisible();
  await expect(library.getByTestId('library-type-section-process').getByTestId('library-definition-def-process-work')).toBeVisible();
  await expect(library.getByTestId('library-type-section-resource').getByTestId('library-definition-def-resource-tool')).toBeVisible();

  await library.getByTestId('library-collection-robotics').click();
  await expect(library.getByTestId('library-definition-def-resource-tool')).toBeVisible();
  await expect(library.getByTestId('library-definition-def-product-input')).toHaveCount(0);
});

test('creates a definition with an engineering collection and lets it be reclassified', async ({ page }) => {
  const api = await openModel(page);
  await page.getByTestId('button-view-library').click();
  await page.getByTestId('button-create-definition').click();

  const dialog = page.getByTestId('create-definition-dialog');
  await dialog.getByLabel('Name').fill('Six-axis robot');
  await dialog.getByLabel('Collection / domain').fill('Robot cells');
  await expect(dialog.getByTestId('new-definition-domain-confirmation')).toContainText('Will be saved in Robot cells');
  await expect(dialog.getByTestId('new-definition-type-resource')).toHaveAttribute('aria-pressed', 'true');
  await dialog.getByTestId('new-definition-type-product').click();
  await expect(dialog.getByTestId('new-definition-type-product')).toHaveAttribute('aria-pressed', 'true');
  await dialog.getByTestId('new-definition-type-resource').click();
  await dialog.getByLabel('Specializes / parent').click();
  await page.getByRole('option', { name: 'Shared Fixture Definition · Robotics' }).click();
  const createRequest = page.waitForRequest(
    (request) => request.method() === 'POST' && request.url().endsWith('/api/model/definitions'),
  );
  await dialog.getByRole('button', { name: 'Create definition' }).click();
  expect((await createRequest).postDataJSON()).toMatchObject({
    name: 'Six-axis robot',
    type: 'resource',
    domain: 'Robot cells',
    parent_definition_id: 'def-resource-shared',
  });

  await expect(page.getByTestId('library-collection-robot-cells')).toBeVisible();
  const domainInput = page.getByTestId('definition-domain-input');
  await expect(domainInput).toHaveValue('Robot cells');
  await expect(page.getByTestId('definition-inheritance-path')).toContainText('Shared Fixture Definition');
  await expect(page.getByTestId('definition-inheritance-path')).toContainText('Six-axis robot');
  const updateRequest = page.waitForRequest(
    (request) => request.method() === 'PATCH' && request.url().includes('/api/model/definitions/'),
  );
  await domainInput.fill('Factory automation');
  await domainInput.blur();
  expect((await updateRequest).postDataJSON()).toMatchObject({ domain: 'Factory automation' });
  await expect.poll(() => api.getModel().library.definitions.find((definition) => definition.name === 'Six-axis robot')?.domain)
    .toBe('Factory automation');
});

test('opens the SysML v2 export with the SysML v2 format selected', async ({ page }) => {
  await openModel(page);

  await page.getByTestId('button-sysml-export').click();

  const exportDialog = page.getByTestId('model-export');
  await expect(exportDialog).toBeVisible();
  await expect(exportDialog.getByRole('tab', { name: 'PPR / SysML v2' })).toHaveAttribute('data-state', 'active');
  await expect(exportDialog.getByTestId('button-download-model')).toContainText('Download File');
});

test('inspects and explicitly restores an earlier model revision', async ({ page }) => {
  await openModel(page);

  await page.getByTestId('button-revision-history').click();
  const historyDialog = page.getByTestId('dialog-revision-history');
  await expect(historyDialog).toBeVisible();
  await expect(historyDialog.getByTestId('revision-row-browser-revision-current')).toBeVisible();
  await expect(historyDialog.getByTestId('revision-row-browser-revision-baseline')).toBeVisible();
  await expect(historyDialog.getByTestId('revision-history-retention-notice')).toContainText('Older revisions are no longer available');

  await historyDialog.getByTestId('button-inspect-revision-browser-revision-baseline').click();
  await expect(historyDialog.getByTestId('revision-detail')).toContainText('Stable baseline');
  await historyDialog.getByTestId('button-restore-revision-browser-revision-baseline').click();

  const restoreConfirmation = page.getByTestId('alert-dialog-restore-revision');
  await expect(restoreConfirmation).toBeVisible();
  await restoreConfirmation.getByTestId('button-confirm-restore-revision').click();

  await expect(historyDialog).not.toBeVisible();
  await expect(page.getByTestId('model-name-input')).toHaveValue('Stable baseline');
  await expect(page.getByTestId('node-ppr-product-input')).toBeVisible();
});

test('Given development mode, contributors can load a named valid scenario through the model actions', async ({ page }) => {
  const api = await openModel(page);

  await page.getByTestId('button-header-actions').click();
  await expect(page.getByTestId('menu-load-scenario-body-side-spot-welding')).toBeVisible();
  await expect(page.getByTestId('menu-load-scenario-ev-battery-module-assembly')).toBeVisible();
  await expect(page.getByTestId('menu-load-scenario-centrifugal-pump-final-assembly')).toBeVisible();

  const loadRequest = page.waitForRequest(
    (request) => request.method() === 'PUT' && new URL(request.url()).pathname === '/api/model',
  );
  await page.getByTestId('menu-load-scenario-ev-battery-module-assembly').click();
  await loadRequest;

  await expect(page.getByTestId('node-ppr-use_cell_stack')).toBeVisible();
  await expect(page.getByTestId('node-ppr-product-input')).toHaveCount(0);
  expect(api.getModel().name).toBe('EV Battery-Module Assembly');

  const runtimeOverlay = page.locator('vite-error-overlay');
  if (await runtimeOverlay.count()) {
    const runtimeMessage = await runtimeOverlay.evaluate((overlay) => overlay.shadowRoot?.textContent ?? overlay.textContent ?? 'Unknown runtime error');
    throw new Error(runtimeMessage);
  }

  await page.getByTestId('node-ppr-use_cell_stack').click();
  await expect(page.locator('#name')).toHaveValue('Matched Cell Stack');
});

test('keeps edits out of history until Save and deduplicates repeated Save clicks', async ({ page }) => {
  await openModel(page);

  const renameRequest = page.waitForRequest(
    (request) =>
      request.method() === 'PUT' &&
      new URL(request.url()).pathname === '/api/model' &&
      new URL(request.url()).searchParams.get('checkpoint') === 'false',
  );
  const modelName = page.getByTestId('model-name-input');
  await modelName.fill('Unsaved workspace edit');
  await modelName.blur();
  await renameRequest;

  await page.getByTestId('button-revision-history').click();
  const historyDialog = page.getByTestId('dialog-revision-history');
  await expect(historyDialog.getByTestId('revision-row-browser-revision-current')).toBeVisible();
  await expect(historyDialog.getByTestId('revision-row-browser-revision-baseline')).toBeVisible();
  await expect(historyDialog.getByText('Current', { exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');

  const saveRequest = page.waitForRequest(
    (request) =>
      request.method() === 'PUT' &&
      new URL(request.url()).pathname === '/api/model' &&
      new URL(request.url()).searchParams.get('checkpoint') === 'true',
  );
  await page.getByRole('button', { name: 'Save' }).click();
  await saveRequest;

  await page.getByTestId('button-revision-history').click();
  await expect(historyDialog.getByTestId('revision-row-browser-revision-3')).toBeVisible();
  await expect(historyDialog.getByText('Current', { exact: true })).toHaveCount(1);
  await page.keyboard.press('Escape');

  const repeatedSaveRequest = page.waitForRequest(
    (request) =>
      request.method() === 'PUT' &&
      new URL(request.url()).pathname === '/api/model' &&
      new URL(request.url()).searchParams.get('checkpoint') === 'true',
  );
  await page.getByRole('button', { name: 'Save' }).click();
  await repeatedSaveRequest;
  await page.getByTestId('button-revision-history').click();
  await expect(historyDialog.getByTestId('revision-row-browser-revision-3')).toHaveCount(1);
  await expect(historyDialog.locator('[data-testid^="revision-row-"]')).toHaveCount(3);
});

test('Given a named nested scenario, the process and resource reviews remain inspectable', async ({ page }) => {
  await openModel(page, scenarioModel('body-side-spot-welding'));

  await page.getByTestId('button-view-process-specification').click();
  await expect(page.getByTestId('ppr-flow-canvas')).toHaveAttribute('data-perspective', 'process');
  await expect(page.getByTestId('node-ppr-use_body_side_production')).toBeVisible();

  await page.getByTestId('button-view-resource').click();
  await expect(page.getByTestId('ppr-flow-canvas')).toHaveAttribute('data-perspective', 'resource');
  await expect(page.getByTestId('node-ppr-use_welding_cell')).toBeVisible();
  await expect(page.getByTestId('node-ppr-use_welding_robot')).toBeVisible();
});

test('reveals the body-side scenario by PPR level without exposing containment edges', async ({ page }) => {
  await openModel(page, scenarioModel('body-side-spot-welding'));

  await page.getByTestId('button-view-ppr-levels').click();
  await expect(page.getByTestId('ppr-flow-canvas')).toHaveAttribute('data-perspective', 'levels');
  await expect(page.getByTestId('graph-perspective-title')).toContainText('Layered engineering view');
  await expect(page.getByTestId('node-ppr-use_body_side_panel')).toBeVisible();
  await expect(page.getByTestId('node-ppr-use_reinforcement_bracket')).toBeVisible();
  await expect(page.getByTestId('node-ppr-use_body_side_production')).toBeVisible();
  await expect(page.getByTestId('node-ppr-use_welding_cell')).toBeVisible();
  await expect(page.getByTestId('node-ppr-use_inspected_body_side')).toBeVisible();
  await page.waitForTimeout(650);
  const panelInfeedBox = await page.getByTestId('node-ppr-use_body_side_panel').boundingBox();
  const bracketInfeedBox = await page.getByTestId('node-ppr-use_reinforcement_bracket').boundingBox();
  expect(panelInfeedBox && bracketInfeedBox).toBeTruthy();
  expect(panelInfeedBox!.y).toBeCloseTo(bracketInfeedBox!.y, 0);
  await expect(page.getByTestId('node-ppr-use_positioned_panel_assembly')).toHaveCount(0);
  await expect(page.getByTestId('node-ppr-use_spot_weld_joint_set')).toHaveCount(0);
  await expect(page.getByTestId('edge-ppr-levels-input-use_body_side_panel-use_body_side_production')).toBeVisible();
  await expect(page.getByTestId('edge-ppr-rel_production_contains_fixture')).toHaveCount(0);

  await page.getByTestId('button-ppr-level-1').click();
  await expect(page.getByTestId('node-ppr-use_fixture_components')).toBeVisible();
  await expect(page.getByTestId('node-ppr-use_spot_weld_joint_set')).toBeVisible();
  await expect(page.getByTestId('node-ppr-use_locating_fixture')).toBeVisible();
  await expect(page.getByTestId('node-ppr-use_body_side_production')).toHaveAttribute('data-process-container', 'true');
  await expect(page.getByTestId('node-ppr-use_welding_cell')).toHaveAttribute('data-resource-container', 'true');
  await expect(page.getByTestId('edge-ppr-rel_production_contains_fixture')).toHaveCount(0);
  await page.waitForTimeout(650);
  const expandedPanelBox = await page.getByTestId('node-ppr-use_body_side_panel').boundingBox();
  const expandedBracketBox = await page.getByTestId('node-ppr-use_reinforcement_bracket').boundingBox();
  expect(expandedPanelBox && expandedBracketBox).toBeTruthy();
  expect(expandedPanelBox!.y).toBeCloseTo(expandedBracketBox!.y, 0);
});

test('applies auto layout locally to the active PPR layer', async ({ page }) => {
  const api = await openModel(page, scenarioModel('body-side-spot-welding'));

  await page.getByTestId('button-view-ppr-levels').click();
  await page.getByTestId('button-ppr-level-1').click();
  await expect(page.getByTestId('node-ppr-use_fixture_components')).toBeVisible();
  const before = await page.getByTestId('node-ppr-use_fixture_components').boundingBox();
  const patchCount = api.requests.filter((request) => request.method() === 'PATCH').length;

  await page.getByRole('button', { name: 'Auto layout layer' }).click();
  await page.waitForTimeout(300);

  const after = await page.getByTestId('node-ppr-use_fixture_components').boundingBox();
  expect(before && after).toBeTruthy();
  expect(api.requests.filter((request) => request.method() === 'PATCH')).toHaveLength(patchCount);
});

test('switches between node selections without a selection feedback loop', async ({ page }) => {
  await openModel(page);
  const pageErrors: Error[] = [];
  page.on('pageerror', (error) => pageErrors.push(error));

  await page.getByTestId('node-ppr-product-input').click();
  await expect(page.locator('#name')).toHaveValue('Input');
  await page.getByTestId('node-ppr-process-work').click();
  await expect(page.locator('#name')).toHaveValue('Work');
  await expect(page.getByTestId('node-ppr-process-work')).toHaveClass(/ring-ring/);
  expect(pageErrors.map((error) => error.message)).not.toContain(expect.stringContaining('Maximum update depth'));
});

test('supports multi-selection and deletes selected nodes with the keyboard', async ({ page }) => {
  await openModel(page);
  await page.getByTestId('node-ppr-product-input').click();
  await page.getByTestId('node-ppr-process-work').click({ modifiers: ['Control'] });
  await expect(page.getByText('2 elements selected')).toBeVisible();

  const deleteRequest = page.waitForRequest(
    (request) => request.method() === 'DELETE' && request.url().endsWith('/api/model/elements/process-work'),
  );
  await page.keyboard.press('Delete');
  await deleteRequest;
  await expect(page.getByTestId('node-ppr-process-work')).toHaveCount(0);
});

test('merges exactly two same-type usages from the inspector', async ({ page }) => {
  const api = await openModel(page);
  await page.getByTestId('node-ppr-product-input').click();
  await page.getByTestId('node-ppr-product-intermediate').click({ modifiers: ['Control'] });

  await expect(page.getByTestId('button-merge-selected')).toBeVisible();
  await page.getByTestId('button-merge-selected').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Merge product usages' })).toBeVisible();
  await expect(dialog.getByText('Material', { exact: true })).toHaveCount(0);

  const mergeRequest = page.waitForRequest(
    (request) => request.method() === 'POST' && request.url().endsWith('/api/model/merge'),
  );
  await dialog.getByTestId('button-confirm-merge').click();
  const request = await mergeRequest;
  expect(request.postDataJSON()).toMatchObject({
    first_id: 'product-input',
    second_id: 'product-intermediate',
    survivor_id: 'product-input',
    name_source: 'first',
    self_loop_policy: 'reject',
  });

  await expect(page.getByTestId('node-ppr-product-intermediate')).toHaveCount(0);
  await expect(page.getByTestId('node-ppr-product-input')).toBeVisible();
  await expect(page.locator('#name')).toHaveValue('Input');
  expect(api.getModel().diagram.usages.some((element) => element.id === 'product-intermediate')).toBe(false);
  expect(api.getModel().diagram.relationships).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ source_id: 'product-input', target_id: 'process-work', kind: 'consumed_by' }),
      expect.objectContaining({ source_id: 'process-work', target_id: 'product-input', kind: 'produces' }),
    ]),
  );
});

test('opens the merge workflow from a same-type graph drag and allows cancellation', async ({ page }) => {
  const api = await openModel(page);
  await dragBetween(
    page,
    relationshipHandle(page, 'product-input', 'source', 'source-bottom'),
    relationshipHandle(page, 'product-intermediate', 'target', 'target-top'),
  );

  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Merge product usages' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
  expect(api.requests.filter((request) => request.method() === 'POST' && request.url().endsWith('/api/model/merge'))).toHaveLength(0);
  await expect(page.getByTestId('node-ppr-product-input')).toBeVisible();
  await expect(page.getByTestId('node-ppr-product-intermediate')).toBeVisible();
});

test('creates a valid Product relationship from the explicit inspector action', async ({ page }) => {
  const api = await openModel(page);

  await page.getByTestId('node-ppr-product-input').click();
  await page.getByTestId('node-ppr-product-intermediate').click({ modifiers: ['Control'] });
  await page.getByTestId('button-create-relationship-selected').click();

  const dialog = page.getByTestId('create-relationship-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('radio', { name: 'becomes' })).toBeVisible();
  await expect(dialog.getByRole('radio', { name: 'contains' })).toBeVisible();
  await expect(dialog.getByRole('radio', { name: 'contains' })).toBeVisible();
  await expect(dialog.getByRole('radio', { name: 'succeeds' })).toHaveCount(0);
  await expect(dialog.getByRole('radio', { name: 'performs' })).toHaveCount(0);

  await dialog.getByRole('radio', { name: 'becomes' }).check();
  const createRequest = page.waitForRequest(
    (request) => request.method() === 'POST' && request.url().endsWith('/api/model/relationships'),
  );
  await dialog.getByRole('button', { name: 'Create Connection' }).click();
  expect((await createRequest).postDataJSON()).toMatchObject({
    source_id: 'product-input',
    target_id: 'product-intermediate',
    kind: 'becomes',
  });
  await expect.poll(() => api.getModel().diagram.relationships.some((relationship) =>
    relationship.source_id === 'product-input' &&
    relationship.target_id === 'product-intermediate' &&
    relationship.kind === 'becomes',
  )).toBe(true);
});

test('creates a valid Process containment relationship from the explicit inspector action', async ({ page }) => {
  const api = await openModel(page);

  await page.getByTestId('node-ppr-process-finish').click();
  await page.getByTestId('node-ppr-process-work').click({ modifiers: ['Control'] });
  await page.getByTestId('button-create-relationship-selected').click();

  const dialog = page.getByTestId('create-relationship-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('radio', { name: 'succeeds' })).toBeVisible();
  await expect(dialog.getByRole('radio', { name: 'contains' })).toBeVisible();
  await expect(dialog.getByRole('radio', { name: 'becomes' })).toHaveCount(0);

  await dialog.getByRole('radio', { name: 'contains' }).check();
  const createRequest = page.waitForRequest(
    (request) => request.method() === 'POST' && request.url().endsWith('/api/model/relationships'),
  );
  await dialog.getByRole('button', { name: 'Create Connection' }).click();
  expect((await createRequest).postDataJSON()).toMatchObject({
    source_id: 'process-finish',
    target_id: 'process-work',
    kind: 'contains',
  });
  await expect.poll(() => api.getModel().diagram.relationships.some((relationship) =>
    relationship.source_id === 'process-finish' &&
    relationship.target_id === 'process-work' &&
    relationship.kind === 'contains',
  )).toBe(true);
});

test('exposes valid Resource capability choices and allows cancellation', async ({ page }) => {
  const api = await openModel(page);

  await page.getByTestId('node-ppr-resource-tool').click();
  await page.getByTestId('node-ppr-resource-shared').click({ modifiers: ['Control'] });
  await page.getByTestId('button-create-relationship-selected').click();

  const dialog = page.getByTestId('create-relationship-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('radio', { name: 'contains' })).toBeVisible();
  await expect(dialog.getByRole('radio', { name: 'contains' })).toBeVisible();
  await expect(dialog.getByRole('radio', { name: 'succeeds' })).toHaveCount(0);
  await expect(dialog.getByRole('radio', { name: 'becomes' })).toHaveCount(0);

  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
  expect(api.requests.filter((request) => request.method() === 'POST' && request.url().endsWith('/api/model/relationships'))).toHaveLength(0);
  expect(api.getModel().diagram.relationships.some((relationship) =>
    relationship.source_id === 'resource-tool' &&
    relationship.target_id === 'resource-shared' &&
    relationship.kind === 'contains',
  )).toBe(false);
});

test('keeps invalid relationship directions visible but cannot submit them', async ({ page }) => {
  const api = await openModel(page);

  await dragBetween(
    page,
    relationshipHandle(page, 'resource-tool', 'source', 'source-right'),
    relationshipHandle(page, 'product-output', 'target', 'target-top'),
  );

  const dialog = page.getByTestId('create-relationship-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('No valid relationships between resource and product.');
  await expect(dialog.getByRole('button', { name: 'Create Connection' })).toBeDisabled();
  expect(api.requests.filter((request) => request.method() === 'POST' && request.url().endsWith('/api/model/relationships'))).toHaveLength(0);
});

test('notifies and preserves both usages when a merge fails', async ({ page }) => {
  await openModel(page, initialModel, ['POST /api/model/merge']);
  await page.getByTestId('node-ppr-product-input').click();
  await page.getByTestId('node-ppr-product-intermediate').click({ modifiers: ['Control'] });
  await page.getByTestId('button-merge-selected').click();

  await page.getByTestId('button-confirm-merge').click();
  await expect(page.getByText('Could not merge these usages')).toBeVisible();
  await expect(page.getByTestId('node-ppr-product-input')).toBeVisible();
  await expect(page.getByTestId('node-ppr-product-intermediate')).toBeVisible();
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('auto layout puts shuffled inputs above processes and outputs below them', async ({ page }) => {
  const shuffledModel = copyModel();
  shuffledModel.diagram.usages.reverse();
  shuffledModel.diagram.relationships.reverse();
  const api = await openModel(page, shuffledModel);

  await page.getByRole('button', { name: 'Auto layout' }).click();
  await expect.poll(() => api.requests.filter((request) => request.method() === 'PATCH').length).toBe(shuffledModel.diagram.usages.length);

  const input = api.getModel().diagram.usages.find((element) => element.id === 'product-input');
  const process = api.getModel().diagram.usages.find((element) => element.id === 'process-work');
  const output = api.getModel().diagram.usages.find((element) => element.id === 'product-intermediate');
  expect(input?.y).toBeLessThan(process?.y ?? Number.POSITIVE_INFINITY);
  expect(process?.y).toBeLessThan(output?.y ?? Number.POSITIVE_INFINITY);
});

test('aligns selected nodes and persists their positions', async ({ page }) => {
  const api = await openModel(page);
  await page.getByTestId('node-ppr-product-input').click();
  await page.getByTestId('node-ppr-process-finish').click({ modifiers: ['Control'] });

  const alignTools = page.getByTestId('graph-align-tools');
  await expect(alignTools).toBeVisible();
  const alignRequest = page.waitForRequest(
    (request) =>
      request.method() === 'PATCH' &&
      request.url().endsWith('/api/model/elements/process-finish'),
  );
  await page.getByTestId('graph-align-top').click();
  await alignRequest;

  await expect.poll(() => {
    const input = api.getModel().diagram.usages.find((element) => element.id === 'product-input');
    const process = api.getModel().diagram.usages.find((element) => element.id === 'process-finish');
    return input?.y === process?.y;
  }).toBe(true);
  await expect(alignTools).toBeVisible();
});

test('shows temporary alignment guides while dragging a node', async ({ page }) => {
  const api = await openModel(page);
  const source = page.locator('.react-flow__node[data-id="process-work"]');
  const target = page.locator('.react-flow__node[data-id="product-input"]');
  await page.waitForTimeout(350);
  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();
  expect(sourceBox).not.toBeNull();
  expect(targetBox).not.toBeNull();

  const updateRequest = page.waitForRequest(
    (request) =>
      request.method() === 'PATCH' &&
      request.url().endsWith('/api/model/elements/process-work'),
  );
  const dragStart = { x: sourceBox!.x + sourceBox!.width / 2, y: sourceBox!.y + sourceBox!.height / 2 };
  await source.hover({ position: { x: sourceBox!.width / 2, y: sourceBox!.height / 2 } });
  await page.mouse.move(dragStart.x, dragStart.y);
  await page.mouse.down();
  await page.mouse.move(targetBox!.x + targetBox!.width / 2, targetBox!.y + targetBox!.height / 2, { steps: 16 });

  const firstMoveSourceBox = await source.boundingBox();
  const firstMoveTargetBox = await target.boundingBox();
  expect(firstMoveSourceBox).not.toBeNull();
  expect(firstMoveTargetBox).not.toBeNull();
  const centerCorrection = {
    x: (firstMoveTargetBox!.x + firstMoveTargetBox!.width / 2) - (firstMoveSourceBox!.x + firstMoveSourceBox!.width / 2),
    y: (firstMoveTargetBox!.y + firstMoveTargetBox!.height / 2) - (firstMoveSourceBox!.y + firstMoveSourceBox!.height / 2),
  };
  await page.mouse.move(
    firstMoveTargetBox!.x + firstMoveTargetBox!.width / 2 + centerCorrection.x,
    firstMoveTargetBox!.y + firstMoveTargetBox!.height / 2 + centerCorrection.y,
    { steps: 4 },
  );

  await expect(page.getByTestId('alignment-guide-vertical')).toHaveCount(1);
  await expect(page.getByTestId('alignment-guide-horizontal')).toHaveCount(1);

  await page.mouse.up();
  const request = await updateRequest;
  const updates = request.postDataJSON() as { x?: number; y?: number };
  await expect(page.getByTestId('alignment-guide-vertical')).toHaveCount(0);
  await expect(page.getByTestId('alignment-guide-horizontal')).toHaveCount(0);
  expect(api.requests.some((request) =>
    request.method() === 'PATCH' &&
    request.url().endsWith('/api/model/elements/process-work'),
  )).toBe(true);
  const input = initialModel.diagram.usages.find((element) => element.id === 'product-input');
  expect(Math.abs((updates.x ?? 0) - (input?.x ?? 0))).toBeLessThanOrEqual(1);
  expect(Math.abs((updates.y ?? 0) - (input?.y ?? 0))).toBeLessThanOrEqual(1);
});

test('keeps center guides distinguishable in forced-colors mode without persisting guide state', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active' });
  const api = await openModel(page);
  const source = page.locator('.react-flow__node[data-id="process-work"]');
  const target = page.locator('.react-flow__node[data-id="product-input"]');
  await expect.poll(() => page.evaluate(() => window.matchMedia('(forced-colors: active)').matches)).toBe(true);
  await page.waitForTimeout(350);

  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();
  expect(sourceBox).not.toBeNull();
  expect(targetBox).not.toBeNull();

  const updateRequest = page.waitForRequest(
    (request) =>
      request.method() === 'PATCH' &&
      request.url().endsWith('/api/model/elements/process-work'),
  );
  const dragStart = { x: sourceBox!.x + sourceBox!.width / 2, y: sourceBox!.y + sourceBox!.height / 2 };
  await page.mouse.move(dragStart.x, dragStart.y);
  await page.mouse.down();
  await page.mouse.move(targetBox!.x + targetBox!.width / 2, targetBox!.y + targetBox!.height / 2, { steps: 16 });

  const firstMoveSourceBox = await source.boundingBox();
  const firstMoveTargetBox = await target.boundingBox();
  expect(firstMoveSourceBox).not.toBeNull();
  expect(firstMoveTargetBox).not.toBeNull();
  const centerCorrection = {
    x: (firstMoveTargetBox!.x + firstMoveTargetBox!.width / 2) - (firstMoveSourceBox!.x + firstMoveSourceBox!.width / 2),
    y: (firstMoveTargetBox!.y + firstMoveTargetBox!.height / 2) - (firstMoveSourceBox!.y + firstMoveSourceBox!.height / 2),
  };
  await page.mouse.move(
    firstMoveTargetBox!.x + firstMoveTargetBox!.width / 2 + centerCorrection.x,
    firstMoveTargetBox!.y + firstMoveTargetBox!.height / 2 + centerCorrection.y,
    { steps: 4 },
  );

  const guides = page.locator('.ppr-alignment-guide');
  await expect(guides).toHaveCount(2);
  const guideStyles = await guides.evaluateAll((elements) => elements.map((element) => {
    const style = getComputedStyle(element);
    return {
      axis: element.getAttribute('data-axis'),
      color: style.borderColor,
      forcedColorAdjust: style.forcedColorAdjust,
      style: style.borderStyle,
      width: element.getAttribute('data-axis') === 'vertical' ? style.borderLeftWidth : style.borderTopWidth,
    };
  }));
  expect(guideStyles).toEqual(expect.arrayContaining([
    expect.objectContaining({ axis: 'vertical', forcedColorAdjust: 'none', style: 'dashed' }),
    expect.objectContaining({ axis: 'horizontal', forcedColorAdjust: 'none', style: 'dashed' }),
  ]));
  expect(guideStyles.every((guide) => guide.color !== 'transparent' && guide.width !== '0px')).toBe(true);

  await page.mouse.up();
  const request = await updateRequest;
  const updates = request.postDataJSON() as { x?: number; y?: number };
  await expect(guides).toHaveCount(0);
  const input = initialModel.diagram.usages.find((element) => element.id === 'product-input');
  expect(Math.abs((updates.x ?? 0) - (input?.x ?? 0))).toBeLessThanOrEqual(1);
  expect(Math.abs((updates.y ?? 0) - (input?.y ?? 0))).toBeLessThanOrEqual(1);
  expect(api.getModel().diagram.usages.find((element) => element.id === 'process-work')).toMatchObject({
    x: input?.x,
    y: input?.y,
  });
});

test('keeps center snapping usable when zoomed in or out and clears canceled pointer drags', async ({ page }) => {
  const api = await openModel(page);
  const source = page.locator('.react-flow__node[data-id="resource-tool"]');
  const target = page.locator('.react-flow__node[data-id="process-work"]');

  const getZoom = () => page.locator('.react-flow__viewport').evaluate((viewport) => {
    const transform = getComputedStyle(viewport).transform;
    const scale = transform.match(/^matrix\(([^,]+),/);
    return scale ? Number(scale[1]) : 1;
  });

  const dragNearTargetAtCurrentZoom = async () => {
    const sourceBox = await source.boundingBox();
    const targetBox = await target.boundingBox();
    expect(sourceBox).not.toBeNull();
    expect(targetBox).not.toBeNull();

    const pointer = {
      x: sourceBox!.x + sourceBox!.width / 2,
      y: sourceBox!.y + sourceBox!.height / 2,
    };
    const targetCenter = {
      x: targetBox!.x + targetBox!.width / 2,
      y: targetBox!.y + targetBox!.height / 2,
    };
    const screenOffset = 4;

    await page.mouse.move(pointer.x, pointer.y);
    await page.mouse.down();
    await page.mouse.move(targetCenter.x + screenOffset, targetCenter.y + screenOffset, { steps: 12 });
    await expect(page.getByTestId('alignment-guide-vertical')).toHaveCount(1);
    await page.mouse.up();

    await expect.poll(() => api.requests.filter((request) =>
      request.method() === 'PATCH' &&
      request.url().endsWith('/api/model/elements/resource-tool'),
    ).length).toBeGreaterThan(0);
    const updates = api.requests
      .filter((request) =>
        request.method() === 'PATCH' &&
        request.url().endsWith('/api/model/elements/resource-tool'),
      )
      .at(-1)?.postDataJSON() as { x?: number; y?: number } | undefined;
    expect(updates).toEqual(expect.objectContaining({
      x: expect.any(Number),
      y: expect.any(Number),
    }));
    const targetModel = initialModel.diagram.usages.find((element) => element.id === 'process-work');
    expect(Math.abs((updates?.x ?? 0) - (targetModel?.x ?? 0))).toBeLessThanOrEqual(1);
    expect(screenOffset).toBeLessThanOrEqual(6);
    await expect(page.getByTestId('alignment-guide-vertical')).toHaveCount(0);
    await expect(page.getByTestId('alignment-guide-horizontal')).toHaveCount(0);
  };

  await page.waitForTimeout(400);
  const zoomIn = page.locator('.react-flow__controls-zoomin');
  for (let index = 0; index < 4 && await zoomIn.isEnabled(); index += 1) {
    await zoomIn.click();
  }
  await expect.poll(getZoom).toBeGreaterThan(1);
  await dragNearTargetAtCurrentZoom();

  const zoomOut = page.locator('.react-flow__controls-zoomout');
  for (let index = 0; index < 10 && await zoomOut.isEnabled(); index += 1) {
    await zoomOut.click();
  }
  await expect.poll(getZoom).toBeLessThan(0.5);
  await dragNearTargetAtCurrentZoom();

  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();
  expect(sourceBox).not.toBeNull();
  expect(targetBox).not.toBeNull();
  await page.mouse.move(sourceBox!.x + sourceBox!.width / 2, sourceBox!.y + sourceBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    targetBox!.x + targetBox!.width / 2 + 4,
    targetBox!.y + targetBox!.height / 2 + 4,
    { steps: 4 },
  );
  await expect(page.getByTestId('alignment-guide-vertical')).toHaveCount(1);
  await page.evaluate(() => {
    window.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true }));
  });
  await expect(page.getByTestId('alignment-guide-vertical')).toHaveCount(0);
  await expect(page.getByTestId('alignment-guide-horizontal')).toHaveCount(0);
});

test('persists a dragged node position through the model API', async ({ page }) => {
  const api = await openModel(page);
  const node = page.locator('.react-flow__node[data-id="process-work"]');
  const before = api.getModel().diagram.usages.find((element) => element.id === 'process-work');
  const nodeBox = await node.boundingBox();
  expect(nodeBox).not.toBeNull();

  const updateRequest = page.waitForRequest(
    (request) =>
      request.method() === 'PATCH' &&
      request.url().endsWith('/api/model/elements/process-work'),
  );
  const dragStart = { x: nodeBox!.x + 32, y: nodeBox!.y + 20 };
  await node.hover({ position: { x: 32, y: 20 } });
  await page.waitForTimeout(75);
  await page.mouse.down();
  await page.mouse.move(dragStart.x + 96, dragStart.y + 48, { steps: 16 });
  await page.mouse.up();

  const request = await updateRequest;
  const updates = request.postDataJSON() as { x?: number; y?: number };
  expect(updates.x).toEqual(expect.any(Number));
  expect(updates.y).toEqual(expect.any(Number));
  expect(updates.x).not.toBe(before?.x);
  expect(updates.y).not.toBe(before?.y);
  await expect.poll(() => api.requests.filter((candidate) => candidate.method() === 'PATCH').length).toBeGreaterThan(0);
  expect(api.requests.filter((candidate) => candidate.method() === 'PATCH').map((candidate) => candidate.postDataJSON())).toContainEqual(updates);

  await page.reload();
  await expect(page.getByTestId('node-ppr-process-work')).toBeVisible();
  expect(api.requests.filter((candidate) => candidate.method() === 'GET')).toHaveLength(2);
});

test('notifies and refreshes the model when an element update fails', async ({ page }) => {
  await openModel(page, initialModel, ['PATCH /api/model/elements/product-input']);

  await page.getByTestId('node-ppr-product-input').click();
  await page.locator('#name').fill('Rejected update');

  await expect(page.getByText('Could not save this element')).toBeVisible();
  await expect(page.getByTestId('node-ppr-product-input')).toBeVisible();

  await page.reload();
  await expect(page.getByTestId('node-ppr-product-input')).toBeVisible();
  await page.getByTestId('node-ppr-product-input').click();
  await expect(page.locator('#name')).toHaveValue('Input');
});

test('notifies and restores an element when its delete fails', async ({ page }) => {
  await openModel(page, initialModel, ['DELETE /api/model/elements/product-input']);

  await page.getByTestId('node-ppr-product-input').click();
  await page.keyboard.press('Delete');

  await expect(page.getByText('Could not delete this element')).toBeVisible();
  await expect(page.getByTestId('node-ppr-product-input')).toBeVisible();
});

test('notifies when creating an element fails', async ({ page }) => {
  await openModel(page, initialModel, ['POST /api/model/elements']);

  await page.getByTestId('library-asset-def-product-input').click();

  await expect(page.getByText('Could not create this element')).toBeVisible();
  await expect(page.getByTestId('node-ppr-product-input')).toBeVisible();
});

test('keeps the graph palette compact and browses the complete Library on demand', async ({ page }) => {
  await openModel(page);

  await expect(page.getByTestId('library-asset-def-product-input')).toBeVisible();
  await expect(page.getByTestId(/^library-asset-/)).toHaveCount(4);
  await expect(page.getByTestId('library-assets-dialog')).toHaveCount(0);

  await page.getByTestId('button-browse-library-assets').click();
  const browser = page.getByTestId('library-assets-dialog');
  await expect(browser).toBeVisible();
  await browser.getByLabel('Search reusable definitions').fill('Tool Definition');
  await expect(browser.getByTestId('library-browser-asset-def-resource-tool')).toBeVisible();
});

test('numbers repeated library instances instead of appending usage', async ({ page }) => {
  const api = await openModel(page);
  const asset = page.getByTestId('library-asset-def-product-input');

  const firstRequest = page.waitForRequest(
    (request) => request.method() === 'POST' && request.url().endsWith('/api/model/elements'),
  );
  await asset.click();
  expect((await firstRequest).postDataJSON()).toMatchObject({
    name: 'Input Definition 2',
    definition_id: 'def-product-input',
  });
  await expect.poll(() => api.getModel().diagram.usages.filter((usage) => usage.definition_id === 'def-product-input')).toHaveLength(2);

  const secondRequest = page.waitForRequest(
    (request) => request.method() === 'POST' && request.url().endsWith('/api/model/elements'),
  );
  await asset.click();
  expect((await secondRequest).postDataJSON()).toMatchObject({
    name: 'Input Definition 3',
    definition_id: 'def-product-input',
  });
  await expect.poll(() => api.getModel().diagram.usages.filter((usage) => usage.definition_id === 'def-product-input')).toHaveLength(3);
  expect(api.getModel().diagram.usages.at(-1)?.name).toBe('Input Definition 3');
});

test('creates and shows a standalone resource from the Resource palette button', async ({ page }) => {
  const api = await openModel(page);

  await page.getByTestId('add-standalone-resource').click();

  await expect.poll(() => api.getModel().diagram.usages.some((element) => element.id.startsWith('browser-element-'))).toBe(true);
  const createdNode = page.getByTestId(/^node-ppr-browser-element-/);
  await expect(createdNode).toBeVisible();
  await expect(createdNode).toContainText('resource');
  await expect(page.locator('#name')).toHaveValue('New Resource');
});

test('keeps creating usages after a created usage is auto-selected', async ({ page }) => {
  // Creating a usage selects it, which hands React Flow a fresh controlled
  // selection. React Flow then reports the previous selection one render later,
  // and echoing that report back used to make the two selections ping-pong until
  // React exceeded its update depth and the whole workspace fell into its error
  // boundary, taking every later palette click, drag and connection with it.
  const api = await openModel(page);

  await page.getByTestId('add-standalone-product').click();
  await expect(page.getByTestId('node-ppr-browser-element-1')).toBeVisible();
  await page.getByTestId('add-standalone-process').click();
  await expect(page.getByTestId('node-ppr-browser-element-2')).toBeVisible();
  await page.getByTestId('add-standalone-resource').click();
  await expect(page.getByTestId('node-ppr-browser-element-3')).toBeVisible();

  await expect(page.getByText('Something went wrong')).toHaveCount(0);
  await expect(page.getByTestId('ppr-flow-canvas')).toBeVisible();
  await expect(page.locator('#name')).toHaveValue('New Resource');
  expect(api.getModel().diagram.usages.filter((element) => element.id.startsWith('browser-element-'))).toHaveLength(3);

  // The canvas must still take gestures rather than sitting behind a crashed panel.
  await page.getByTestId('node-ppr-browser-element-2').click();
  await expect(page.locator('#name')).toHaveValue('New Process');
});

test('creates a standalone usage and can attach or clear its definition', async ({ page }) => {
  await openModel(page);

  const createRequest = page.waitForRequest(
    (request) => request.method() === 'POST' && request.url().endsWith('/api/model/elements'),
  );
  await page.getByTestId('add-standalone-product').click();
  const createdInput = (await createRequest).postDataJSON() as { type: string; definition_id: string | null };

  expect(createdInput).toMatchObject({ type: 'product', definition_id: null });
  await expect(page.getByTestId('node-ppr-browser-element-1')).toBeVisible();
  await expect(page.locator('#definition')).toBeVisible();
  await expect(page.locator('#name')).toHaveValue('New Product');
  const attachRequest = page.waitForRequest(
    (request) =>
      request.method() === 'PATCH' &&
      request.url().endsWith('/api/model/elements/browser-element-1'),
  );
  await page.locator('#definition').click();
  await page.getByRole('option', { name: 'Input Definition' }).click();
  expect((await attachRequest).postDataJSON()).toMatchObject({ definition_id: 'def-product-input' });
  await expect(page.getByText('This element is an instance of the selected reusable definition.')).toBeVisible();

  const clearRequest = page.waitForRequest(
    (request) =>
      request.method() === 'PATCH' &&
      request.url().endsWith('/api/model/elements/browser-element-1'),
  );
  await page.locator('#definition').click();
  await page.getByRole('option', { name: 'Standalone usage' }).click();
  expect((await clearRequest).postDataJSON()).toMatchObject({ definition_id: null });
  await expect(page.getByText('This usage is not assigned to a Library definition.')).toBeVisible();
});

test('creates lens-only detail and promotes it into the PPR diagram', async ({ page }) => {
  const api = await openModel(page);

  await page.getByTestId('button-view-product').click();
  await expect(page.getByTestId('add-standalone-product')).toBeVisible();
  await expect(page.getByTestId('add-standalone-process')).toHaveCount(0);
  await expect(page.getByTestId('add-standalone-resource')).toHaveCount(0);
  await page.getByTestId('button-browse-library-assets').click();
  await expect(page.getByTestId('library-browser-asset-def-product-input')).toBeVisible();
  await expect(page.getByTestId('library-browser-asset-def-process-work')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Open product Library' }).click();
  await expect(page.getByTestId('library-type-filter-product')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('library-type-section-product')).toBeVisible();
  await expect(page.getByTestId('library-type-section-process')).toHaveCount(0);
  await page.getByTestId('button-view-product').click();

  const createRequest = page.waitForRequest(
    (request) => request.method() === 'POST' && request.url().endsWith('/api/model/elements'),
  );
  await page.getByTestId('add-standalone-product').click();
  expect((await createRequest).postDataJSON()).toMatchObject({
    type: 'product',
    visible_in_ppr: false,
  });
  await expect(page.getByTestId('node-ppr-browser-element-1')).toHaveAttribute('data-ppr-visible', 'false');
  await expect(page.getByTestId('node-ppr-browser-element-1')).toContainText('View only');

  await page.getByTestId('button-view-graph').click();
  await expect(page.getByTestId('node-ppr-browser-element-1')).toHaveCount(0);
  await expect(page.getByTestId('button-toggle-ppr-visibility-browser-element-1')).toContainText('Include in PPR diagram');

  const promoteRequest = page.waitForRequest(
    (request) => request.method() === 'PATCH' && request.url().endsWith('/api/model/elements/browser-element-1'),
  );
  await page.getByTestId('button-toggle-ppr-visibility-browser-element-1').click();
  expect((await promoteRequest).postDataJSON()).toMatchObject({ visible_in_ppr: true });
  await expect(page.getByTestId('node-ppr-browser-element-1')).toBeVisible();
  expect(api.getModel().diagram.usages.find((element) => element.id === 'browser-element-1')?.visible_in_ppr).toBe(true);
});

test('creates the relationship native to an individual tree when connecting existing nodes', async ({ page }) => {
  const api = await openModel(page, createResourceTreeModel());
  await page.getByTestId('button-view-resource').click();

  const createRequest = page.waitForRequest(
    (request) => request.method() === 'POST' && request.url().endsWith('/api/model/relationships'),
  );
  await dragBetween(
    page,
    relationshipHandle(page, 'resource-cell', 'source', 'source-bottom'),
    relationshipHandle(page, 'resource-loose', 'target', 'target-top'),
  );

  expect((await createRequest).postDataJSON()).toMatchObject({
    source_id: 'resource-cell',
    target_id: 'resource-loose',
    kind: 'contains',
  });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect.poll(() => api.getModel().diagram.relationships.some((relationship) =>
    relationship.source_id === 'resource-cell'
    && relationship.target_id === 'resource-loose'
    && relationship.kind === 'contains',
  )).toBe(true);
});

test('extends an individual tree by dropping a handle on empty canvas', async ({ page }) => {
  const api = await openModel(page);
  await page.getByTestId('button-view-resource').click();

  const elementRequest = page.waitForRequest(
    (request) => request.method() === 'POST' && request.url().endsWith('/api/model/elements'),
  );
  const relationshipRequest = page.waitForRequest(
    (request) => request.method() === 'POST' && request.url().endsWith('/api/model/relationships'),
  );
  await dragToEmptyCanvas(
    page,
    relationshipHandle(page, 'resource-unassigned', 'source', 'source-bottom'),
  );

  expect((await elementRequest).postDataJSON()).toMatchObject({
    type: 'resource',
    visible_in_ppr: false,
  });
  expect((await relationshipRequest).postDataJSON()).toMatchObject({
    source_id: 'resource-unassigned',
    target_id: 'browser-element-1',
    kind: 'contains',
  });
  await expect(page.getByTestId('node-ppr-browser-element-1')).toBeVisible();
  expect(api.getModel().diagram.usages.find((element) => element.id === 'browser-element-1')?.visible_in_ppr).toBe(false);
});

test('creates a view-only follow-up process when its sequence handle is dropped on empty canvas', async ({ page }) => {
  const api = await openModel(page);
  await page.getByTestId('button-view-process-specification').click();

  const elementRequest = page.waitForRequest(
    (request) => request.method() === 'POST' && request.url().endsWith('/api/model/elements'),
  );
  const relationshipRequest = page.waitForRequest(
    (request) => request.method() === 'POST' && request.url().endsWith('/api/model/relationships'),
  );
  await dragToEmptyCanvas(
    page,
    relationshipHandle(page, 'process-work', 'source', 'source-bottom'),
  );

  expect((await elementRequest).postDataJSON()).toMatchObject({
    type: 'process',
    visible_in_ppr: false,
  });
  expect((await relationshipRequest).postDataJSON()).toMatchObject({
    source_id: 'process-work',
    target_id: 'browser-element-1',
    kind: 'succeeds',
  });
  await expect(page.getByTestId('node-ppr-browser-element-1')).toBeVisible();
  expect(api.getModel().diagram.usages.find((element) => element.id === 'browser-element-1')?.visible_in_ppr).toBe(false);
});

test('separates follow-up process creation from explicit subprocess nesting', async ({ page }) => {
  await page.addInitScript(() => {
    const runtimeWindow = window as Window & { __capturedRuntimeErrors?: string[] };
    runtimeWindow.__capturedRuntimeErrors = [];
    window.addEventListener('error', (event) => runtimeWindow.__capturedRuntimeErrors?.push(event.message));
  });
  await openModel(page);
  await page.getByTestId('button-view-process-specification').click();
  await page.waitForTimeout(650);

  const followupRequest = page.waitForRequest(
    (request) => request.method() === 'POST' && request.url().endsWith('/api/model/relationships'),
  );
  await dragBetween(
    page,
    relationshipHandle(page, 'process-work', 'source', 'source-bottom'),
    relationshipHandle(page, 'process-finish', 'target', 'target-top'),
  );
  expect((await followupRequest).postDataJSON()).toMatchObject({
    source_id: 'process-work',
    target_id: 'process-finish',
    kind: 'succeeds',
  });

  await page.getByTestId('node-ppr-process-work').click();
  const subprocessRequest = page.waitForRequest(
    (request) => request.method() === 'POST' && request.url().endsWith('/api/model/elements'),
  );
  const containmentRequest = page.waitForRequest(
    (request) => request.method() === 'POST' && request.url().endsWith('/api/model/relationships'),
  );
  await page.getByTestId('button-add-subprocess-process-work').click();

  expect((await subprocessRequest).postDataJSON()).toMatchObject({
    name: 'New subprocess',
    type: 'process',
    visible_in_ppr: false,
  });
  expect((await containmentRequest).postDataJSON()).toMatchObject({
    source_id: 'process-work',
    target_id: 'browser-element-1',
    kind: 'contains',
  });
  await expect(page.getByTestId('node-ppr-browser-element-1')).toHaveAttribute('data-process-parent-id', 'process-work');
  await page.waitForTimeout(300);
  await expect(page.getByRole('heading', { name: 'Something went wrong' })).toHaveCount(0);
  expect(await page.evaluate(() => (
    window as Window & { __capturedRuntimeErrors?: string[] }
  ).__capturedRuntimeErrors?.filter((message) => !message.startsWith('ResizeObserver loop')))).toEqual([]);
});

test('notifies when creating a relationship fails', async ({ page }) => {
  const api = await openModel(page, initialModel, ['POST /api/model/relationships']);

  await dragBetween(
    page,
    relationshipHandle(page, 'resource-tool', 'source', 'source-right'),
    relationshipHandle(page, 'process-finish', 'target', 'target-left'),
  );
  const createRequest = page.waitForRequest(
    (request) => request.method() === 'POST' && request.url().endsWith('/api/model/relationships'),
  );
  await page.getByRole('button', { name: 'Create Connection' }).click();
  await createRequest;

  await expect(page.getByText('Could not create this relationship')).toBeVisible();
  expect(api.requests.filter((request) => request.method() === 'POST')).toHaveLength(1);
});

test('notifies and restores a relationship when its delete fails', async ({ page }) => {
  await openModel(page, initialModel, ['DELETE /api/model/relationships/rel-input']);

  await page.getByTestId('rf__edge-rel-input').click();
  await page.getByRole('button', { name: 'Delete Relationship' }).click();

  await expect(page.getByText('Could not delete this relationship')).toBeVisible();
  await expect(page.getByTestId('edge-ppr-rel-input')).toBeVisible();
});

test('opens the relationship dialog for an unambiguous connection', async ({ page }) => {
  const api = await openModel(page);

  await dragBetween(
    page,
    relationshipHandle(page, 'product-orphan', 'source', 'source-bottom'),
    relationshipHandle(page, 'process-finish', 'target', 'target-top'),
  );

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('radio', { name: 'consumed_by' })).toBeVisible();
  const createRequest = page.waitForRequest(
    (request) => request.method() === 'POST' && request.url().endsWith('/api/model/relationships'),
  );
  await dialog.getByRole('button', { name: 'Create Connection' }).click();
  expect((await createRequest).postDataJSON()).toMatchObject({
    source_id: 'product-orphan',
    target_id: 'process-finish',
    kind: 'consumed_by',
  });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(api.requests.filter((request) => request.method() === 'POST')).toHaveLength(1);
});

test('opens the connection dialog for ambiguous relationship kinds and filters existing kinds', async ({ page }) => {
  const api = await openModel(page);

  await dragBetween(
    page,
    relationshipHandle(page, 'resource-tool', 'source', 'source-right'),
    relationshipHandle(page, 'process-finish', 'target', 'target-left'),
  );
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Create Relationship' })).toBeVisible();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Tool', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Finish', { exact: true })).toBeVisible();
  await expect(dialog.getByLabel('performs')).toBeVisible();
  await expect(dialog.getByLabel('modality')).toBeVisible();

  await dialog.getByLabel('modality').selectOption('supports');
  const createRequest = page.waitForRequest(
    (request) => request.method() === 'POST' && request.url().endsWith('/api/model/relationships'),
  );
  await dialog.getByRole('button', { name: 'Create Connection' }).click();
  expect((await createRequest).postDataJSON()).toMatchObject({
    source_id: 'resource-tool',
    target_id: 'process-finish',
    kind: 'performs',
    modality: 'supports',
  });
  await dragBetween(
    page,
    relationshipHandle(page, 'resource-tool', 'source', 'source-right'),
    relationshipHandle(page, 'process-finish', 'target', 'target-left'),
  );
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(api.requests.filter((request) => request.method() === 'POST')).toHaveLength(1);
});

test('keeps the inspector synchronized while selecting shared nodes across perspectives', async ({ page }) => {
  await openModel(page);

  await page.getByTestId('node-ppr-product-input').click();
  await expect(page.locator('#name')).toHaveValue('Input');

  await page.getByTestId('button-view-process-specification').click();
  await expect(page.locator('#name')).toHaveValue('Input');
  await page.getByTestId('node-ppr-process-work').click();
  await expect(page.getByTestId('button-view-process-specification')).toHaveAttribute('aria-pressed', 'true');

  await page.getByTestId('button-view-graph').click();
  await expect(page.getByTestId('node-ppr-process-work')).toBeVisible();
  await expect(page.locator('#name')).toHaveValue('Work');

  await page.getByTestId('node-ppr-product-input').click();
  await page.getByTestId('button-view-process-specification').click();
  await expect(page.locator('#name')).toHaveValue('Input');
  await page.getByTestId('button-view-graph').click();
  await expect(page.locator('#name')).toHaveValue('Input');
});

test('shows only operational sequence handles in the process view', async ({ page }) => {
  await openModel(page);

  await page.getByTestId('button-view-process-specification').click();
  await expect(page.getByTestId('ppr-flow-canvas')).toHaveAttribute('data-perspective', 'process');
  await expect(page.getByTestId('node-ppr-process-work')).toBeVisible();
  await expect(page.getByTestId('node-ppr-process-finish')).toBeVisible();
  await expect(page.getByTestId('node-ppr-product-input')).toHaveCount(0);
  await expect(page.getByTestId('node-ppr-product-output')).toHaveCount(0);
  await expect(page.getByTestId('node-ppr-resource-tool')).toHaveCount(0);
  await expect(page.getByTestId('node-ppr-product-orphan')).toHaveCount(0);
  await expect(relationshipHandle(page, 'process-work', 'source', 'source-bottom')).toHaveCount(1);
  await expect(relationshipHandle(page, 'process-work', 'source', 'source-right')).toHaveCount(0);
  await expect(page.getByTestId('edge-ppr-rel-input')).toHaveCount(0);
  await expect(page.getByTestId('edge-ppr-rel-performs')).toHaveCount(0);
  await expect(page.getByTestId('edge-ppr-process-flow-product-intermediate-process-work-process-finish')).toContainText('Intermediate');
});

test('makes inferred product flow labels explicit in the process perspective', async ({ page }) => {
  await openModel(page);

  await page.getByTestId('button-view-process-specification').click();
  const flowEdge = page.getByTestId('edge-ppr-process-flow-product-intermediate-process-work-process-finish');
  const productFlowLabel = page.getByTestId('product-flow-label-process-flow-product-intermediate-process-work-process-finish');

  await expect(flowEdge).toBeVisible();
  await expect(flowEdge).toHaveAttribute('aria-label', 'Product flow: Intermediate');
  await expect(productFlowLabel).toHaveText('Product flow');
  await expect(flowEdge).toHaveClass(/border-\[hsl\(var\(--ppr-product\)\)\]/);
  const labelZIndex = await flowEdge.evaluate((element) =>
    Number(getComputedStyle(element.parentElement!).zIndex),
  );
  const highestEdgeZIndex = await page.locator('.react-flow__edges svg').evaluateAll((elements) =>
    Math.max(...elements.map((element) => Number(getComputedStyle(element).zIndex) || 0)),
  );
  expect(labelZIndex).toBeGreaterThan(highestEdgeZIndex);
  await expect.poll(() => flowEdge.evaluate((element) => getComputedStyle(element).backgroundColor))
    .not.toBe('rgba(0, 0, 0, 0)');
});

test('exports the current process specification from the actions menu', async ({ page }) => {
  await openModel(page);

  await page.getByTestId('button-view-process-specification').click();
  await page.getByTestId('button-header-actions').click();
  await expect(page.getByTestId('menu-export-process-specification')).toBeVisible();
  await page.getByTestId('menu-export-process-specification').click();

  const exportDialog = page.getByTestId('process-specification-export');
  await expect(exportDialog).toBeVisible();
  await expect(exportDialog.getByTestId('process-specification-svg-preview').locator('svg')).toBeVisible();
  await expect(exportDialog.getByTestId('process-specification-svg-preview')).toContainText('Input');
  await expect(exportDialog.getByTestId('process-specification-svg-preview')).toContainText('Intermediate');
  await expect(exportDialog.getByTestId('process-specification-svg-preview')).toContainText('Output');
  await expect(exportDialog.getByTestId('process-specification-svg-preview')).toContainText('Orphan');

  const downloadPromise = page.waitForEvent('download');
  await exportDialog.getByTestId('button-download-process-specification').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('browser-interaction-fixture-process-specification.svg');
});

test('opens collaboration create and join controls', async ({ page }) => {
  await openModel(page);

  await page.getByTestId('button-collaboration').click();
  const dialog = page.getByTestId('collaboration-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Create session' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Join session' }).click();
  await expect(dialog.getByLabel('Your display name')).toBeVisible();
  await expect(dialog.getByLabel('Session ID')).toBeVisible();
  await expect(dialog.getByLabel('Access code')).toBeVisible();
  await expect(dialog.getByTestId('button-collaboration-submit')).toBeDisabled();
});

test('requires authenticated identities and isolates collaboration membership in browsers', async ({ page, browser }) => {
  const callApi = async (target: Page, path: string, init: { method?: string; headers?: Record<string, string>; body?: unknown } = {}) =>
    target.evaluate(async ({ nextPath, nextInit }) => {
      const response = await fetch(nextPath, {
        method: nextInit.method,
        headers: {
          ...(nextInit.body === undefined ? {} : { 'content-type': 'application/json' }),
          ...nextInit.headers,
        },
        body: nextInit.body === undefined ? undefined : JSON.stringify(nextInit.body),
      });
      const raw = await response.text();
      return { status: response.status, body: raw ? JSON.parse(raw) as Record<string, unknown> : null };
    }, { nextPath: path, nextInit: init });

  await page.goto('/');
  const anonymous = await browser.newContext();
  const anonymousPage = await anonymous.newPage();
  await anonymousPage.goto('/');
  await anonymous.clearCookies();
  expect((await callApi(anonymousPage, '/api/collaboration/sessions', { method: 'POST' })).status).toBe(401);

  await callApi(page, '/api/auth/session');
  const created = await callApi(page, '/api/collaboration/sessions', { method: 'POST' });
  expect(created.status).toBe(200);
  const ownerSession = created.body as { session_id: string; code: string; member_token: string };

  const member = await browser.newContext();
  const memberPage = await member.newPage();
  await memberPage.goto('/');
  await callApi(memberPage, '/api/auth/session');
  const joined = await callApi(memberPage, '/api/collaboration/join', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: { session_id: ownerSession.session_id, code: ownerSession.code },
  });
  expect(joined.status).toBe(200);
  const memberSession = joined.body as { session_id: string; member_token: string };

  const ownerHeaders = {
    'x-collaboration-session': ownerSession.session_id,
    'x-collaboration-token': ownerSession.member_token,
  };
  const memberHeaders = {
    'x-collaboration-session': memberSession.session_id,
    'x-collaboration-token': memberSession.member_token,
  };
  expect((await callApi(memberPage, '/api/model', {
    headers: { 'x-collaboration-session': ownerSession.session_id, 'x-collaboration-code': ownerSession.code },
  })).status).toBe(403);
  expect((await callApi(memberPage, '/api/model', { headers: memberHeaders })).status).toBe(200);
  expect((await callApi(memberPage, `/api/collaboration/sessions/${ownerSession.session_id}/close`, {
    method: 'POST',
    headers: memberHeaders,
    body: {},
  })).status).toBe(403);
  expect((await callApi(page, `/api/collaboration/sessions/${ownerSession.session_id}/close`, {
    method: 'POST',
    headers: ownerHeaders,
    body: {},
  })).status).toBe(204);
  expect((await callApi(memberPage, '/api/model', { headers: memberHeaders })).status).toBe(403);

  await anonymous.close();
  await member.close();
});

test('enters the graph after starting a collaboration session', async ({ page }) => {
  await openModel(page);
  await page.route('**/api/collaboration/sessions', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        session_id: 'browser-session',
        code: '123456',
        owner_token: 'browser-owner',
        expires_at: '2099-09-03T14:00:00Z',
      }),
    });
  });

  await page.getByTestId('button-collaboration').click();
  const dialog = page.getByTestId('collaboration-dialog');
  await dialog.getByLabel('Your display name').fill('Graph owner');
  await dialog.getByTestId('button-collaboration-submit').click();
  await expect(dialog.getByTestId('button-start-modeling')).toBeVisible();
  await dialog.getByTestId('button-start-modeling').click();

  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('ppr-flow-canvas')).toBeVisible();
  await expect(page.getByTestId('button-view-graph')).toHaveAttribute('aria-pressed', 'true');
});

test('keeps collaborator presence stable and renders remote cursor updates', async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem('ppr-collaboration-session', JSON.stringify({
      sessionId: 'stable-presence-session',
      code: '123456',
      ownerToken: 'browser-owner',
      expiresAt: '2099-09-03T18:00:00Z',
      displayName: 'Graph owner',
    }));
  });

  let connectionCount = 0;
  let sendRemoteCursor: ((x: number, y: number) => void) | undefined;
  await page.routeWebSocket('**/api/collaboration/ws/**', (socket) => {
    connectionCount += 1;
    sendRemoteCursor = (x, y) => socket.send(JSON.stringify({
      type: 'cursor.updated',
      participantId: 'remote-editor',
      cursor: { x, y },
    }));
    socket.onMessage((rawMessage) => {
      const message = JSON.parse(String(rawMessage)) as { type?: string };
      if (message.type === 'ping') socket.send(JSON.stringify({ type: 'pong' }));
    });
    socket.send(JSON.stringify({
      type: 'session.ready',
      participantId: 'graph-owner',
      revision: 0,
      model: initialModel,
      participants: [
        { id: 'graph-owner', name: 'Graph owner' },
        { id: 'remote-editor', name: 'Remote editor', cursor: { x: 240, y: 120 } },
      ],
    }));
  });

  await openModel(page);
  await expect(page.getByTestId('button-collaboration')).toContainText('2 online');
  const remoteCursor = page.getByTestId('remote-cursor-remote-editor');
  await expect(remoteCursor).toBeVisible();
  await expect(remoteCursor).toContainText('Remote editor');

  sendRemoteCursor?.(360, 210);
  await expect(remoteCursor).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 360, 210)');

  await page.getByTestId('node-ppr-product-input').click();
  await page.waitForTimeout(1_000);
  expect(connectionCount).toBe(1);
  await expect(page.getByTestId('button-collaboration')).toContainText('2 online');
  await expect(remoteCursor).toBeVisible();
});

test('saves one shared checkpoint after cross-view collaboration reconnects', async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem('ppr-collaboration-session', JSON.stringify({
      sessionId: 'cross-view-save-session',
      code: '123456',
      ownerToken: 'browser-owner',
      expiresAt: '2099-09-03T18:00:00Z',
      displayName: 'Workspace owner',
    }));
  });

  let connectionCount = 0;
  let collaborationRevision = 0;
  let collaborationModel = copyModel();
  let droppedFirstUpdate = false;
  await page.routeWebSocket('**/api/collaboration/ws/**', (socket) => {
    connectionCount += 1;
    socket.onMessage((rawMessage) => {
      const message = JSON.parse(String(rawMessage)) as {
        type?: string;
        model?: PprModel;
        clientUpdateId?: string;
      };
      if (message.type === 'ping') {
        socket.send(JSON.stringify({ type: 'pong' }));
        return;
      }
      if (message.type === 'model.update' && message.model) {
        collaborationModel = copyModel(message.model);
        collaborationRevision += 1;
        if (!droppedFirstUpdate) {
          droppedFirstUpdate = true;
          socket.close();
          return;
        }
        socket.send(JSON.stringify({
          type: 'model.ack',
          revision: collaborationRevision,
          clientUpdateId: message.clientUpdateId,
        }));
      }
    });
    socket.send(JSON.stringify({
      type: 'session.ready',
      participantId: 'workspace-owner',
      revision: collaborationRevision,
      model: collaborationModel,
      participants: [
        { id: 'workspace-owner', name: 'Workspace owner' },
        { id: 'remote-reviewer', name: 'Remote reviewer', surface: 'product' },
      ],
    }));
  });

  const api = await openModel(page);
  await expect(page.getByTestId('button-collaboration')).toContainText('2 online');

  const renameRequest = page.waitForRequest(
    (request) =>
      request.method() === 'PUT' &&
      new URL(request.url()).pathname === '/api/model' &&
      new URL(request.url()).searchParams.get('checkpoint') === 'false',
  );
  await page.getByTestId('model-name-input').fill('Cross-view production review');
  await page.getByTestId('model-name-input').blur();
  await renameRequest;

  await expect.poll(() => connectionCount).toBe(2);
  await expect(page.getByTestId('collaboration-sync-status')).toHaveCount(0);
  await expect(page.getByTestId('button-collaboration')).toContainText('2 online');

  // Perspective projections and the Library surface are ephemeral UI state.
  // They should not produce model requests or alter the model sent by Save.
  const modelRequestCountBeforeViews = api.requests.filter(
    (request) => request.method() === 'PUT' || request.method() === 'PATCH',
  ).length;
  await page.getByTestId('button-view-process-specification').click();
  await expect(page.getByTestId('ppr-flow-canvas')).toHaveAttribute('data-perspective', 'process');
  await expect(page.getByTestId('node-ppr-process-work')).toBeVisible();
  await expect(page.getByTestId('node-ppr-product-input')).toHaveCount(0);
  await page.getByTestId('button-view-product').click();
  await expect(page.getByTestId('ppr-flow-canvas')).toHaveAttribute('data-perspective', 'product');
  await expect(page.getByTestId('node-ppr-product-input')).toBeVisible();
  await expect(page.getByTestId('node-ppr-process-work')).toHaveCount(0);
  await page.getByTestId('button-view-resource').click();
  await expect(page.getByTestId('ppr-flow-canvas')).toHaveAttribute('data-perspective', 'resource');
  await expect(page.getByTestId('node-ppr-resource-tool')).toBeVisible();
  await expect(page.getByTestId('node-ppr-product-input')).toHaveCount(0);
  await page.getByTestId('button-view-library').click();
  await expect(page.getByTestId('ppr-library-view')).toBeVisible();
  await page.getByTestId('button-view-graph').click();
  await expect.poll(() => api.requests.filter(
    (request) => request.method() === 'PUT' || request.method() === 'PATCH',
  ).length).toBe(modelRequestCountBeforeViews);

  const saveRequests: PlaywrightRequest[] = [];
  const saveRequestListener = (request: PlaywrightRequest) => {
    if (
      request.method() === 'PUT' &&
      new URL(request.url()).pathname === '/api/model' &&
      new URL(request.url()).searchParams.get('checkpoint') === 'true'
    ) {
      saveRequests.push(request);
    }
  };
  page.on('request', saveRequestListener);
  await page.getByTestId('button-save-model').click();
  await expect.poll(() => saveRequests.length).toBe(1);
  const savedPayload = saveRequests[0].postDataJSON() as Record<string, unknown>;
  expect(savedPayload.name).toBe('Cross-view production review');
  expect(savedPayload).not.toHaveProperty('surface');
  expect(savedPayload).not.toHaveProperty('filter');

  await page.getByTestId('button-revision-history').click();
  const historyDialog = page.getByTestId('dialog-revision-history');
  await expect(historyDialog.locator('[data-testid^="revision-row-"]')).toHaveCount(3);
  await expect(historyDialog.getByTestId('revision-row-browser-revision-3')).toBeVisible();
  await expect(historyDialog.getByText('Current', { exact: true })).toHaveCount(1);
  await page.keyboard.press('Escape');

  await page.getByTestId('button-save-model').click();
  await expect.poll(() => saveRequests.length).toBe(2);
  await page.getByTestId('button-revision-history').click();
  await expect(historyDialog.locator('[data-testid^="revision-row-"]')).toHaveCount(3);
  await expect(historyDialog.getByTestId('revision-row-browser-revision-3')).toBeVisible();
  await page.keyboard.press('Escape');
  page.off('request', saveRequestListener);
});

test('broadcasts every REST model mutation to a second browser context', async ({ browser }) => {
  const ownerContext = await browser.newContext();
  const reviewerContext = await browser.newContext();
  const owner = await ownerContext.newPage();
  const reviewer = await reviewerContext.newPage();

  await reviewer.addInitScript(() => {
    const nativeWebSocket = window.WebSocket;
    const messages: unknown[] = [];
    const trackedWebSocket = function (this: WebSocket, ...args: ConstructorParameters<typeof WebSocket>) {
      const socket = new nativeWebSocket(...args);
      socket.addEventListener('message', (event) => {
        try {
          messages.push(JSON.parse(String(event.data)));
        } catch {
          // Ignore non-JSON protocol messages.
        }
      });
      return socket;
    } as unknown as typeof WebSocket;
    trackedWebSocket.prototype = nativeWebSocket.prototype;
    for (const key of ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'] as const) {
      Object.defineProperty(trackedWebSocket, key, { value: nativeWebSocket[key] });
    }
    window.WebSocket = trackedWebSocket;
    Object.defineProperty(window, '__pprCollaborationMessages', {
      configurable: true,
      value: messages,
    });
  });

   type CollaborationCredentials = { session_id: string; code: string; member_token?: string };
  type RestResponse<T> = { status: number; body: T };

  const rest = async <T>(
    page: Page,
    credentials: CollaborationCredentials,
    path: string,
    method: string,
    body?: unknown,
    contentType = 'application/json',
  ): Promise<RestResponse<T>> => page.evaluate(
    async ({ credentials: nextCredentials, path: nextPath, method: nextMethod, body: nextBody, contentType: nextContentType }) => {
      const response = await fetch(nextPath, {
        method: nextMethod,
        headers: {
          'content-type': nextContentType,
          'x-collaboration-session': nextCredentials.session_id,
         ...(nextCredentials.member_token
           ? { 'x-collaboration-token': nextCredentials.member_token }
           : { 'x-collaboration-code': nextCredentials.code }),
        },
        body: nextBody === undefined
          ? undefined
          : nextContentType === 'application/json' ? JSON.stringify(nextBody) : String(nextBody),
      });
      const raw = await response.text();
      return { status: response.status, body: raw ? JSON.parse(raw) : null };
    },
    { credentials, path, method, body, contentType },
  ) as Promise<RestResponse<T>>;

  const getCollaborativeModel = async (page: Page, credentials: CollaborationCredentials) => (
    await rest<PprModel>(page, credentials, '/api/model', 'GET')
  ).body;

  const assertReviewerReceived = async (expected: PprModel) => {
    await expect.poll(
      () => reviewer.evaluate((candidate) => {
        const messages = (window as Window & { __pprCollaborationMessages?: Array<{ type?: string; model?: PprModel }> })
          .__pprCollaborationMessages ?? [];
        return messages.some((message) =>
          message.type === 'model.updated' && JSON.stringify(message.model) === JSON.stringify(candidate),
        );
      }, expected),
      { message: 'the second browser should receive the canonical REST mutation' },
    ).toBe(true);
  };

  try {
     await owner.goto('/');
     await owner.evaluate(async () => {
       const response = await fetch('/api/auth/session');
       if (!response.ok) throw new Error('Could not establish the owner identity');
     });
    const session = await owner.evaluate(async () => (
      await (await fetch('/api/collaboration/sessions', { method: 'POST' })).json()
     )) as CollaborationCredentials & { owner_token: string; member_token: string; expires_at: string };
     const ownerCredentials = { session_id: session.session_id, code: session.code, member_token: session.member_token };
    const sessionStorageValue = {
      sessionId: session.session_id,
      code: session.code,
      memberToken: session.member_token,
      role: 'owner',
      ownerToken: session.owner_token,
      expiresAt: session.expires_at,
      displayName: 'REST owner',
    };
    await owner.evaluate((value) => {
      sessionStorage.setItem('ppr-collaboration-session', JSON.stringify(value));
    }, sessionStorageValue);
    await owner.reload();

    await reviewer.goto('/');
    await reviewer.evaluate(async () => {
      const response = await fetch('/api/auth/session');
      if (!response.ok) throw new Error('Could not establish the reviewer identity');
    });
    const reviewerMembership = await reviewer.evaluate(async (credentials) => {
      const response = await fetch('/api/collaboration/join', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ session_id: credentials.session_id, code: credentials.code }),
      });
      if (!response.ok) throw new Error('Could not join the reviewer membership');
      return await response.json() as { member_token: string; role: 'editor' };
    }, { session_id: session.session_id, code: session.code });
    await reviewer.evaluate((value) => {
      sessionStorage.setItem('ppr-collaboration-session', JSON.stringify(value));
    }, {
      ...sessionStorageValue,
      memberToken: reviewerMembership.member_token,
      ownerToken: undefined,
      role: reviewerMembership.role,
      displayName: 'REST reviewer',
    });
    await reviewer.reload();
    await expect(owner.getByTestId('button-collaboration')).toContainText('2 online');
    await expect(reviewer.getByTestId('button-collaboration')).toContainText('2 online');

    const createdElement = await rest<PprModel['diagram']['usages'][number]>(
      owner,
      ownerCredentials,
      '/api/model/elements',
      'POST',
      { name: 'REST broadcast usage', type: 'product' },
    );
    expect(createdElement.status).toBe(201);
    const afterElement = await getCollaborativeModel(owner, ownerCredentials);
    await assertReviewerReceived(afterElement);
    await expect(reviewer.getByTestId(`node-ppr-${createdElement.body.id}`)).toBeVisible();

    const createdDefinition = await rest<PprModel['library']['definitions'][number]>(
      owner,
      ownerCredentials,
      '/api/model/definitions',
      'POST',
      { name: 'REST broadcast definition', type: 'resource' },
    );
    expect(createdDefinition.status).toBe(201);
    await assertReviewerReceived(await getCollaborativeModel(owner, ownerCredentials));

    const beforeMerge = await getCollaborativeModel(owner, ownerCredentials);
    const [first, second] = beforeMerge.diagram.usages.filter((usage) => usage.type === 'product');
    const merged = await rest<PprModel>(
      owner,
      ownerCredentials,
      '/api/model/merge',
      'POST',
      {
        first_id: first.id,
        second_id: second.id,
        survivor_id: first.id,
        name_source: 'first',
        description_source: 'first',
        definition_source: 'first',
        self_loop_policy: 'drop',
      },
    );
    expect(merged.status).toBe(200);
    await assertReviewerReceived(merged.body);

    const imported = await rest<PprModel>(
      owner,
      ownerCredentials,
      '/api/model/import/sysml',
      'POST',
      `library package PPR {
    abstract item def Product;
    abstract action def Process;
    abstract part def Resource;
}
package <rest_import_model> 'REST import model' {
    private import PPR::*;
    item def <rest_import_product> 'Imported product' :> Product;
}`,
      'text/plain',
    );
    expect(imported.status).toBe(200);
    await assertReviewerReceived(imported.body);

    const loadedExample = await rest<PprModel>(
      owner,
      ownerCredentials,
      '/api/model/example',
      'POST',
    );
    expect(loadedExample.status).toBe(200);
    await assertReviewerReceived(loadedExample.body);

    const reset = await rest<PprModel>(owner, ownerCredentials, '/api/model/reset', 'POST');
    expect(reset.status).toBe(200);
    await assertReviewerReceived(reset.body);
  } finally {
    await ownerContext.close();
    await reviewerContext.close();
  }
});

test('converges two browser collaborators after a reconnect and one saved checkpoint', async ({ browser }) => {
  test.slow();
  const ownerContext = await browser.newContext();
  const reviewerContext = await browser.newContext();
  const owner = await ownerContext.newPage();
  const reviewer = await reviewerContext.newPage();

  await owner.addInitScript(() => {
    const nativeWebSocket = window.WebSocket;
    const sockets: WebSocket[] = [];
    const trackedWebSocket = function (this: WebSocket, ...args: ConstructorParameters<typeof WebSocket>) {
      const socket = new nativeWebSocket(...args);
      sockets.push(socket);
      return socket;
    } as unknown as typeof WebSocket;
    trackedWebSocket.prototype = nativeWebSocket.prototype;
    for (const key of ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'] as const) {
      Object.defineProperty(trackedWebSocket, key, { value: nativeWebSocket[key] });
    }
    window.WebSocket = trackedWebSocket;
    Object.defineProperty(window, '__pprCollaborationSockets', {
      configurable: true,
      value: sockets,
    });
  });

  try {
    await owner.goto('/');
    await expect(owner.getByTestId('button-save-model')).toBeVisible();
    await owner.getByTestId('button-collaboration').click();
    const ownerDialog = owner.getByTestId('collaboration-dialog');
    await ownerDialog.getByLabel('Your display name').fill('Owner');
    await ownerDialog.getByTestId('button-collaboration-submit').click();
    await expect(ownerDialog.getByTestId('collaboration-session-id')).toHaveValue(/\S+/);
    await expect(ownerDialog.getByTestId('collaboration-access-code')).toHaveValue(/\d{6}/);

    const sessionId = await ownerDialog.getByTestId('collaboration-session-id').inputValue();
    const accessCode = await ownerDialog.getByTestId('collaboration-access-code').inputValue();
    await ownerDialog.getByTestId('button-start-modeling').click();
    await expect(owner.getByTestId('button-collaboration')).toContainText('1 online');

    await reviewer.goto('/');
    await expect(reviewer.getByTestId('button-save-model')).toBeVisible();
    await reviewer.getByTestId('button-collaboration').click();
    const reviewerDialog = reviewer.getByTestId('collaboration-dialog');
    await reviewerDialog.getByRole('button', { name: 'Join session' }).click();
    await reviewerDialog.getByLabel('Your display name').fill('Reviewer');
    await reviewerDialog.getByLabel('Session ID').fill(sessionId);
    await reviewerDialog.getByLabel('Access code').fill(accessCode);
    await reviewerDialog.getByTestId('button-collaboration-submit').click();
    await expect(reviewerDialog).toContainText('People online');
    await reviewerDialog.getByTestId('button-start-modeling').click();
    await expect(reviewer.getByTestId('button-collaboration')).toContainText('2 online');

    await owner.getByTestId('button-collaboration').click();
    await expect(owner.getByTestId('collaboration-dialog')).toContainText('Reviewer');
    await owner.getByTestId('collaboration-dialog').getByRole('button', { name: 'Start modeling' }).click();

    await owner.getByTestId('button-view-product').click();
    await owner.getByTestId('node-ppr-use_positioned_panel_assembly').click();
    const bomEdgeId = 'bom-use_fixture_components-use_positioned_panel_assembly-use_body_side_panel';
    await expect(owner.getByTestId(`product-state-sidebar`)).toBeVisible();
    await owner.getByTestId(`button-product-bom-edit-${bomEdgeId}`).click();
    await owner.getByTestId(`product-bom-quantity-input-${bomEdgeId}`).fill('7');
    await owner.getByTestId(`product-bom-unit-input-${bomEdgeId}`).fill('kg');
    await owner.getByTestId(`button-product-bom-save-${bomEdgeId}`).click();
    await expect(owner.getByTestId(`product-bom-quantity-${bomEdgeId}`)).toContainText('7 kg');

    await expect.poll(
      () => reviewer.getByTestId('node-ppr-use_positioned_panel_assembly').count(),
      { message: 'the reviewer should receive the shared model update' },
    ).toBe(1);
    await reviewer.getByTestId('button-view-product').click();
    await reviewer.getByTestId('node-ppr-use_positioned_panel_assembly').click();
    await expect.poll(
      () => reviewer.getByTestId(`product-bom-quantity-${bomEdgeId}`).textContent(),
      { message: 'the reviewer should observe the live quantity update' },
    ).toContain('7 kg');

    await owner.evaluate(() => {
      const sockets = (window as Window & { __pprCollaborationSockets?: WebSocket[] }).__pprCollaborationSockets ?? [];
      const socket = sockets.at(-1);
      if (!socket) throw new Error('No collaboration socket was captured');
      socket.close();
    });
    await expect.poll(
      () => owner.evaluate(() => (
        window as Window & { __pprCollaborationSockets?: WebSocket[] }
      ).__pprCollaborationSockets?.filter((socket) => socket.readyState === 1).length ?? 0),
      { timeout: 10_000, message: 'the owner should reconnect its collaboration socket' },
    ).toBe(1);

    await owner.getByTestId('button-save-model').click();
    await expect(owner.getByText('Model saved successfully', { exact: true })).toBeVisible();
    await expect.poll(
      () => reviewer.getByTestId(`product-bom-quantity-${bomEdgeId}`).textContent(),
      { message: 'the reviewer should retain the saved shared model' },
    ).toContain('7 kg');

    await expect(owner.getByTestId('button-product-view-ppr')).toHaveAttribute('aria-pressed', 'true');
    await expect(reviewer.getByTestId('button-product-view-ppr')).toHaveAttribute('aria-pressed', 'true');
    await owner.getByTestId('button-product-view-bom').click();
    await expect(owner.getByTestId('button-product-view-bom')).toHaveAttribute('aria-pressed', 'true');
    await expect(reviewer.getByTestId('button-product-view-ppr')).toHaveAttribute('aria-pressed', 'true');

    for (const page of [owner, reviewer]) {
      await page.getByTestId('button-revision-history').click();
      const history = page.getByTestId('dialog-revision-history');
      await expect(history.locator('[data-testid^="revision-row-"]')).toHaveCount(2);
      await expect(history.getByText('Saved model snapshot', { exact: true })).toHaveCount(1);
      await page.keyboard.press('Escape');
    }

    await owner.getByTestId('button-view-graph').click();
    await expect(owner.getByTestId('ppr-flow-canvas')).toHaveAttribute('data-perspective', 'ppr');
    await expect(reviewer.getByTestId('ppr-flow-canvas')).toHaveAttribute('data-perspective', 'product');
  } finally {
    await reviewerContext.close();
    await ownerContext.close();
  }
});

test('uses the nested process structure as the single working process view', async ({ page }) => {
  const sourceModel = copyModel(initialModel);
  sourceModel.diagram.usages.push(
    bomElement('process-sub-step', 'Sub weld', 'process'),
    bomElement('process-sub-step-2', 'Sub inspect', 'process'),
    bomElement('process-parallel', 'Parallel inspection', 'process'),
    bomElement('product-parallel-input', 'Inspection sample', 'product'),
    bomElement('product-parallel-output', 'Inspected sample', 'product'),
  );
  sourceModel.diagram.relationships.push(
    { id: 'rel-work-sub-step', source_id: 'process-work', target_id: 'process-sub-step', kind: 'contains' },
    { id: 'rel-work-sub-step-2', source_id: 'process-work', target_id: 'process-sub-step-2', kind: 'contains' },
    { id: 'rel-sub-step-sequence', source_id: 'process-sub-step', target_id: 'process-sub-step-2', kind: 'succeeds' },
    { id: 'rel-parallel-input', source_id: 'product-parallel-input', target_id: 'process-parallel', kind: 'consumed_by' },
    { id: 'rel-parallel-output', source_id: 'process-parallel', target_id: 'product-parallel-output', kind: 'produces' },
  );
  const api = await openModel(page, sourceModel);
  const relationshipCount = api.getModel().diagram.relationships.length;

  await page.getByTestId('button-view-process-specification').click();
  await expect(page.getByTestId('node-ppr-process-sub-step')).toBeVisible();
  await expect(page.getByTestId('node-ppr-process-sub-step-2')).toBeVisible();
  await expect(page.getByTestId('node-ppr-process-parallel')).toBeVisible();
  await expect(page.getByTestId('node-ppr-product-parallel-input')).toHaveCount(0);
  await expect(page.getByTestId('node-ppr-product-parallel-output')).toHaveCount(0);
  await expect(page.getByTestId('process-view-mode-switcher')).toHaveCount(0);
  await expect(page.getByTestId('graph-perspective-title')).toContainText('Nested process flow');
  await expect(page.getByTestId('node-ppr-process-work')).toHaveAttribute('data-process-container', 'true');
  await expect(page.getByTestId('node-ppr-process-sub-step')).toHaveAttribute('data-process-parent-id', 'process-work');
  await expect(page.getByTestId('node-ppr-process-sub-step-2')).toHaveAttribute('data-process-parent-id', 'process-work');
  await expect(page.getByTestId('edge-ppr-rel-work-sub-step')).toHaveCount(0);
  await expect(page.getByTestId('edge-ppr-rel-work-sub-step-2')).toHaveCount(0);
  await expect(page.getByTestId('edge-ppr-rel-sub-step-sequence')).toBeVisible();
  await expect(page.getByTestId('edge-ppr-process-flow-product-intermediate-process-work-process-finish')).toBeVisible();

  await page.waitForTimeout(650);
  const firstSubprocessBox = await page.getByTestId('node-ppr-process-sub-step').boundingBox();
  const secondSubprocessBox = await page.getByTestId('node-ppr-process-sub-step-2').boundingBox();
  expect(firstSubprocessBox && secondSubprocessBox).toBeTruthy();
  expect(firstSubprocessBox!.x).toBeCloseTo(secondSubprocessBox!.x, 0);
  expect(firstSubprocessBox!.y).toBeLessThan(secondSubprocessBox!.y);

  await page.getByTestId('node-ppr-process-sub-step').click();
  await expect(page.locator('#name')).toHaveValue('Sub weld');
  expect(api.getModel().diagram.relationships).toHaveLength(relationshipCount);

});

test('shows product flow from producing to consuming processes and keeps orphan products explicit', async ({ page }) => {
  await openModel(page);

  await page.getByTestId('button-view-product').click();
  await expect(page.getByTestId('ppr-flow-canvas')).toHaveAttribute('data-perspective', 'product');
  await expect(page.getByTestId('node-ppr-process-work')).toHaveCount(0);

  await page.getByTestId('node-ppr-product-intermediate').click();
  await expect(page.getByTestId('product-state-sidebar')).toContainText('Intermediate state');
  await expect(page.getByTestId('product-state-sidebar')).toContainText('Work');
  await expect(page.getByTestId('product-state-sidebar')).toContainText('Finish');

  await page.getByTestId('node-ppr-product-orphan').click();
  await expect(page.getByTestId('product-state-sidebar')).toContainText('Standalone product');
  await expect(page.getByTestId('product-state-sidebar')).toContainText('No producing process');
  await expect(page.getByTestId('product-state-sidebar')).toContainText('No consuming process');
});

test('switches Product view between PPR-derived flow and explicit Gozinto assembly', async ({ page }) => {
  const sourceModel = createBomModel();
  sourceModel.diagram.relationships.push(
    { id: 'rel-product-state', source_id: 'product-input', target_id: 'product-intermediate', kind: 'becomes' },
    { id: 'rel-product-assembly', source_id: 'product-output', target_id: 'product-input', kind: 'contains' },
  );
  await openModel(page, sourceModel);

  await page.getByTestId('button-view-product').click();
  await expect(page.getByTestId('button-product-view-ppr')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('identity-rail-rel-product-state')).toBeVisible();
  await expect(page.getByTestId('edge-ppr-rel-product-state')).toHaveCount(0);
  await expect(page.getByTestId('edge-ppr-rel-product-assembly')).toHaveCount(0);
  await expect(page.getByTestId('graph-perspective-title')).toContainText('PPR-derived product flow');

  await page.getByTestId('button-product-view-bom').click();
  await expect(page.getByTestId('button-product-view-bom')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('identity-rail-rel-product-state')).toHaveCount(0);
  await expect(page.getByTestId('edge-ppr-rel-product-assembly')).toContainText('Assembly');
  await expect(page.getByTestId('graph-perspective-title')).toContainText('Gozinto BOM');

  await page.getByTestId('rf__edge-rel-product-assembly').click();
  await expect(page.getByText('Relationship Selected')).toBeVisible();
  await expect(page.getByText('contains', { exact: true })).toBeVisible();
});

test('renders a flow-derived Product BOM with branches, shared inputs, and cycle guards', async ({ page }) => {
  const sourceModel = createBomModel();
  const api = await openModel(page, sourceModel);
  const relationshipCount = api.getModel().diagram.relationships.length;

  await page.getByTestId('button-view-product').click();
  await expect(page.getByTestId('node-ppr-product-output')).toHaveCount(1);
  await expect(page.getByTestId('node-ppr-product-intermediate')).toHaveCount(1);
  await expect(page.getByTestId('node-ppr-product-input')).toHaveCount(1);
  await expect(page.getByTestId('node-ppr-product-cycle-a')).toHaveCount(1);
  await expect(page.getByTestId('node-ppr-product-cycle-b')).toHaveCount(1);
  await expect(page.getByTestId('edge-ppr-bom-process-branch-product-output-product-input')).toContainText('Built by Branch Assembly');
  await expect(page.getByTestId('edge-ppr-bom-process-cycle-a-product-cycle-b-product-cycle-a')).toBeVisible();

  await page.getByTestId('node-ppr-product-input').click();
  await expect(page.locator('#name')).toHaveValue('Input');
  expect(api.getModel().diagram.relationships).toHaveLength(relationshipCount);
});

test('shows populated, mixed-unit, and unspecified input quantities in the BOM', async ({ page }) => {
  await openModel(page, createBomModel());

  await page.getByTestId('button-view-product').click();
  await page.getByTestId('node-ppr-product-intermediate').click();
  await expect(page.getByTestId('product-bom-quantity-bom-process-work-product-intermediate-product-input')).toHaveText('3 kg');
  await page.getByTestId('node-ppr-product-output').click();
  await expect(page.getByTestId('product-bom-quantity-bom-process-finish-product-output-product-intermediate')).toHaveText('2 m');
  await expect(page.getByTestId('product-bom-quantity-bom-process-branch-product-output-product-input')).toHaveText('Unspecified');
});

test('edits, clears, and rejects invalid BOM input quantities without leaving the product review', async ({ page }) => {
  const api = await openModel(page, createBomModel());
  await page.getByTestId('button-view-product').click();
  await page.getByTestId('node-ppr-product-intermediate').click();

  const edgeId = 'bom-process-work-product-intermediate-product-input';
  const quantity = page.getByTestId(`product-bom-quantity-${edgeId}`);
  const editor = page.getByTestId(`product-bom-quantity-editor-${edgeId}`);
  await editor.getByTestId(`button-product-bom-edit-${edgeId}`).click();
  await editor.getByTestId(`product-bom-quantity-input-${edgeId}`).fill('4.5');
  await editor.getByTestId(`product-bom-unit-input-${edgeId}`).fill('kg');
  await editor.getByTestId(`button-product-bom-save-${edgeId}`).click();

  await expect(quantity).toHaveText('4.5 kg');
  expect(api.requests.filter((request) => request.method() === 'PATCH')).toHaveLength(1);
  expect(api.getModel().diagram.relationships.find((relationship) => relationship.id === 'rel-input')).toMatchObject({
    quantity: 4.5,
    unit: 'kg',
  });

  await editor.getByTestId(`button-product-bom-edit-${edgeId}`).click();
  await editor.getByTestId(`product-bom-quantity-input-${edgeId}`).fill('');
  await editor.getByTestId(`button-product-bom-save-${edgeId}`).click();
  await expect(quantity).toHaveText('Unspecified kg');
  expect(api.getModel().diagram.relationships.find((relationship) => relationship.id === 'rel-input')?.quantity).toBeNull();

  await editor.getByTestId(`button-product-bom-edit-${edgeId}`).click();
  await editor.getByTestId(`product-bom-quantity-input-${edgeId}`).fill('-1');
  await editor.getByTestId(`button-product-bom-save-${edgeId}`).click();
  await expect(editor.getByTestId(`product-bom-quantity-error-${edgeId}`)).toHaveText(
    'Enter a number greater than or equal to 0, or leave it blank.',
  );
  expect(api.requests.filter((request) => request.method() === 'PATCH')).toHaveLength(2);
  expect(api.getModel().diagram.relationships.find((relationship) => relationship.id === 'rel-input')?.quantity).toBeNull();

  await page.reload();
  await page.getByTestId('button-view-product').click();
  await page.getByTestId('node-ppr-product-intermediate').click();
  await expect(page.getByTestId(`product-bom-quantity-${edgeId}`)).toHaveText('Unspecified kg');
});

test('shows resource allocation with shared assignments and an unassigned resource', async ({ page }) => {
  await openModel(page);

  await page.getByTestId('button-view-resource').click();
  await expect(page.getByTestId('ppr-flow-canvas')).toHaveAttribute('data-perspective', 'resource');
  await page.getByTestId('node-ppr-resource-shared').click();
  await expect(page.getByTestId('resource-context-sidebar')).toContainText('Work');
  await expect(page.getByTestId('resource-context-sidebar')).toContainText('Finish');

  await page.getByTestId('node-ppr-resource-unassigned').click();
  await expect(page.getByTestId('resource-context-sidebar')).toContainText('No performing assignment');
  await expect(page.getByTestId('resource-context-sidebar')).toContainText('No supporting assignment');
});

test('shows linked resource roots and expands explicit capability branches into the graph', async ({ page }) => {
  const sourceModel = createResourceTreeModel();
  const api = await openModel(page, sourceModel);
  const relationshipCount = api.getModel().diagram.relationships.length;

  await expect(page.getByTestId('node-ppr-resource-cell')).toBeVisible();
  await expect(page.getByTestId('node-ppr-resource-tool')).toBeVisible();
  await expect(page.getByTestId('node-ppr-resource-shared')).toBeVisible();
  await expect(page.getByTestId('node-ppr-resource-inspection')).toBeVisible();
  await expect(page.getByTestId('node-ppr-resource-loose')).toBeVisible();

  await page.getByTestId('button-view-resource').click();
  await expect(page.getByTestId('node-ppr-resource-cell')).toBeVisible();
  await expect(page.getByTestId('node-ppr-resource-tool')).toBeVisible();
  await expect(page.getByTestId('node-ppr-resource-inspection')).toBeVisible();
  await expect(page.getByTestId('node-ppr-resource-cycle-a')).toHaveCount(1);
  await expect(page.getByTestId('node-ppr-resource-cycle-b')).toHaveCount(1);
  await expect(page.getByTestId('edge-ppr-rel-cell-tool')).toContainText('Contains');
  await page.waitForTimeout(650);
  const cellBox = await page.getByTestId('node-ppr-resource-cell').boundingBox();
  const toolBox = await page.getByTestId('node-ppr-resource-tool').boundingBox();
  expect(cellBox && toolBox).toBeTruthy();
  expect(cellBox!.y).toBeLessThan(toolBox!.y);

  await page.getByTestId('rf__edge-rel-cell-tool').click();
  await expect(page.getByText('Relationship Selected')).toBeVisible();
  await expect(page.getByText('contains', { exact: true })).toBeVisible();
  expect(api.getModel().diagram.relationships).toHaveLength(relationshipCount);
});

test('switches the resource hierarchy between explicit contains edges and nested subresources', async ({ page }) => {
  const api = await openModel(page, createResourceTreeModel());
  const relationshipCount = api.getModel().diagram.relationships.length;

  await page.getByTestId('button-view-resource').click();
  await expect(page.getByTestId('button-resource-view-contains')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('edge-ppr-rel-cell-tool')).toContainText('Contains');

  await page.getByTestId('button-resource-view-nested').click();
  await expect(page.getByTestId('button-resource-view-nested')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('graph-perspective-title')).toContainText('Nested resource structure');
  await expect(page.getByTestId('node-ppr-resource-cell')).toHaveAttribute('data-resource-container', 'true');
  await expect(page.getByTestId('node-ppr-resource-tool')).toHaveAttribute('data-resource-parent-id', 'resource-cell');
  await expect(page.getByTestId('edge-ppr-rel-cell-tool')).toHaveCount(0);

  await page.getByTestId('button-resource-view-contains').click();
  await expect(page.getByTestId('edge-ppr-rel-cell-tool')).toContainText('Contains');
  await expect(page.getByTestId('node-ppr-resource-tool')).not.toHaveAttribute('data-resource-parent-id');
  expect(api.getModel().diagram.relationships).toHaveLength(relationshipCount);
});

test('creates and persists a resource capability assignment', async ({ page }) => {
  const api = await openModel(page);

  await dragBetween(
    page,
    relationshipHandle(page, 'resource-tool', 'source', 'source-right'),
    relationshipHandle(page, 'process-finish', 'target', 'target-left'),
  );
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByLabel('modality').selectOption('supports');
  const createRequest = page.waitForRequest(
    (request) => request.method() === 'POST' && request.url().endsWith('/api/model/relationships'),
  );
  await page.getByRole('button', { name: 'Create Connection' }).click();
  await createRequest;
  expect(api.getModel().diagram.relationships.some((relationship) =>
    relationship.source_id === 'resource-tool' &&
    relationship.target_id === 'process-finish' &&
    relationship.kind === 'performs' && relationship.modality === 'supports',
  )).toBe(true);

  await page.reload();
  await page.getByTestId('button-view-resource').click();
  await page.getByTestId('node-ppr-resource-tool').click();
  await expect(page.getByTestId('resource-context-sidebar')).toContainText('Finish');
});

test('shows only the handles and relations relevant to each perspective', async ({ page }) => {
  await openModel(page);

  await page.getByTestId('button-view-process-specification').click();
  await expect(relationshipHandle(page, 'process-work', 'source', 'source-bottom')).toHaveCount(1);
  await expect(relationshipHandle(page, 'process-work', 'source', 'source-right')).toHaveCount(0);
  await expect(page.getByTestId('node-ppr-product-intermediate')).toHaveCount(0);
  await expect(page.getByTestId('node-ppr-resource-tool')).toHaveCount(0);
  await expect(page.getByTestId('edge-ppr-rel-performs')).toHaveCount(0);
  await expect(page.getByTestId('edge-ppr-process-flow-product-intermediate-process-work-process-finish')).toBeVisible();

  await page.getByTestId('button-view-product').click();
  await expect(relationshipHandle(page, 'product-output', 'source', 'source-bottom')).toHaveCount(1);
  await expect(relationshipHandle(page, 'product-output', 'source', 'source-right')).toHaveCount(0);
  await expect(page.getByTestId('edge-ppr-rel-performs')).toHaveCount(0);
  await expect(page.getByTestId('edge-ppr-bom-process-finish-product-output-product-intermediate')).toBeVisible();

  await page.getByTestId('button-view-resource').click();
  await expect(relationshipHandle(page, 'resource-tool', 'source', 'source-bottom')).toHaveCount(1);
  await expect(relationshipHandle(page, 'resource-tool', 'source', 'source-right')).toHaveCount(0);
  await expect(page.getByTestId('edge-ppr-rel-performs')).toHaveCount(0);
});

test('switches across all three analysis perspectives without losing the selected inspector element', async ({ page }) => {
  await openModel(page);

  await page.getByTestId('button-view-process-specification').click();
  await page.getByTestId('node-ppr-process-work').click();
  await expect(page.locator('#name')).toHaveValue('Work');

  await page.getByTestId('button-view-product').click();
  await expect(page.getByTestId('ppr-flow-canvas')).toHaveAttribute('data-perspective', 'product');
  await expect(page.locator('#name')).toHaveValue('Work');
  await page.getByTestId('node-ppr-product-output').click();
  await expect(page.locator('#name')).toHaveValue('Output');

  await page.getByTestId('button-view-resource').click();
  await expect(page.getByTestId('ppr-flow-canvas')).toHaveAttribute('data-perspective', 'resource');
  await expect(page.locator('#name')).toHaveValue('Output');
  await page.getByTestId('node-ppr-resource-tool').click();
  await expect(page.locator('#name')).toHaveValue('Tool');

  await page.getByTestId('button-view-graph').click();
  await expect(page.getByTestId('node-ppr-resource-tool')).toBeVisible();
  await expect(page.locator('#name')).toHaveValue('Tool');
});

test('traces a selected process through graph perspectives and sidebar context', async ({ page }) => {
  await page.addInitScript(() => {
    const runtimeWindow = window as Window & { __capturedRuntimeErrors?: Array<{ message: string; stack?: string }> };
    runtimeWindow.__capturedRuntimeErrors = [];
    window.addEventListener('error', (event) => {
      runtimeWindow.__capturedRuntimeErrors?.push({
        message: event.message,
        stack: event.error instanceof Error ? event.error.stack : undefined,
      });
    });
  });
  await openModel(page);

  await page.getByTestId('node-ppr-process-work').click();
  await expect(page.getByTestId('node-ppr-process-work')).toHaveClass(/ring-ring/);

  await page.getByTestId('button-view-process-specification').click();
  await expect(page.getByTestId('node-ppr-process-work')).toHaveClass(/ring-ring/);
  await expect(page.getByTestId('process-context-sidebar')).toContainText('Input');
  await expect(page.getByTestId('process-context-sidebar')).toContainText('Intermediate');
  await expect(page.getByTestId('process-context-sidebar')).toContainText('Tool');

  await page.getByTestId('button-view-product').click();
  await expect(page.getByTestId('node-ppr-process-work')).toHaveCount(0);
  await expect(page.locator('#name')).toHaveValue('Work');
  await page.waitForTimeout(650);
  expect(await page.evaluate(() => (
    window as Window & { __capturedRuntimeErrors?: Array<{ message: string; stack?: string }> }
  ).__capturedRuntimeErrors)).toEqual([]);

  await page.getByTestId('button-view-process-specification').click();
  await expect(page.getByTestId('node-ppr-process-work')).toHaveClass(/ring-ring/);
});

test('keeps diagram selection shared when visiting the Library and restores it on return', async ({ page }) => {
  await openModel(page);

  await page.getByTestId('node-ppr-product-input').click();
  await expect(page.locator('#name')).toHaveValue('Input');

  await page.getByTestId('button-view-library').click();
  await expect(page.getByTestId('ppr-library-view')).toBeVisible();
  await expect(page.getByTestId('button-view-library')).toHaveAttribute('aria-pressed', 'true');

  await page.getByTestId('button-view-graph').click();
  await expect(page.getByTestId('node-ppr-product-input')).toHaveClass(/ring-ring/);
  await expect(page.locator('#name')).toHaveValue('Input');
});

test('shows a recoverable error state instead of a blank workspace when the model cannot load', async ({ page }) => {
  await installModelApi(page, initialModel, ['GET /api/model']);
  await page.goto('/');

  const errorState = page.getByTestId('workspace-error-state');
  await expect(errorState).toBeVisible();
  await expect(errorState).toContainText('Could not load the model');
  await expect(errorState.getByTestId('button-retry-model')).toBeVisible();
});

test('keeps Save feedback pending until the shared model request completes', async ({ page }) => {
  const api = await openModel(page);
  let releaseSave: (() => void) | undefined;
  const saveReleased = new Promise<void>((resolve) => {
    releaseSave = resolve;
  });
  await page.route('**/api/model?checkpoint=true', async (route) => {
    await saveReleased;
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(api.getModel()) });
  });

  const saveButton = page.getByTestId('button-save-model');
  await saveButton.click();
  await expect(saveButton).toHaveAttribute('aria-busy', 'true');
  await expect(page.getByText('Model saved successfully', { exact: true })).toHaveCount(0);

  releaseSave?.();
  await expect(saveButton).toHaveAttribute('aria-busy', 'false');
  await expect(page.getByText('Model saved successfully', { exact: true })).toBeVisible();
});

test('uses the same explicit empty-state contract when a perspective has no matching elements', async ({ page }) => {
  const processOnlyModel = copyModel(initialModel);
  processOnlyModel.diagram.usages = processOnlyModel.diagram.usages.filter((element) => element.type === 'process');
  processOnlyModel.diagram.relationships = [];
  await openModel(page, processOnlyModel);

  await page.getByTestId('button-view-product').click();
  await expect(page.getByTestId('empty-product-perspective')).toBeVisible();
  await expect(page.getByTestId('empty-product-perspective')).toContainText('No product elements in this view');
  await expect(page.getByTestId('button-view-process-specification')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByTestId('node-ppr-process-work')).toHaveCount(0);
});

test('keeps dense graphs usable while zooming, selecting, and moving nodes', async ({ page }) => {
  const api = await openModel(page, createLargeModel());
  await expect(page.getByTestId('graph-performance-mode')).toBeVisible();

  const canvas = page.getByTestId('ppr-flow-canvas');
  const canvasBox = await canvas.boundingBox();
  expect(canvasBox).not.toBeNull();
  await page.mouse.move(canvasBox!.x + canvasBox!.width / 2, canvasBox!.y + canvasBox!.height / 2);
  await page.mouse.wheel(0, 420);
  await page.mouse.wheel(0, -280);

  const node = page.getByTestId('node-ppr-large-usage-0');
  await expect(node).toBeVisible();
  await node.click();
  await expect(page.locator('#name')).toHaveValue('Large model usage 0');

  const nodeBox = await node.boundingBox();
  expect(nodeBox).not.toBeNull();
  const updateRequest = page.waitForRequest(
    (request) =>
      request.method() === 'PATCH' &&
      request.url().endsWith('/api/model/elements/large-usage-0'),
  );
  await page.mouse.move(nodeBox!.x + nodeBox!.width / 2, nodeBox!.y + nodeBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(nodeBox!.x + nodeBox!.width / 2 + 48, nodeBox!.y + nodeBox!.height / 2 + 24, { steps: 6 });
  await page.mouse.up();
  await updateRequest;

  await expect.poll(() => api.requests.filter((request) => request.method() === 'PATCH').length).toBe(1);
});

test('supports narrow desktop viewport behavior', async ({ page }) => {
  const viewport = page.viewportSize();
  expect(viewport).toMatchObject({ width: 900, height: 800 });

  const api = await openModel(page);
  const canvas = page.getByTestId('ppr-flow-canvas');
  await expect(canvas).toBeVisible();
  await expect(page.getByTestId('button-view-graph')).toBeVisible();
  await expect(page.getByTestId('button-view-process-specification')).toBeVisible();
  await expect(page.getByTestId('button-view-product')).toBeVisible();
  await expect(page.getByTestId('button-view-resource')).toBeVisible();
  await expect(page.getByTestId('button-view-library')).toBeVisible();
  await expect(page.getByTestId('button-collaboration')).toBeVisible();
  await expect(page.getByTestId('button-project-file')).toBeVisible();
  await expect(page.getByTestId('button-header-actions')).toBeVisible();

  const node = page.getByTestId('node-ppr-product-input');
  await node.click();
  await expect(node).toHaveClass(/ring-2/);

  const nodeBox = await node.boundingBox();
  expect(nodeBox).not.toBeNull();
  const updateRequest = page.waitForRequest(
    (request) =>
      request.method() === 'PATCH' &&
      request.url().endsWith('/api/model/elements/product-input'),
  );
  await page.mouse.move(nodeBox!.x + nodeBox!.width / 2, nodeBox!.y + nodeBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(nodeBox!.x + nodeBox!.width / 2 + 36, nodeBox!.y + nodeBox!.height / 2 + 18, { steps: 5 });
  await page.mouse.up();
  await updateRequest;

  await page.getByTestId('button-view-process-specification').click();
  await expect(canvas).toHaveAttribute('data-perspective', 'process');
  await page.getByTestId('button-view-product').click();
  await expect(canvas).toHaveAttribute('data-perspective', 'product');
  await page.getByTestId('button-view-resource').click();
  await expect(canvas).toHaveAttribute('data-perspective', 'resource');
  await page.getByTestId('button-view-library').click();
  await expect(page.getByTestId('ppr-library-view')).toBeVisible();
  await page.getByTestId('button-view-graph').click();
  await expect(canvas).toHaveAttribute('data-perspective', 'ppr');

  await page.getByTestId('button-aml-export').click();
  await expect(page.getByTestId('model-export')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('model-export')).toBeHidden();

  await page.getByTestId('button-header-actions').click();
  await expect(page.getByTestId('menu-import-exchange-file')).toBeVisible();
  await page.keyboard.press('Escape');

  await page.getByTestId('button-collaboration').click();
  const collaborationDialog = page.getByTestId('collaboration-dialog');
  await expect(collaborationDialog).toBeVisible();
  await expect(collaborationDialog.getByRole('button', { name: 'Create session' })).toBeVisible();
  await collaborationDialog.getByRole('button', { name: 'Join session' }).click();
  await expect(collaborationDialog.getByLabel('Session ID')).toBeVisible();

  const documentWidth = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
  }));
  expect(documentWidth.documentWidth).toBeLessThanOrEqual(documentWidth.viewportWidth);
  await expect.poll(() => api.requests.filter((request) => request.method() === 'PATCH').length).toBe(1);
});

test('supports portable browser graph editing and review flows', async ({ page }) => {
  const api = await openModel(page);
  const canvas = page.getByTestId('ppr-flow-canvas');
  await expect(canvas).toBeVisible();

  const node = page.getByTestId('node-ppr-product-input');
  await node.click();
  await expect(node).toHaveClass(/ring-2/);

  const nodeBox = await node.boundingBox();
  expect(nodeBox).not.toBeNull();
  const updateRequest = page.waitForRequest(
    (request) =>
      request.method() === 'PATCH' &&
      request.url().endsWith('/api/model/elements/product-input'),
  );
  await page.mouse.move(nodeBox!.x + nodeBox!.width / 2, nodeBox!.y + nodeBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(nodeBox!.x + nodeBox!.width / 2 + 36, nodeBox!.y + nodeBox!.height / 2 + 18, { steps: 5 });
  await page.mouse.up();
  await updateRequest;

  for (const [button, perspective] of [
    ['button-view-process-specification', 'process'],
    ['button-view-product', 'product'],
    ['button-view-resource', 'resource'],
  ] as const) {
    await page.getByTestId(button).click();
    await expect(canvas).toHaveAttribute('data-perspective', perspective);
  }

  await page.getByTestId('button-view-library').click();
  await expect(page.getByTestId('ppr-library-view')).toBeVisible();
  await page.getByTestId('button-view-graph').click();
  await expect(canvas).toHaveAttribute('data-perspective', 'ppr');

  await page.getByTestId('button-aml-export').click();
  await expect(page.getByTestId('model-export')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('model-export')).toBeHidden();

  await page.getByTestId('button-header-actions').click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('menu-import-exchange-file').click();
  await (await chooser).setFiles({
    name: 'body-side.aml',
    mimeType: 'application/xml',
    buffer: Buffer.from('<?xml version="1.0"?><CAEXFile />'),
  });
  await expect(page.getByTestId('model-name-input')).toHaveValue('Body-Side Spot-Welding Cell');
  await expect(page.locator('[data-testid^="node-ppr-"]').first()).toBeVisible();

  await page.getByTestId('button-collaboration').click();
  const collaborationDialog = page.getByTestId('collaboration-dialog');
  await expect(collaborationDialog).toBeVisible();
  await expect(collaborationDialog.getByRole('button', { name: 'Create session' })).toBeVisible();
  await collaborationDialog.getByRole('button', { name: 'Join session' }).click();
  await expect(collaborationDialog.getByLabel('Session ID')).toBeVisible();

  await expect.poll(() => api.requests.filter((request) => request.method() === 'PATCH').length).toBe(1);
});
