import type { PprElement, PprModel, PprRelationship } from '@workspace/api-client-react';
import { getModelRelationships, getModelUsages, getProductBom, getResourceTree } from '../review/analysis-utils';
import type { PprNodePosition } from './ppr-flow-adapter';

export type PprCanvasPerspective = 'ppr' | 'levels' | 'process' | 'product' | 'resource';
export type PprProductViewMode = 'ppr' | 'bom';
export type PprResourceViewMode = 'contains' | 'nested';
export type PprCanvasLayoutKey =
  | 'ppr'
  | 'process'
  | `levels:${number}`
  | `product:${PprProductViewMode}`
  | `resource:${PprResourceViewMode}`;
export type PprCanvasLayoutPositions = Record<string, PprNodePosition>;
export type PprCanvasLayouts = Partial<Record<PprCanvasLayoutKey, PprCanvasLayoutPositions>>;
export const PPR_LEVELS = [0, 1, 2, 3] as const;

export function getPprCanvasLayoutKey(
  perspective: PprCanvasPerspective,
  productViewMode: PprProductViewMode = 'ppr',
  pprLevel = 0,
  resourceViewMode: PprResourceViewMode = 'contains',
): PprCanvasLayoutKey {
  if (perspective === 'product') return `product:${productViewMode}`;
  if (perspective === 'resource') return `resource:${resourceViewMode}`;
  if (perspective === 'levels') return `levels:${Math.max(0, Math.floor(pprLevel))}`;
  return perspective;
}

export type DerivedPerspectiveEdge = {
  label: string;
  relatedElementId?: string;
};

export type PprPerspectiveProjection = {
  model: PprModel;
  derivedEdges: Map<string, DerivedPerspectiveEdge>;
  parentByElementId?: Map<string, string>;
  containerDimensions?: Map<string, { width: number; height: number }>;
  containerKinds?: Map<string, 'process' | 'resource'>;
  maxLevel?: number;
};

export const PPR_PERSPECTIVE_COPY: Record<PprCanvasPerspective, {
  eyebrow: string;
  title: string;
  description: string;
}> = {
  ppr: {
    eyebrow: 'PPR model',
    title: 'Process · Product · Resource',
    description: 'Canonical editable graph',
  },
  process: {
    eyebrow: 'Process view',
    title: 'Nested process flow',
    description: 'Process sequences stay visible while explicitly assigned subprocesses are nested',
  },
  levels: {
    eyebrow: 'PPR Levels',
    title: 'Layered engineering view',
    description: 'Read-only structure from product flow through process and resource containment',
  },
  product: {
    eyebrow: 'Product view',
    title: 'Product hierarchy',
    description: 'Compare PPR-derived product flow with explicit assembly structure',
  },
  resource: {
    eyebrow: 'Resource view',
    title: 'Resource hierarchy',
    description: 'Explicit contains and composed-of relationships',
  },
};

const HIERARCHY_START_Y = 80;
const HIERARCHY_GAP_X = 320;
const HIERARCHY_GAP_Y = 210;

function compareElements(left: PprElement, right: PprElement) {
  return left.id.localeCompare(right.id) || left.name.localeCompare(right.name);
}

function getAxisCenter(values: number[]) {
  if (values.length === 0) return null;
  return (Math.min(...values) + Math.max(...values)) / 2;
}

/**
 * Keep a derived layout centered where its nodes already live in the canonical
 * graph. Perspective changes then mainly reshape the graph instead of first
 * moving it to the layout origin and making the camera chase it.
 */
function alignToCanonicalCenter(
  elements: PprElement[],
  positions: Map<string, PprNodePosition>,
): Map<string, PprNodePosition> {
  const positionedElements = elements.filter((element) => positions.has(element.id));
  const canonicalCenterX = getAxisCenter(
    positionedElements.map((element) => element.x).filter(Number.isFinite),
  );
  const canonicalCenterY = getAxisCenter(
    positionedElements.map((element) => element.y).filter(Number.isFinite),
  );
  const projectedPositions = positionedElements
    .map((element) => positions.get(element.id))
    .filter((position): position is PprNodePosition => Boolean(position));
  const projectedCenterX = getAxisCenter(projectedPositions.map((position) => position.x));
  const projectedCenterY = getAxisCenter(projectedPositions.map((position) => position.y));

  if (
    canonicalCenterX === null
    || canonicalCenterY === null
    || projectedCenterX === null
    || projectedCenterY === null
  ) return positions;

  const offsetX = canonicalCenterX - projectedCenterX;
  const offsetY = canonicalCenterY - projectedCenterY;
  return new Map(
    [...positions].map(([id, position]) => [id, {
      x: position.x + offsetX,
      y: position.y + offsetY,
    }]),
  );
}

/**
 * Lay out a possibly shared or cyclic hierarchy without duplicating nodes.
 * Roots are always rank zero, which makes terminal products move to the top
 * when entering the product perspective.
 */
function getHierarchyPositions(
  elements: PprElement[],
  rootIds: string[],
  childIdsByParentId: Map<string, string[]>,
): Map<string, PprNodePosition> {
  const elementIds = new Set(elements.map((element) => element.id));
  const rankById = new Map<string, number>();
  const queue = rootIds
    .filter((id) => elementIds.has(id))
    .sort()
    .map((id) => ({ id, rank: 0 }));

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    const previousRank = rankById.get(current.id);
    if (previousRank !== undefined && previousRank <= current.rank) continue;
    rankById.set(current.id, current.rank);
    (childIdsByParentId.get(current.id) ?? [])
      .filter((id) => elementIds.has(id))
      .slice()
      .sort()
      .forEach((id) => queue.push({ id, rank: current.rank + 1 }));
  }

  // A hierarchy made entirely from a cycle has no natural root. Give each
  // unranked component a deterministic root so every element remains visible.
  elements.slice().sort(compareElements).forEach((element) => {
    if (rankById.has(element.id)) return;
    const componentQueue = [{ id: element.id, rank: 0 }];
    while (componentQueue.length > 0) {
      const current = componentQueue.shift();
      if (!current || rankById.has(current.id)) continue;
      rankById.set(current.id, current.rank);
      (childIdsByParentId.get(current.id) ?? [])
        .filter((id) => elementIds.has(id) && !rankById.has(id))
        .slice()
        .sort()
        .forEach((id) => componentQueue.push({ id, rank: current.rank + 1 }));
    }
  });

  const elementsByRank = new Map<number, PprElement[]>();
  elements.forEach((element) => {
    const rank = rankById.get(element.id) ?? 0;
    const row = elementsByRank.get(rank) ?? [];
    row.push(element);
    elementsByRank.set(rank, row);
  });

  const positions = new Map<string, PprNodePosition>();
  elementsByRank.forEach((row, rank) => {
    row.sort(compareElements);
    const center = (row.length - 1) / 2;
    row.forEach((element, index) => {
      positions.set(element.id, {
        x: (index - center) * HIERARCHY_GAP_X,
        y: HIERARCHY_START_Y + rank * HIERARCHY_GAP_Y,
      });
    });
  });
  return alignToCanonicalCenter(elements, positions);
}

function withPositions(elements: PprElement[], positions: Map<string, PprNodePosition>) {
  return elements.map((element) => ({
    ...element,
    ...(positions.get(element.id) ?? { x: element.x, y: element.y }),
  }));
}

const NESTED_PROCESS_PADDING = 24;
const NESTED_PROCESS_HEADER_HEIGHT = 78;
const NESTED_PROCESS_FIRST_CHILD_GAP = 72;
const NESTED_PROCESS_GAP_Y = 48;
const NESTED_PROCESS_LEAF_WIDTH = 240;
const NESTED_PROCESS_LEAF_HEIGHT = 120;
const LEVEL_PRODUCT_COLUMN_X = 60;
const LEVEL_PROCESS_COLUMN_X = 620;
const LEVEL_RESOURCE_COLUMN_X = 1150;
const LEVEL_PROCESS_GAP_Y = 144;

type NestedProcessLayout = {
  positions: Map<string, PprNodePosition>;
  parentByElementId: Map<string, string>;
  containerDimensions: Map<string, { width: number; height: number }>;
};

function getNestedProcessLayout(
  processes: PprElement[],
  processRelationships: PprRelationship[],
  flatPositions: Map<string, PprNodePosition>,
  gapY = NESTED_PROCESS_GAP_Y,
): NestedProcessLayout {
  const processIds = new Set(processes.map((process) => process.id));
  const parentByElementId = new Map<string, string>();
  const sortedContainment = processRelationships
    .filter((relationship) =>
      relationship.kind === 'contains'
      && processIds.has(relationship.source_id)
      && processIds.has(relationship.target_id),
    )
    .slice()
    .sort((left, right) =>
      left.source_id.localeCompare(right.source_id)
      || left.target_id.localeCompare(right.target_id)
      || left.id.localeCompare(right.id),
    );

  const createsCycle = (parentId: string, childId: string) => {
    let currentId: string | undefined = parentId;
    const visited = new Set<string>();
    while (currentId && !visited.has(currentId)) {
      if (currentId === childId) return true;
      visited.add(currentId);
      currentId = parentByElementId.get(currentId);
    }
    return false;
  };

  sortedContainment.forEach((relationship) => {
    if (
      parentByElementId.has(relationship.target_id)
      || createsCycle(relationship.source_id, relationship.target_id)
    ) return;
    parentByElementId.set(relationship.target_id, relationship.source_id);
  });

  const childrenByParentId = new Map<string, string[]>();
  parentByElementId.forEach((parentId, childId) => {
    const children = childrenByParentId.get(parentId) ?? [];
    children.push(childId);
    childrenByParentId.set(parentId, children);
  });
  childrenByParentId.forEach((children) => children.sort());

  const orderedChildrenByParentId = new Map<string, string[]>();
  childrenByParentId.forEach((children, parentId) => {
    const childIds = new Set(children);
    const targetsByChildId = new Map(children.map((childId) => [childId, new Set<string>()]));
    const indegreeByChildId = new Map(children.map((childId) => [childId, 0]));
    processRelationships.forEach((relationship) => {
      if (
        relationship.kind !== 'succeeds'
      ) return;
      if (!childIds.has(relationship.source_id) || !childIds.has(relationship.target_id)) return;
      const targets = targetsByChildId.get(relationship.source_id);
      if (!targets || targets.has(relationship.target_id)) return;
      targets.add(relationship.target_id);
      indegreeByChildId.set(
        relationship.target_id,
        (indegreeByChildId.get(relationship.target_id) ?? 0) + 1,
      );
    });

    const available = children.filter((childId) => indegreeByChildId.get(childId) === 0).sort();
    const ordered: string[] = [];
    while (available.length > 0) {
      const childId = available.shift();
      if (!childId) break;
      ordered.push(childId);
      [...(targetsByChildId.get(childId) ?? [])].sort().forEach((targetId) => {
        const nextIndegree = (indegreeByChildId.get(targetId) ?? 0) - 1;
        indegreeByChildId.set(targetId, nextIndegree);
        if (nextIndegree === 0) {
          available.push(targetId);
          available.sort();
        }
      });
    }
    // Cyclic subprocesses still remain visible in a stable vertical order.
    children.filter((childId) => !ordered.includes(childId)).sort().forEach((childId) => ordered.push(childId));
    orderedChildrenByParentId.set(parentId, ordered);
  });

  const dimensions = new Map<string, { width: number; height: number }>();
  const visiting = new Set<string>();
  const getDimensions = (processId: string): { width: number; height: number } => {
    const cached = dimensions.get(processId);
    if (cached) return cached;
    if (visiting.has(processId)) {
      return { width: NESTED_PROCESS_LEAF_WIDTH, height: NESTED_PROCESS_LEAF_HEIGHT };
    }
    visiting.add(processId);
    const children = orderedChildrenByParentId.get(processId) ?? [];
    if (children.length === 0) {
      const leaf = { width: NESTED_PROCESS_LEAF_WIDTH, height: NESTED_PROCESS_LEAF_HEIGHT };
      dimensions.set(processId, leaf);
      visiting.delete(processId);
      return leaf;
    }

    const childDimensions = children.map((childId) => getDimensions(childId));
    const childrenWidth = Math.max(...childDimensions.map((child) => child.width));
    const childrenHeight = childDimensions.reduce((total, child) => total + child.height, 0)
      + Math.max(0, childDimensions.length - 1) * gapY;
    const group = {
      width: Math.max(
        NESTED_PROCESS_LEAF_WIDTH,
        NESTED_PROCESS_PADDING * 2 + childrenWidth,
      ),
      height: NESTED_PROCESS_HEADER_HEIGHT
        + NESTED_PROCESS_FIRST_CHILD_GAP
        + NESTED_PROCESS_PADDING
        + childrenHeight,
    };
    dimensions.set(processId, group);
    visiting.delete(processId);
    return group;
  };

  processes.forEach((process) => getDimensions(process.id));

  const positions = new Map<string, PprNodePosition>();
  const placeSubtree = (processId: string, position: PprNodePosition) => {
    positions.set(processId, position);
    const children = orderedChildrenByParentId.get(processId) ?? [];
    if (children.length === 0) return;

    const parentDimension = dimensions.get(processId);
    if (!parentDimension) return;
    const childDimensions = children.map((childId) => dimensions.get(childId) ?? {
      width: NESTED_PROCESS_LEAF_WIDTH,
      height: NESTED_PROCESS_LEAF_HEIGHT,
    });
    let childY = position.y + NESTED_PROCESS_HEADER_HEIGHT + NESTED_PROCESS_FIRST_CHILD_GAP;
    children.forEach((childId, index) => {
      const childDimension = childDimensions[index];
      placeSubtree(childId, {
        x: position.x + (parentDimension.width - childDimension.width) / 2,
        y: childY,
      });
      childY += childDimension.height + gapY;
    });
  };

  processes
    .filter((process) => !parentByElementId.has(process.id))
    .sort(compareElements)
    .forEach((process) => {
      placeSubtree(process.id, flatPositions.get(process.id) ?? { x: 0, y: 0 });
    });

  // Invalid or cyclic containment must never make a process disappear.
  processes.forEach((process) => {
    if (!positions.has(process.id)) {
      positions.set(process.id, flatPositions.get(process.id) ?? { x: 0, y: 0 });
    }
  });

  return {
    positions,
    parentByElementId,
    containerDimensions: new Map(
      [...dimensions].filter(([processId]) => (childrenByParentId.get(processId)?.length ?? 0) > 0),
    ),
  };
}

function moveNestedLayoutToColumn(
  layout: NestedProcessLayout,
  elements: PprElement[],
  columnX: number,
) {
  const rootX = Math.min(
    ...elements
      .filter((element) => !layout.parentByElementId.has(element.id))
      .map((element) => layout.positions.get(element.id)?.x ?? 0),
  );
  const offsetX = Number.isFinite(rootX) ? columnX - rootX : 0;
  return new Map(
    [...layout.positions].map(([id, position]) => [id, {
      ...position,
      x: position.x + offsetX,
    }]),
  );
}

function getProductFlowRanks(
  products: PprElement[],
  processes: PprElement[],
  relationships: PprRelationship[],
) {
  const productIds = new Set(products.map((product) => product.id));
  const processIds = new Set(processes.map((process) => process.id));
  const productPredecessors = new Map<string, Set<string>>(
    products.map((product) => [product.id, new Set<string>()]),
  );
  const inputProductsByProcess = new Map<string, string[]>();
  const outputProductsByProcess = new Map<string, string[]>();

  relationships.forEach((relationship) => {
    if (relationship.kind === 'consumed_by' && productIds.has(relationship.source_id) && processIds.has(relationship.target_id)) {
      const inputs = inputProductsByProcess.get(relationship.target_id) ?? [];
      inputs.push(relationship.source_id);
      inputProductsByProcess.set(relationship.target_id, inputs);
    }
    if (relationship.kind === 'produces' && processIds.has(relationship.source_id) && productIds.has(relationship.target_id)) {
      const outputs = outputProductsByProcess.get(relationship.source_id) ?? [];
      outputs.push(relationship.target_id);
      outputProductsByProcess.set(relationship.source_id, outputs);
    }
  });

  inputProductsByProcess.forEach((inputs, processId) => {
    const outputs = outputProductsByProcess.get(processId) ?? [];
    inputs.forEach((inputProductId) => {
      outputs.forEach((outputProductId) => {
        productPredecessors.get(outputProductId)?.add(inputProductId);
      });
    });
  });

  const ranks = new Map<string, number>();
  const visiting = new Set<string>();
  const getRank = (productId: string): number => {
    const cached = ranks.get(productId);
    if (cached !== undefined) return cached;
    if (visiting.has(productId)) return 0;
    visiting.add(productId);
    const rank = Math.max(
      0,
      ...[...(productPredecessors.get(productId) ?? new Set<string>())]
        .sort()
        .map((predecessorId) => getRank(predecessorId) + 1),
    );
    visiting.delete(productId);
    ranks.set(productId, rank);
    return rank;
  };

  products.forEach((product) => getRank(product.id));
  return ranks;
}

function getContainmentDepths(
  elements: PprElement[],
  relationships: PprRelationship[],
) {
  const elementIds = new Set(elements.map((element) => element.id));
  const parentById = new Map<string, string>();
  relationships
    .filter((relationship) =>
      relationship.kind === 'contains'
      && elementIds.has(relationship.source_id)
      && elementIds.has(relationship.target_id),
    )
    .slice()
    .sort((left, right) => left.source_id.localeCompare(right.source_id)
      || left.target_id.localeCompare(right.target_id)
      || left.id.localeCompare(right.id))
    .forEach((relationship) => {
      if (!parentById.has(relationship.target_id)) parentById.set(relationship.target_id, relationship.source_id);
    });

  const depthById = new Map<string, number>();
  const getDepth = (elementId: string) => {
    const cached = depthById.get(elementId);
    if (cached !== undefined) return cached;
    const visited = new Set<string>();
    let currentId = elementId;
    let depth = 0;
    while (parentById.has(currentId) && !visited.has(currentId)) {
      visited.add(currentId);
      currentId = parentById.get(currentId) ?? currentId;
      depth += 1;
    }
    depthById.set(elementId, depth);
    return depth;
  };
  elements.forEach((element) => getDepth(element.id));
  return { parentById, depthById };
}

function projectLevels(model: PprModel, requestedLevel: number): PprPerspectiveProjection {
  const allElements = getModelUsages(model);
  const allRelationships = getModelRelationships(model);
  const elementsById = new Map(allElements.map((element) => [element.id, element]));
  const processes = allElements.filter((element) => element.type === 'process');
  const resources = allElements.filter((element) => element.type === 'resource');
  const products = allElements.filter((element) => element.type === 'product');
  const productFlowRanks = getProductFlowRanks(products, processes, allRelationships);
  const processDepths = getContainmentDepths(processes, allRelationships);
  const resourceDepths = getContainmentDepths(resources, allRelationships);
  const maxLevel = Math.max(
    0,
    ...[...processDepths.depthById.values()],
    ...[...resourceDepths.depthById.values()],
  );
  const level = Math.max(0, Math.min(Math.floor(requestedLevel), maxLevel));
  const processIds = new Set(
    processes.filter((process) => (processDepths.depthById.get(process.id) ?? 0) <= level).map((process) => process.id),
  );
  const resourceIds = new Set(
    resources.filter((resource) => (resourceDepths.depthById.get(resource.id) ?? 0) <= level).map((resource) => resource.id),
  );

  const producerIdsByProductId = new Map<string, Set<string>>();
  const consumerIdsByProductId = new Map<string, Set<string>>();
  allRelationships.forEach((relationship) => {
    const source = elementsById.get(relationship.source_id);
    const target = elementsById.get(relationship.target_id);
    if (relationship.kind === 'produces' && source?.type === 'process' && target?.type === 'product') {
      const producerIds = producerIdsByProductId.get(target.id) ?? new Set<string>();
      producerIds.add(source.id);
      producerIdsByProductId.set(target.id, producerIds);
    }
    if (relationship.kind === 'consumed_by' && source?.type === 'product' && target?.type === 'process') {
      const consumerIds = consumerIdsByProductId.get(source.id) ?? new Set<string>();
      consumerIds.add(target.id);
      consumerIdsByProductId.set(source.id, consumerIds);
    }
  });

  const visibleProductIds = new Set<string>();
  products.forEach((product) => {
    const producerIds = producerIdsByProductId.get(product.id) ?? new Set<string>();
    const consumerIds = consumerIdsByProductId.get(product.id) ?? new Set<string>();
    const hasVisibleLink = [...producerIds, ...consumerIds].some((id) => processIds.has(id));
    const hasProcessLink = [...producerIds, ...consumerIds].some((id) => elementsById.get(id)?.type === 'process');
    const isBoundaryProduct = producerIds.size === 0 || consumerIds.size === 0;
    if ((level > 0 && hasVisibleLink) || (level === 0 && isBoundaryProduct && hasProcessLink)) {
      visibleProductIds.add(product.id);
    }
  });
  // A model without typed product flow should still give the levels view useful
  // context rather than rendering an empty product lane.
  if (visibleProductIds.size === 0) {
    products.filter((product) => product.visible_in_ppr !== false).forEach((product) => visibleProductIds.add(product.id));
  }

  const visibleIds = new Set([...processIds, ...resourceIds, ...visibleProductIds]);
  const projectedRelationships: PprRelationship[] = [];
  const derivedEdges = new Map<string, DerivedPerspectiveEdge>();
  const addRelationship = (relationship: PprRelationship) => {
    if (visibleIds.has(relationship.source_id) && visibleIds.has(relationship.target_id)) {
      projectedRelationships.push(relationship);
    }
  };

  allRelationships.forEach((relationship) => {
    const source = elementsById.get(relationship.source_id);
    const target = elementsById.get(relationship.target_id);
    const isProcessContainment = relationship.kind === 'contains'
      && source?.type === 'process' && target?.type === 'process';
    const isResourceContainment = relationship.kind === 'contains'
      && source?.type === 'resource' && target?.type === 'resource';
    if (isProcessContainment || isResourceContainment) return;
    addRelationship(relationship);
  });

  const rootProcessIds = processes
    .filter((process) => !processDepths.parentById.has(process.id))
    .map((process) => process.id)
    .sort();
  const processIdsByRoot = new Map<string, Set<string>>();
  rootProcessIds.forEach((rootId) => {
    const members = new Set<string>();
    processes.forEach((process) => {
      let currentId = process.id;
      const visited = new Set<string>();
      while (!visited.has(currentId)) {
        visited.add(currentId);
        if (currentId === rootId) {
          members.add(process.id);
          break;
        }
        currentId = processDepths.parentById.get(currentId) ?? '';
        if (!currentId) break;
      }
    });
    processIdsByRoot.set(rootId, members);
  });

  // At the summary level, collapse the product flow through hidden subprocesses
  // to the root cycle. Deeper levels use the actual process endpoints above.
  if (level === 0) {
    rootProcessIds.forEach((rootId) => {
      const members = processIdsByRoot.get(rootId) ?? new Set<string>();
      products.forEach((product) => {
        const producerIds = producerIdsByProductId.get(product.id) ?? new Set<string>();
        const consumerIds = consumerIdsByProductId.get(product.id) ?? new Set<string>();
        const hasRootInput = [...consumerIds].some((id) => members.has(id)) && producerIds.size === 0;
        const hasRootOutput = [...producerIds].some((id) => members.has(id)) && consumerIds.size === 0;
        if (hasRootInput) {
          const id = `levels-input-${product.id}-${rootId}`;
          projectedRelationships.push({
            id,
            source_id: product.id,
            target_id: rootId,
            kind: 'consumed_by',
            role_name: product.name,
          });
          derivedEdges.set(id, { label: product.name, relatedElementId: product.id });
        }
        if (hasRootOutput) {
          const id = `levels-output-${rootId}-${product.id}`;
          projectedRelationships.push({
            id,
            source_id: rootId,
            target_id: product.id,
            kind: 'produces',
            role_name: product.name,
          });
          derivedEdges.set(id, { label: product.name, relatedElementId: product.id });
        }
      });
    });
  }

  const visibleProcesses = processes.filter((process) => processIds.has(process.id));
  const visibleResources = resources.filter((resource) => resourceIds.has(resource.id));
  const rootProcessIdById = new Map<string, string>();
  processes.forEach((process) => {
    let rootId = process.id;
    const visited = new Set<string>();
    while (processDepths.parentById.has(rootId) && !visited.has(rootId)) {
      visited.add(rootId);
      rootId = processDepths.parentById.get(rootId) ?? rootId;
    }
    rootProcessIdById.set(process.id, rootId);
  });
  const processContainment = allRelationships.filter((relationship) =>
    relationship.kind === 'contains'
    && processIds.has(relationship.source_id)
    && processIds.has(relationship.target_id),
  );
  const processFlowRelationships: PprRelationship[] = [];
  producerIdsByProductId.forEach((producerIds, productId) => {
    const consumerIds = consumerIdsByProductId.get(productId) ?? new Set<string>();
    [...producerIds].sort().forEach((producerId) => {
      [...consumerIds].sort().forEach((consumerId) => {
        if (producerId === consumerId) return;
        processFlowRelationships.push({
          id: `levels-process-flow-${productId}-${producerId}-${consumerId}`,
          source_id: producerId,
          target_id: consumerId,
          kind: 'succeeds',
          role_name: elementsById.get(productId)?.name ?? null,
        });
      });
    });
  });
  const resourceContainment = allRelationships.filter((relationship) =>
    relationship.kind === 'contains'
    && resourceIds.has(relationship.source_id)
    && resourceIds.has(relationship.target_id),
  );

  const processFlatPositions = getHierarchyPositions(
    visibleProcesses,
    visibleProcesses.filter((process) => !processDepths.parentById.has(process.id)).map((process) => process.id),
    new Map(),
  );
  const resourceFlatPositions = getHierarchyPositions(
    visibleResources,
    visibleResources.filter((resource) => !resourceDepths.parentById.has(resource.id)).map((resource) => resource.id),
    new Map(),
  );
  const processLayout = getNestedProcessLayout(
    visibleProcesses,
    [...processContainment, ...processFlowRelationships],
    processFlatPositions,
    LEVEL_PROCESS_GAP_Y,
  );
  const positions = new Map<string, PprNodePosition>();
  moveNestedLayoutToColumn(processLayout, visibleProcesses, LEVEL_PROCESS_COLUMN_X)
    .forEach((position, id) => positions.set(id, { x: position.x, y: position.y + 80 }));

  const processIdsByResourceId = new Map<string, Set<string>>();
  allRelationships.forEach((relationship) => {
    if (
      relationship.kind !== 'performs'
      || !resourceIds.has(relationship.source_id)
      || !processes.some((process) => process.id === relationship.target_id)
    ) return;
    const assignedProcessIds = processIdsByResourceId.get(relationship.source_id) ?? new Set<string>();
    assignedProcessIds.add(relationship.target_id);
    processIdsByResourceId.set(relationship.source_id, assignedProcessIds);
  });
  const resourceAnchorY = (resourceId: string, visiting = new Set<string>()): number | undefined => {
    if (visiting.has(resourceId)) return undefined;
    visiting.add(resourceId);
    const assignedProcessY = [...(processIdsByResourceId.get(resourceId) ?? new Set<string>())]
      .map((processId) => processIds.has(processId) ? processId : rootProcessIdById.get(processId))
      .map((processId) => processId ? positions.get(processId)?.y : undefined)
      .filter((y): y is number => y !== undefined);
    const descendantY = [...resourceDepths.parentById.entries()]
      .filter(([, parentId]) => parentId === resourceId)
      .map(([childId]) => resourceAnchorY(childId, new Set(visiting)))
      .filter((y): y is number => y !== undefined);
    const anchorY = [...assignedProcessY, ...descendantY].sort((left, right) => left - right)[0];
    visiting.delete(resourceId);
    return anchorY;
  };
  const resourceFlatPositionsByFlow = new Map(resourceFlatPositions);
  visibleResources.forEach((resource) => {
    if (resourceDepths.parentById.has(resource.id)) return;
    const processY = resourceAnchorY(resource.id);
    if (processY !== undefined) {
      resourceFlatPositionsByFlow.set(resource.id, { x: resource.x, y: processY - 80 });
    }
  });
  const resourceFlowRelationships: PprRelationship[] = [];
  const resourceChildrenByParentId = new Map<string, string[]>();
  resourceDepths.parentById.forEach((parentId, childId) => {
    if (!resourceIds.has(childId) || !resourceIds.has(parentId)) return;
    const children = resourceChildrenByParentId.get(parentId) ?? [];
    children.push(childId);
    resourceChildrenByParentId.set(parentId, children);
  });
  resourceChildrenByParentId.forEach((children, parentId) => {
    const orderedChildren = children.slice().sort((left, right) =>
      (resourceAnchorY(left) ?? Number.MAX_SAFE_INTEGER) - (resourceAnchorY(right) ?? Number.MAX_SAFE_INTEGER)
      || left.localeCompare(right),
    );
    orderedChildren.slice(1).forEach((childId, index) => {
      const previousChildId = orderedChildren[index];
      resourceFlowRelationships.push({
        id: `levels-resource-flow-${parentId}-${previousChildId}-${childId}`,
        source_id: previousChildId,
        target_id: childId,
        kind: 'succeeds',
      });
    });
  });
  const resourceLayout = getNestedProcessLayout(
    visibleResources,
    [...resourceContainment, ...resourceFlowRelationships],
    resourceFlatPositionsByFlow,
    LEVEL_PROCESS_GAP_Y,
  );
  moveNestedLayoutToColumn(resourceLayout, visibleResources, LEVEL_RESOURCE_COLUMN_X)
    .forEach((position, id) => positions.set(id, { x: position.x, y: position.y + 80 }));

  const visibleProducts = products.filter((product) => visibleProductIds.has(product.id)).sort((left, right) =>
    (productFlowRanks.get(left.id) ?? 0) - (productFlowRanks.get(right.id) ?? 0)
    || left.id.localeCompare(right.id),
  );
  const productRowIndexes = new Map<string, number>();
  visibleProducts.forEach((product, index) => {
    const consumerIds = [...(consumerIdsByProductId.get(product.id) ?? [])];
    const producerIds = [...(producerIdsByProductId.get(product.id) ?? [])];
    const isInputProduct = producerIds.length === 0;
    const producerAnchorCandidates = producerIds
      .map((processId) => processIds.has(processId) ? processId : rootProcessIdById.get(processId))
      .filter((processId): processId is string => Boolean(processId && processIds.has(processId)));
    const consumerAnchorCandidates = consumerIds
      .map((processId) => processIds.has(processId) ? processId : rootProcessIdById.get(processId))
      .filter((processId): processId is string => Boolean(processId && processIds.has(processId)));
    const anchorCandidates = [...(isInputProduct ? consumerAnchorCandidates : producerAnchorCandidates)];
    const anchorProcessId = anchorCandidates.sort((left, right) =>
      (positions.get(left)?.y ?? 0) - (positions.get(right)?.y ?? 0)
      || left.localeCompare(right),
    )[0];
    const rowKey = anchorProcessId ? `${isInputProduct ? 'input' : 'output'}:${anchorProcessId}` : `orphan:${index}`;
    const rowIndex = productRowIndexes.get(rowKey) ?? 0;
    productRowIndexes.set(rowKey, rowIndex + 1);
    const anchorY = anchorProcessId ? positions.get(anchorProcessId)?.y : undefined;
    const producerYs = producerAnchorCandidates
      .map((processId) => positions.get(processId)?.y)
      .filter((y): y is number => y !== undefined);
    const consumerYs = consumerAnchorCandidates
      .map((processId) => positions.get(processId)?.y)
      .filter((y): y is number => y !== undefined);
    const isIntermediateProduct = producerYs.length > 0 && consumerYs.length > 0;
    const intermediateY = isIntermediateProduct
      ? (Math.max(...producerYs) + Math.min(...consumerYs)) / 2
      : undefined;
    positions.set(product.id, {
      x: LEVEL_PRODUCT_COLUMN_X + rowIndex * 270,
      y: intermediateY
        ?? (anchorY === undefined ? 110 + index * 170 : anchorY + (isInputProduct ? -180 : 180)),
    });
  });

  const containerKinds = new Map<string, 'process' | 'resource'>();
  processLayout.containerDimensions.forEach((_, id) => containerKinds.set(id, 'process'));
  resourceLayout.containerDimensions.forEach((_, id) => containerKinds.set(id, 'resource'));
  const parentByElementId = new Map([...processLayout.parentByElementId, ...resourceLayout.parentByElementId]);
  const containerDimensions = new Map([...processLayout.containerDimensions, ...resourceLayout.containerDimensions]);

  return {
    model: {
      ...model,
      diagram: {
        usages: withPositions([...visibleProducts, ...visibleProcesses, ...visibleResources], positions),
        relationships: projectedRelationships,
      },
    },
    derivedEdges,
    parentByElementId,
    containerDimensions,
    containerKinds,
    maxLevel,
  };
}

function projectProcess(model: PprModel): PprPerspectiveProjection {
  const elementsById = new Map(getModelUsages(model).map((element) => [element.id, element]));
  const processes = getModelUsages(model).filter((element) => element.type === 'process');
  const processIds = new Set(processes.map((element) => element.id));
  const producersByProductId = new Map<string, string[]>();
  const consumersByProductId = new Map<string, string[]>();

  getModelRelationships(model).forEach((relationship) => {
    const source = elementsById.get(relationship.source_id);
    const target = elementsById.get(relationship.target_id);
    if (relationship.kind === 'produces' && source?.type === 'process' && target?.type === 'product') {
      const producers = producersByProductId.get(target.id) ?? [];
      if (!producers.includes(source.id)) producers.push(source.id);
      producersByProductId.set(target.id, producers);
    }
    if (relationship.kind === 'consumed_by' && source?.type === 'product' && target?.type === 'process') {
      const consumers = consumersByProductId.get(source.id) ?? [];
      if (!consumers.includes(target.id)) consumers.push(target.id);
      consumersByProductId.set(source.id, consumers);
    }
  });

  const relationships: PprRelationship[] = getModelRelationships(model).filter((relationship) => {
    if (!processIds.has(relationship.source_id) || !processIds.has(relationship.target_id)) return false;
    // Explicit succession remains visible in the nested working view, while
    // containment is represented by React Flow parent/child metadata.
    return relationship.kind === 'contains' || relationship.kind === 'succeeds';
  });
  const derivedEdges = new Map<string, DerivedPerspectiveEdge>();
  producersByProductId.forEach((producerIds, productId) => {
    const product = elementsById.get(productId);
    const consumerIds = consumersByProductId.get(productId) ?? [];
    producerIds.slice().sort().forEach((producerId) => {
      consumerIds.slice().sort().forEach((consumerId) => {
        if (producerId === consumerId) return;
        const id = `process-flow-${productId}-${producerId}-${consumerId}`;
        relationships.push({
          id,
          source_id: producerId,
          target_id: consumerId,
          kind: 'succeeds',
          role_name: product?.name ?? null,
        });
        derivedEdges.set(id, {
          label: product?.name ?? 'Product flow',
          relatedElementId: product?.id,
        });
      });
    });
  });

  const incomingIds = new Set(relationships.map((relationship) => relationship.target_id));
  const childrenByProcessId = new Map<string, string[]>();
  relationships.forEach((relationship) => {
    const children = childrenByProcessId.get(relationship.source_id) ?? [];
    if (!children.includes(relationship.target_id)) children.push(relationship.target_id);
    childrenByProcessId.set(relationship.source_id, children);
  });
  const roots = processes.filter((process) => !incomingIds.has(process.id));
  const flatPositions = getHierarchyPositions(
    processes,
    roots.map((process) => process.id),
    childrenByProcessId,
  );
  const nestedLayout = getNestedProcessLayout(
    processes,
    relationships,
    flatPositions,
  );
  const projectedRelationships = relationships.filter((relationship) => relationship.kind !== 'contains');

  return {
    model: {
      ...model,
      diagram: {
        usages: withPositions(
          processes,
          nestedLayout?.positions ?? flatPositions,
        ),
        relationships: projectedRelationships,
      },
    },
    derivedEdges,
    parentByElementId: nestedLayout?.parentByElementId,
    containerDimensions: nestedLayout?.containerDimensions,
  };
}

function projectProduct(model: PprModel, mode: PprProductViewMode): PprPerspectiveProjection {
  const elementsById = new Map(getModelUsages(model).map((element) => [element.id, element]));
  const products = getModelUsages(model).filter((element) => element.type === 'product');

  if (mode === 'bom') {
    const relationships = getModelRelationships(model).filter((relationship) => {
      if (relationship.kind !== 'contains') return false;
      const source = elementsById.get(relationship.source_id);
      const target = elementsById.get(relationship.target_id);
      return source?.type === 'product' && target?.type === 'product';
    });
    const childrenByProductId = new Map<string, string[]>();
    const childIds = new Set<string>();
    relationships.forEach((relationship) => {
      const children = childrenByProductId.get(relationship.source_id) ?? [];
      if (!children.includes(relationship.target_id)) children.push(relationship.target_id);
      childrenByProductId.set(relationship.source_id, children);
      childIds.add(relationship.target_id);
    });
    const positions = getHierarchyPositions(
      products,
      products.filter((product) => !childIds.has(product.id)).map((product) => product.id),
      childrenByProductId,
    );
    return {
      model: {
        ...model,
        diagram: {
          usages: withPositions(products, positions),
          relationships,
        },
      },
      derivedEdges: new Map(),
    };
  }

  const bom = getProductBom(model);
  const childrenByProductId = new Map<string, string[]>();
  const relationships: PprRelationship[] = getModelRelationships(model).filter((relationship) => {
    if (relationship.kind !== 'becomes') return false;
    const source = elementsById.get(relationship.source_id);
    const target = elementsById.get(relationship.target_id);
    return source?.type === 'product' && target?.type === 'product';
  });
  const derivedEdges = new Map<string, DerivedPerspectiveEdge>();

  bom.childrenByProductId.forEach((edges, parentId) => {
    childrenByProductId.set(parentId, edges.map((edge) => edge.childProductId));
    edges.forEach((edge) => {
      const process = elementsById.get(edge.processId);
      relationships.push({
        id: edge.id,
        source_id: edge.parentProductId,
        target_id: edge.childProductId,
        kind: 'contains',
        quantity: edge.quantity,
        unit: edge.unit,
        role_name: process?.name ?? null,
      });
      derivedEdges.set(edge.id, {
        label: process ? `Built by ${process.name}` : 'Built by process',
        relatedElementId: process?.id,
      });
    });
  });

  const positions = getHierarchyPositions(
    bom.products,
    bom.roots.map((root) => root.id),
    childrenByProductId,
  );
  return {
    model: {
      ...model,
      diagram: {
        usages: withPositions(bom.products, positions),
        relationships,
      },
    },
    derivedEdges,
  };
}

function projectResource(model: PprModel, mode: PprResourceViewMode): PprPerspectiveProjection {
  const tree = getResourceTree(model);
  const relationshipIds = new Set(tree.edges.map((edge) => edge.relationshipId));
  const relationships = getModelRelationships(model).filter((relationship) => relationshipIds.has(relationship.id));
  const childrenByResourceId = new Map<string, string[]>();
  tree.childrenByResourceId.forEach((edges, parentId) => {
    childrenByResourceId.set(parentId, edges.map((edge) => edge.childResourceId));
  });
  const positions = getHierarchyPositions(
    tree.resources,
    tree.roots.map((root) => root.id),
    childrenByResourceId,
  );

  if (mode === 'nested') {
    const nestedLayout = getNestedProcessLayout(tree.resources, relationships, positions);
    return {
      model: {
        ...model,
        diagram: {
          usages: withPositions(tree.resources, nestedLayout.positions),
          relationships: relationships.filter((relationship) => relationship.kind !== 'contains'),
        },
      },
      derivedEdges: new Map(),
      parentByElementId: nestedLayout.parentByElementId,
      containerDimensions: nestedLayout.containerDimensions,
      containerKinds: new Map(
        [...nestedLayout.containerDimensions.keys()].map((resourceId) => [resourceId, 'resource' as const]),
      ),
    };
  }

  return {
    model: {
      ...model,
      diagram: {
        usages: withPositions(tree.resources, positions),
        relationships,
      },
    },
    derivedEdges: new Map(),
  };
}

function collapseProductStates(model: PprModel): PprModel {
  const products = getModelUsages(model).filter((usage) => usage.type === 'product');
  const productIds = new Set(products.map((product) => product.id));
  const previousById = new Map(
    getModelRelationships(model)
      .filter((relationship) => relationship.kind === 'becomes')
      .map((relationship) => [relationship.target_id, relationship.source_id]),
  );
  const representativeById = new Map<string, string>();
  products.forEach((product) => {
    let currentId = product.id;
    const visited = new Set<string>();
    while (previousById.has(currentId) && !visited.has(currentId)) {
      visited.add(currentId);
      currentId = previousById.get(currentId) ?? currentId;
    }
    representativeById.set(product.id, currentId);
  });
  const usages = getModelUsages(model).filter((usage) =>
    usage.type !== 'product' || representativeById.get(usage.id) === usage.id);
  const keys = new Set<string>();
  const relationships = getModelRelationships(model).flatMap((relationship) => {
    if (relationship.kind === 'becomes') return [];
    const sourceId = productIds.has(relationship.source_id)
      ? representativeById.get(relationship.source_id) ?? relationship.source_id
      : relationship.source_id;
    const targetId = productIds.has(relationship.target_id)
      ? representativeById.get(relationship.target_id) ?? relationship.target_id
      : relationship.target_id;
    if (sourceId === targetId) return [];
    const key = `${sourceId}:${targetId}:${relationship.kind}`;
    if (keys.has(key)) return [];
    keys.add(key);
    return [{ ...relationship, source_id: sourceId, target_id: targetId }];
  });
  return { ...model, diagram: { usages, relationships } };
}

function projectPpr(model: PprModel, collapseItemStates = false): PprPerspectiveProjection {
  const projectedModel = collapseItemStates ? collapseProductStates(model) : model;
  const usages = getModelUsages(projectedModel).filter((element) => element.visible_in_ppr !== false);
  if (usages.length === getModelUsages(projectedModel).length) {
    return { model: projectedModel, derivedEdges: new Map() };
  }

  const allUsageIds = new Set(getModelUsages(projectedModel).map((element) => element.id));
  const visibleUsageIds = new Set(usages.map((element) => element.id));
  const relationships = getModelRelationships(projectedModel).filter((relationship) =>
    (!allUsageIds.has(relationship.source_id) || visibleUsageIds.has(relationship.source_id))
    && (!allUsageIds.has(relationship.target_id) || visibleUsageIds.has(relationship.target_id)),
  );
  return {
    model: {
      ...projectedModel,
      diagram: { usages, relationships },
    },
    derivedEdges: new Map(),
  };
}

export function getPprPerspectiveProjection(
  model: PprModel,
  perspective: PprCanvasPerspective,
  productViewMode: PprProductViewMode = 'ppr',
  pprLevel = 0,
  resourceViewMode: PprResourceViewMode = 'contains',
  collapseItemStates = false,
): PprPerspectiveProjection {
  if (perspective === 'levels') return projectLevels(model, pprLevel);
  if (perspective === 'process') return projectProcess(model);
  if (perspective === 'product') return projectProduct(model, productViewMode);
  if (perspective === 'resource') return projectResource(model, resourceViewMode);
  return projectPpr(model, collapseItemStates);
}
