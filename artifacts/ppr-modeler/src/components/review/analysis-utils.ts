import type { PprElement, PprModel, PprRelationship } from '@workspace/api-client-react';
import {
  getRelationshipKindsForTypes,
  isAllowedRelationshipType,
  RELATIONSHIP_RULES,
} from '@workspace/api-zod';

export { RELATIONSHIP_RULES };

export type RelationBucket = 'consumed_by' | 'produces' | 'performs' | 'supports';
export type AnalysisFilter = 'all' | RelationBucket;

export const ANALYSIS_FILTER_LABELS: Record<AnalysisFilter, string> = {
  all: 'All roles',
  consumed_by: 'Inputs',
  produces: 'Outputs',
  performs: 'Performing',
  supports: 'Supporting',
};

export type RelationshipProblem = {
  title: 'Missing endpoint' | 'Outside process review' | 'Unexpected direction';
  detail: string;
};

export const PROCESS_REVIEW_RELATIONSHIPS = new Set<PprRelationship['kind']>(['consumed_by', 'produces', 'performs']);
export const RESOURCE_REVIEW_RELATIONSHIPS = new Set<PprRelationship['kind']>([
  'consumed_by',
  'produces',
  'performs',
  'contains',
]);
const RESOURCE_TREE_RELATIONSHIPS = new Set<PprRelationship['kind']>(['contains']);

export function getModelUsages(model: PprModel): PprElement[] {
  return model.diagram?.usages ?? (model as PprModel & { elements?: PprElement[] }).elements ?? [];
}

export function getModelRelationships(model: PprModel): PprRelationship[] {
  return model.diagram?.relationships
    ?? (model as PprModel & { relationships?: PprRelationship[] }).relationships
    ?? [];
}

export function getElementMap(model: PprModel): Map<string, PprElement> {
  return new Map(getModelUsages(model).map((element) => [element.id, element]));
}

export function getElementsByType(model: PprModel, type: PprElement['type']): PprElement[] {
  return getModelUsages(model).filter((element) => element.type === type);
}

export function getAnalysisCounts(model: PprModel) {
  return {
    process: getElementsByType(model, 'process').length,
    product: getElementsByType(model, 'product').length,
    resource: getElementsByType(model, 'resource').length,
  };
}

export function getRelationshipProblem(
  relationship: PprRelationship,
  elementsById: Map<string, PprElement>,
  allowedRelationships: Set<PprRelationship['kind']> = PROCESS_REVIEW_RELATIONSHIPS,
): RelationshipProblem | undefined {
  const source = elementsById.get(relationship.source_id);
  const target = elementsById.get(relationship.target_id);

  if (!source || !target) {
    return {
      title: 'Missing endpoint',
      detail: `${source?.name ?? relationship.source_id} → ${target?.name ?? relationship.target_id}`,
    };
  }

  if (!allowedRelationships.has(relationship.kind)) {
    return {
      title: 'Outside process review',
      detail: `${source.name} → ${target.name} · ${relationship.kind}`,
    };
  }

  if (!isAllowedRelationshipType(relationship.kind, source.type, target.type)) {
    return {
      title: 'Unexpected direction',
      detail: `${source.name} (${source.type}) → ${target.name} (${target.type}) · ${relationship.kind}`,
    };
  }

  return undefined;
}

export function getSupportedRelationshipKinds(
  source: PprElement['type'],
  target: PprElement['type'],
): PprRelationship['kind'][] {
  return getRelationshipKindsForTypes(source, target) as PprRelationship['kind'][];
}

export type AnalysisIntegrityPerspective = 'process' | 'resource';

export function getRelationshipProblems(
  model: PprModel,
  perspective: AnalysisIntegrityPerspective = 'process',
) {
  const elementsById = getElementMap(model);
  const allowedRelationships = perspective === 'resource'
    ? RESOURCE_REVIEW_RELATIONSHIPS
    : PROCESS_REVIEW_RELATIONSHIPS;
  return getModelRelationships(model)
    .map((relationship) => ({
      relationship,
      problem: getRelationshipProblem(relationship, elementsById, allowedRelationships),
    }))
    .filter((item): item is { relationship: PprRelationship; problem: RelationshipProblem } => Boolean(item.problem));
}

export function getRelatedElements(
  model: PprModel,
  elementsById: Map<string, PprElement>,
  anchorId: string,
  kind: RelationBucket,
): PprElement[] {
  const processIsSource = kind === 'produces';
  return getModelRelationships(model)
    .filter((relationship) => {
      if (relationship.kind !== kind) return false;
      const relatedId = processIsSource ? relationship.target_id : relationship.source_id;
      return (processIsSource ? relationship.source_id : relationship.target_id) === anchorId && elementsById.has(relatedId);
    })
    .map((relationship) => elementsById.get(processIsSource ? relationship.target_id : relationship.source_id))
    .filter((element): element is PprElement => Boolean(element));
}

export function getProductProcesses(
  model: PprModel,
  elementsById: Map<string, PprElement>,
  productId: string,
  direction: 'upstream' | 'downstream',
): PprElement[] {
  const isProducedBy = direction === 'upstream';
  return getModelRelationships(model)
    .filter((relationship) => {
      const matchesDirection = isProducedBy ? relationship.kind === 'produces' : relationship.kind === 'consumed_by';
      const matchesProduct = isProducedBy
        ? relationship.target_id === productId
        : relationship.source_id === productId;
      return matchesDirection && matchesProduct;
    })
    .map((relationship) => elementsById.get(isProducedBy ? relationship.source_id : relationship.target_id))
    .filter((element): element is PprElement => element?.type === 'process');
}

export function getResourceProcesses(
  model: PprModel,
  elementsById: Map<string, PprElement>,
  resourceId: string,
  kind: Extract<RelationBucket, 'performs' | 'supports'>,
): PprElement[] {
  return getModelRelationships(model)
    .filter((relationship) => relationship.kind === 'performs'
      && relationship.source_id === resourceId
      && (kind === 'supports'
        ? relationship.modality === 'supports'
        : relationship.modality !== 'supports'))
    .map((relationship) => elementsById.get(relationship.target_id))
    .filter((element): element is PprElement => element?.type === 'process');
}

export type ResourceTreeEdge = {
  id: string;
  parentResourceId: string;
  childResourceId: string;
  relationshipId: string;
  kind: Extract<PprRelationship['kind'], 'contains'>;
};

export type ResourceTreeProjection = {
  resources: PprElement[];
  roots: PprElement[];
  edges: ResourceTreeEdge[];
  childrenByResourceId: Map<string, ResourceTreeEdge[]>;
  parentsByResourceId: Map<string, string[]>;
  parentResourceIds: Set<string>;
  sharedResourceIds: Set<string>;
  orphanResourceIds: Set<string>;
  cycleResourceIds: Set<string>;
  processLinkedResourceIds: Set<string>;
};

/**
 * Project explicit resource composition links into a finite, reviewable tree.
 * The source resource is treated as the parent for both supported hierarchy
 * relationship kinds; the relationship itself remains canonical model data.
 */
export function getResourceTree(model: PprModel): ResourceTreeProjection {
  const resources = getModelUsages(model).filter((element) => element.type === 'resource');
  const elementsById = new Map(getModelUsages(model).map((element) => [element.id, element]));
  const edges: ResourceTreeEdge[] = [];

  getModelRelationships(model).forEach((relationship) => {
    if (!RESOURCE_TREE_RELATIONSHIPS.has(relationship.kind)) return;
    const kind = relationship.kind === 'contains' ? relationship.kind : null;
    if (!kind) return;
    const source = elementsById.get(relationship.source_id);
    const target = elementsById.get(relationship.target_id);
    if (!source || !target || source.type !== 'resource' || target.type !== 'resource') return;
    edges.push({
      id: `resource-tree-${relationship.id}`,
      parentResourceId: source.id,
      childResourceId: target.id,
      relationshipId: relationship.id,
      kind,
    });
  });

  const childrenByResourceId = new Map<string, ResourceTreeEdge[]>();
  const parentIdsByResourceId = new Map<string, Set<string>>();
  edges.forEach((edge) => {
    const children = childrenByResourceId.get(edge.parentResourceId) ?? [];
    children.push(edge);
    childrenByResourceId.set(edge.parentResourceId, children);
    const parents = parentIdsByResourceId.get(edge.childResourceId) ?? new Set<string>();
    parents.add(edge.parentResourceId);
    parentIdsByResourceId.set(edge.childResourceId, parents);
  });

  const cycleResourceIds = new Set<string>();
  const visited = new Set<string>();
  const activePath: string[] = [];
  const activeIds = new Set<string>();
  const visit = (resourceId: string) => {
    if (activeIds.has(resourceId)) {
      const cycleStart = activePath.indexOf(resourceId);
      activePath.slice(cycleStart).forEach((id) => cycleResourceIds.add(id));
      return;
    }
    if (visited.has(resourceId)) return;
    activePath.push(resourceId);
    activeIds.add(resourceId);
    (childrenByResourceId.get(resourceId) ?? []).forEach((edge) => visit(edge.childResourceId));
    activePath.pop();
    activeIds.delete(resourceId);
    visited.add(resourceId);
  };
  resources.forEach((resource) => visit(resource.id));

  const roots = resources.filter((resource) => !parentIdsByResourceId.has(resource.id));
  const reachableFromRoots = new Set<string>();
  const markReachable = (resourceId: string) => {
    if (reachableFromRoots.has(resourceId)) return;
    reachableFromRoots.add(resourceId);
    (childrenByResourceId.get(resourceId) ?? []).forEach((edge) => markReachable(edge.childResourceId));
  };
  roots.forEach((resource) => markReachable(resource.id));
  resources.forEach((resource) => {
    if (reachableFromRoots.has(resource.id)) return;
    roots.push(resource);
    markReachable(resource.id);
  });

  const processLinkedResourceIds = new Set(
    getModelRelationships(model)
      .filter((relationship) => relationship.kind === 'performs')
      .filter((relationship) =>
        elementsById.get(relationship.source_id)?.type === 'resource' &&
        elementsById.get(relationship.target_id)?.type === 'process',
      )
      .map((relationship) => relationship.source_id),
  );

  return {
    resources,
    roots,
    edges,
    childrenByResourceId,
    parentsByResourceId: new Map(
      [...parentIdsByResourceId.entries()].map(([resourceId, parentIds]) => [resourceId, [...parentIds]]),
    ),
    parentResourceIds: new Set(parentIdsByResourceId.keys()),
    sharedResourceIds: new Set(
      [...parentIdsByResourceId.entries()]
        .filter(([, parentIds]) => parentIds.size > 1)
        .map(([resourceId]) => resourceId),
    ),
    orphanResourceIds: new Set(
      resources
        .filter((resource) => !childrenByResourceId.has(resource.id) && !parentIdsByResourceId.has(resource.id))
        .map((resource) => resource.id),
    ),
    cycleResourceIds,
    processLinkedResourceIds,
  };
}

export function getResourceAncestorIds(
  tree: Pick<ResourceTreeProjection, 'parentsByResourceId'>,
  resourceId: string,
): Set<string> {
  const ancestors = new Set<string>();
  const visit = (currentId: string) => {
    if (ancestors.has(currentId)) return;
    ancestors.add(currentId);
    (tree.parentsByResourceId.get(currentId) ?? []).forEach(visit);
  };
  (tree.parentsByResourceId.get(resourceId) ?? []).forEach(visit);
  return ancestors;
}

export type ProductBomEdge = {
  id: string;
  parentProductId: string;
  childProductId: string;
  processId: string;
  inputRelationshipId: string;
  outputRelationshipId: string;
  quantity: number | null;
  unit: string | null;
  isAmbiguous: boolean;
};

export type ProductBomProjection = {
  products: PprElement[];
  roots: PprElement[];
  childrenByProductId: Map<string, ProductBomEdge[]>;
  parentProductIds: Set<string>;
  sharedProductIds: Set<string>;
  orphanProductIds: Set<string>;
  cycleProductIds: Set<string>;
};

/**
 * Derive a read-only product structure from the existing process flow.
 * Each produced product becomes a parent of every valid input to that process.
 */
export function getProductBom(model: PprModel): ProductBomProjection {
  const products = getModelUsages(model).filter((element) => element.type === 'product');
  const processes = new Map(
    getModelUsages(model)
      .filter((element) => element.type === 'process')
      .map((element) => [element.id, element]),
  );
  const elementsById = new Map(getModelUsages(model).map((element) => [element.id, element]));
  const inputsByProcess = new Map<string, Array<{
    productId: string;
    relationshipId: string;
    quantity: number | null;
    unit: string | null;
  }>>();
  const outputsByProcess = new Map<string, Array<{ productId: string; relationshipId: string }>>();

  for (const relationship of getModelRelationships(model)) {
    if (relationship.kind === 'consumed_by') {
      const source = elementsById.get(relationship.source_id);
      if (!source || source.type !== 'product' || !processes.has(relationship.target_id)) continue;
      const inputs = inputsByProcess.get(relationship.target_id) ?? [];
      inputs.push({
        productId: source.id,
        relationshipId: relationship.id,
        quantity: relationship.quantity ?? null,
        unit: relationship.unit?.trim() || null,
      });
      inputsByProcess.set(relationship.target_id, inputs);
    }
    if (relationship.kind === 'produces') {
      const target = elementsById.get(relationship.target_id);
      if (!target || target.type !== 'product' || !processes.has(relationship.source_id)) continue;
      const outputs = outputsByProcess.get(relationship.source_id) ?? [];
      outputs.push({ productId: target.id, relationshipId: relationship.id });
      outputsByProcess.set(relationship.source_id, outputs);
    }
  }

  const edges: ProductBomEdge[] = [];
  const edgeKeys = new Set<string>();
  for (const [processId, outputs] of outputsByProcess) {
    const inputs = inputsByProcess.get(processId) ?? [];
    for (const output of outputs) {
      for (const input of inputs) {
        const edgeKey = `${output.productId}:${input.productId}:${processId}`;
        if (edgeKeys.has(edgeKey)) continue;
        edgeKeys.add(edgeKey);
        edges.push({
          id: `bom-${processId}-${output.productId}-${input.productId}`,
          parentProductId: output.productId,
          childProductId: input.productId,
          processId,
          inputRelationshipId: input.relationshipId,
          outputRelationshipId: output.relationshipId,
          quantity: input.quantity,
          unit: input.unit,
          isAmbiguous: outputs.length > 1,
        });
      }
    }
  }

  const childrenByProductId = new Map<string, ProductBomEdge[]>();
  const parentIdsByProductId = new Map<string, Set<string>>();
  for (const edge of edges) {
    const children = childrenByProductId.get(edge.parentProductId) ?? [];
    children.push(edge);
    childrenByProductId.set(edge.parentProductId, children);
    const parents = parentIdsByProductId.get(edge.childProductId) ?? new Set<string>();
    parents.add(edge.parentProductId);
    parentIdsByProductId.set(edge.childProductId, parents);
  }

  const cycleProductIds = new Set<string>();
  const visited = new Set<string>();
  const activePath: string[] = [];
  const activeIds = new Set<string>();
  const visit = (productId: string) => {
    if (activeIds.has(productId)) {
      const cycleStart = activePath.indexOf(productId);
      activePath.slice(cycleStart).forEach((id) => cycleProductIds.add(id));
      cycleProductIds.add(productId);
      return;
    }
    if (visited.has(productId)) return;
    activePath.push(productId);
    activeIds.add(productId);
    for (const edge of childrenByProductId.get(productId) ?? []) visit(edge.childProductId);
    activePath.pop();
    activeIds.delete(productId);
    visited.add(productId);
  };
  products.forEach((product) => visit(product.id));

  let roots = products.filter((product) => !parentIdsByProductId.has(product.id));
  const reachableFromRoots = new Set<string>();
  const markReachable = (productId: string) => {
    if (reachableFromRoots.has(productId)) return;
    reachableFromRoots.add(productId);
    for (const edge of childrenByProductId.get(productId) ?? []) markReachable(edge.childProductId);
  };
  roots.forEach((product) => markReachable(product.id));
  products.forEach((product) => {
    if (!reachableFromRoots.has(product.id)) {
      roots.push(product);
      markReachable(product.id);
    }
  });

  const sharedProductIds = new Set(
    [...parentIdsByProductId.entries()]
      .filter(([, parentIds]) => parentIds.size > 1)
      .map(([productId]) => productId),
  );
  const orphanProductIds = new Set(
    products
      .filter((product) => !childrenByProductId.has(product.id) && !parentIdsByProductId.has(product.id))
      .map((product) => product.id),
  );

  return {
    products,
    roots,
    childrenByProductId,
    parentProductIds: new Set(parentIdsByProductId.keys()),
    sharedProductIds,
    orphanProductIds,
    cycleProductIds,
  };
}

export type AnalysisContext = {
  elementIds: Set<string>;
  relationshipIds: Set<string>;
};

export function getAnalysisContext(
  model: PprModel,
  selectedElementIds: Set<string>,
  selectedRelationshipIds: Set<string>,
): AnalysisContext {
  const elementIds = new Set(selectedElementIds);
  const relationshipIds = new Set<string>();

  getModelRelationships(model).forEach((relationship) => {
    const isSelected = selectedRelationshipIds.has(relationship.id);
    const touchesSelectedElement =
      selectedElementIds.has(relationship.source_id) ||
      selectedElementIds.has(relationship.target_id);

    if (!isSelected && !touchesSelectedElement) return;

    relationshipIds.add(relationship.id);
    elementIds.add(relationship.source_id);
    elementIds.add(relationship.target_id);
  });

  return { elementIds, relationshipIds };
}
