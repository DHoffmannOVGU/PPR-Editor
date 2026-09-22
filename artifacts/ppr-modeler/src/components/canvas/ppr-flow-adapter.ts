import type { Edge, Node } from '@xyflow/react';
import type {
  PprElement,
  PprModel,
  PprRelationship,
} from '@workspace/api-client-react';
import {
  getElementMap,
  getModelRelationships,
  getModelUsages,
  getRelationshipProblem,
  getResourceAncestorIds,
  getResourceTree,
  type RelationshipProblem,
} from '../review/analysis-utils';

export type PprModelNodeData = {
  element: PprElement;
  onRename?: (elementId: string, name: string) => void;
  onEndRename?: () => void;
  isRenaming?: boolean;
  perspective?: import('./ppr-perspective').PprCanvasPerspective;
  isProcessContainer?: boolean;
  containedProcessCount?: number;
  parentProcessId?: string;
  isResourceContainer?: boolean;
  containedResourceCount?: number;
  parentResourceId?: string;
  isContext?: boolean;
  isFocusMode?: boolean;
  remoteSelections?: PprRemoteSelection[];
};

export type MissingEndpointNodeData = {
  endpointId: string;
  endpoint: 'source' | 'target';
  relationshipId: string;
  isContext?: boolean;
  isFocusMode?: boolean;
};

export type PprModelNode = Node<PprModelNodeData, 'pprNode'>;
export type MissingEndpointNode = Node<MissingEndpointNodeData, 'missingEndpoint'>;
export type PprFlowNode = PprModelNode | MissingEndpointNode;

export type PprEdgeData = {
  relationship: PprRelationship;
  label?: string;
  isDerived?: boolean;
  isProductAssembly?: boolean;
  isProductState?: boolean;
  relatedElementId?: string;
  problem?: RelationshipProblem;
  isContext?: boolean;
  isFocusMode?: boolean;
  remoteSelections?: PprRemoteSelection[];
  showLabel?: boolean;
  onDelete?: (relationshipId: string) => void;
  onSelect?: (relationshipId: string) => void;
};

export type PprFlowEdge = Edge<PprEdgeData, 'pprEdge'>;

export type PprRemoteSelection = {
  participantId: string;
  name: string;
  color: string;
};

export type PprAlignmentGuide = {
  axis: 'vertical' | 'horizontal';
  coordinate: number;
  draggedAnchor: 'start' | 'center' | 'end';
  matchedAnchor: 'start' | 'center' | 'end';
  matchedNodeId: string;
  distance: number;
};

export type PprNodePosition = {
  x: number;
  y: number;
};

export type PprFlowNodeLayout = {
  parentByElementId?: Map<string, string>;
  containerDimensions?: Map<string, { width: number; height: number }>;
  containerKinds?: Map<string, 'process' | 'resource'>;
};

export type PprNodeAlignment =
  | 'left'
  | 'center-horizontal'
  | 'right'
  | 'top'
  | 'center-vertical'
  | 'bottom'
  | 'distribute-horizontal'
  | 'distribute-vertical';

export type PprRelationshipHandles = {
  sourceHandle?: string;
  targetHandle?: string;
};

const PPR_SPINE_X = 420;
const PPR_SPINE_START_Y = 80;
const PPR_SPINE_GAP_Y = 210;
const PPR_LAYER_GAP_X = 320;
const RESOURCE_GAP_Y = 160;
const RESOURCE_X_OFFSET = 340;

export const PPR_DENSE_GRAPH_NODE_THRESHOLD = 100;
export const PPR_DENSE_GRAPH_RELATIONSHIP_THRESHOLD = 150;
export const PPR_FLOW_NODE_WIDTH = 240;
export const PPR_FLOW_NODE_HEIGHT = 120;
export const PPR_ALIGNMENT_GUIDE_TOLERANCE = 6;

/**
 * Convert the screen-space snap distance to flow coordinates.
 * React Flow positions and alignment guides live inside the zoomed viewport,
 * so keeping this value in flow units would make snapping feel inconsistent.
 */
export function getAlignmentGuideTolerance(zoom: number, screenTolerance = PPR_ALIGNMENT_GUIDE_TOLERANCE) {
  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  return screenTolerance / safeZoom;
}

type FlowNodeAnchor = {
  anchor: PprAlignmentGuide['draggedAnchor'];
  coordinate: number;
};

function getMeasuredDimension(value: number | undefined, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

function getNodeAnchors(node: PprModelNode, axis: PprAlignmentGuide['axis']): FlowNodeAnchor[] {
  const dimension = axis === 'vertical'
    ? getMeasuredDimension(node.measured?.width ?? node.width, PPR_FLOW_NODE_WIDTH)
    : getMeasuredDimension(node.measured?.height ?? node.height, PPR_FLOW_NODE_HEIGHT);
  const start = axis === 'vertical' ? node.position.x : node.position.y;
  return [
    { anchor: 'start', coordinate: start },
    { anchor: 'center', coordinate: start + dimension / 2 },
    { anchor: 'end', coordinate: start + dimension },
  ];
}

/**
 * Find nearby center alignments for a node being dragged.
 * This is intentionally a pure projection over rendered nodes; it never
 * mutates or persists canonical element positions.
 */
export function getAlignmentGuides(
  draggedNode: PprModelNode,
  renderedNodes: PprFlowNode[],
  tolerance = PPR_ALIGNMENT_GUIDE_TOLERANCE,
): PprAlignmentGuide[] {
  const candidates = renderedNodes
    .filter((node): node is PprModelNode =>
      node.type === 'pprNode' && node.id !== draggedNode.id && !node.hidden,
    );
  const guides: PprAlignmentGuide[] = [];
  const anchorOrder = { start: 0, center: 1, end: 2 };

  (['vertical', 'horizontal'] as const).forEach((axis) => {
    const draggedAnchors = getNodeAnchors(draggedNode, axis);
    const targetAnchors = candidates.flatMap((node) =>
      getNodeAnchors(node, axis)
        .filter((target) => target.anchor === 'center')
        .map((target) => ({ ...target, nodeId: node.id })),
    );

    draggedAnchors
      .filter((draggedAnchor) => draggedAnchor.anchor === 'center')
      .forEach((draggedAnchor) => {
        const match = targetAnchors
          .map((target) => ({
            ...target,
            distance: Math.abs(draggedAnchor.coordinate - target.coordinate),
          }))
          .filter((target) => target.distance <= tolerance)
          .sort((left, right) =>
            left.distance - right.distance
            || left.nodeId.localeCompare(right.nodeId)
            || anchorOrder[left.anchor] - anchorOrder[right.anchor],
          )[0];
        if (!match) return;

        guides.push({
          axis,
          coordinate: match.coordinate,
          draggedAnchor: draggedAnchor.anchor,
          matchedAnchor: match.anchor,
          matchedNodeId: match.nodeId,
          distance: match.distance,
        });
      });
  });

  const uniqueGuides = new Map<string, PprAlignmentGuide>();
  guides.forEach((guide) => {
    const key = `${guide.axis}:${guide.coordinate}`;
    const existing = uniqueGuides.get(key);
    if (
      !existing
      || guide.distance < existing.distance
      || (
        guide.distance === existing.distance
        && `${guide.matchedNodeId}:${anchorOrder[guide.matchedAnchor]}`
          < `${existing.matchedNodeId}:${anchorOrder[existing.matchedAnchor]}`
      )
    ) {
      uniqueGuides.set(key, guide);
    }
  });

  return [...uniqueGuides.values()].sort((left, right) =>
    left.axis.localeCompare(right.axis)
    || left.coordinate - right.coordinate
    || left.matchedNodeId.localeCompare(right.matchedNodeId),
  );
}

export function getSnappedNodePosition(
  draggedNode: PprModelNode,
  guides: PprAlignmentGuide[],
): PprNodePosition {
  const width = getMeasuredDimension(draggedNode.measured?.width ?? draggedNode.width, PPR_FLOW_NODE_WIDTH);
  const height = getMeasuredDimension(draggedNode.measured?.height ?? draggedNode.height, PPR_FLOW_NODE_HEIGHT);
  const verticalGuide = guides.find((guide) => guide.axis === 'vertical');
  const horizontalGuide = guides.find((guide) => guide.axis === 'horizontal');

  return {
    x: verticalGuide ? verticalGuide.coordinate - width / 2 : draggedNode.position.x,
    y: horizontalGuide ? horizontalGuide.coordinate - height / 2 : draggedNode.position.y,
  };
}

export type PprFlowRenderProfile = {
  isDense: boolean;
  showEdgeLabels: boolean;
  showMiniMap: boolean;
  allowSelectionOnDrag: boolean;
};

export function getPprFlowRenderProfile(
  nodeCount: number,
  relationshipCount: number,
): PprFlowRenderProfile {
  const isDense =
    nodeCount > PPR_DENSE_GRAPH_NODE_THRESHOLD ||
    relationshipCount > PPR_DENSE_GRAPH_RELATIONSHIP_THRESHOLD;

  return {
    isDense,
    // Label DOM is the most expensive optional part of a relationship-heavy
    // canvas. Selected/problem edges still opt in to keep the graph usable.
    showEdgeLabels: !isDense,
    // The minimap subscribes to every node and edge movement. It is useful for
    // normal models, but competes with navigation once the graph is dense.
    showMiniMap: !isDense,
    // Box selection can touch every visible node on each pointer move. Click
    // selection remains available in dense mode while drag stays a pan.
    allowSelectionOnDrag: !isDense,
  };
}

export function getAlignedNodePositions(
  nodes: PprFlowNode[],
  selectedElementIds: Set<string>,
  alignment: PprNodeAlignment,
): Map<string, PprNodePosition> {
  const selectedNodes = nodes
    .filter((node): node is PprModelNode => node.type === 'pprNode' && selectedElementIds.has(node.id))
    .sort((left, right) => left.position.x - right.position.x || left.position.y - right.position.y || left.id.localeCompare(right.id));
  const positions = new Map<string, PprNodePosition>();
  if (selectedNodes.length < 2) return positions;

  const setPosition = (node: PprModelNode, position: PprNodePosition) => {
    positions.set(node.id, position);
  };
  if (alignment === 'left') {
    const x = Math.min(...selectedNodes.map((node) => node.position.x));
    selectedNodes.forEach((node) => setPosition(node, { x, y: node.position.y }));
  } else if (alignment === 'center-horizontal') {
    const x = selectedNodes.reduce((sum, node) => sum + node.position.x, 0) / selectedNodes.length;
    selectedNodes.forEach((node) => setPosition(node, { x, y: node.position.y }));
  } else if (alignment === 'right') {
    const x = Math.max(...selectedNodes.map((node) => node.position.x));
    selectedNodes.forEach((node) => setPosition(node, { x, y: node.position.y }));
  } else if (alignment === 'top') {
    const y = Math.min(...selectedNodes.map((node) => node.position.y));
    selectedNodes.forEach((node) => setPosition(node, { x: node.position.x, y }));
  } else if (alignment === 'center-vertical') {
    const y = selectedNodes.reduce((sum, node) => sum + node.position.y, 0) / selectedNodes.length;
    selectedNodes.forEach((node) => setPosition(node, { x: node.position.x, y }));
  } else if (alignment === 'bottom') {
    const y = Math.max(...selectedNodes.map((node) => node.position.y));
    selectedNodes.forEach((node) => setPosition(node, { x: node.position.x, y }));
  } else {
    const isHorizontal = alignment === 'distribute-horizontal';
    const orderedNodes = selectedNodes.slice().sort((left, right) =>
      (isHorizontal ? left.position.x - right.position.x : left.position.y - right.position.y)
      || (isHorizontal ? left.position.y - right.position.y : left.position.x - right.position.x)
      || left.id.localeCompare(right.id),
    );
    const start = isHorizontal ? orderedNodes[0].position.x : orderedNodes[0].position.y;
    const end = isHorizontal
      ? orderedNodes[orderedNodes.length - 1].position.x
      : orderedNodes[orderedNodes.length - 1].position.y;
    const step = (end - start) / (orderedNodes.length - 1);
    orderedNodes.forEach((node, index) => {
      setPosition(node, isHorizontal
        ? { x: start + step * index, y: node.position.y }
        : { x: node.position.x, y: start + step * index });
    });
  }
  return positions;
}

export function getAutoLayoutPositions(model: PprModel): Map<string, PprNodePosition> {
  const usages = getModelUsages(model);
  const flowElements = usages
    .filter((element) => element.type !== 'resource')
    .sort(compareLayoutElements);
  const resources = usages
    .filter((element) => element.type === 'resource')
    .sort(compareLayoutElements);
  const positions = new Map<string, PprNodePosition>();
  const resourceGroups = new Map<string, PprElement[]>();
  const resourceAssignments = new Map<string, string>();

  const layers = getSemanticFlowLayers(model, flowElements);
  layers.forEach((elements, layer) => {
    const center = (elements.length - 1) / 2;
    elements.forEach((element, index) => {
      positions.set(element.id, {
        // Parallel branches share a semantic layer but use stable horizontal
        // lanes instead of being ordered by the usages array.
        x: PPR_SPINE_X + (index - center) * PPR_LAYER_GAP_X,
        y: PPR_SPINE_START_Y + layer * PPR_SPINE_GAP_Y,
      });
    });
  });

  const elementsById = new Map(usages.map((element) => [element.id, element]));
  getModelRelationships(model)
    .slice()
    .sort((left, right) => left.id.localeCompare(right.id))
    .forEach((relationship) => {
      const source = elementsById.get(relationship.source_id);
      const target = elementsById.get(relationship.target_id);
      if (
        relationship.kind === 'performs' &&
        source?.type === 'resource' &&
        target?.type === 'process'
      ) {
        const currentProcessId = resourceAssignments.get(source.id);
        // A shared resource is rendered once, beside the lexically first
        // assigned process, keeping placement independent of relationship order.
        if (!currentProcessId || target.id.localeCompare(currentProcessId) < 0) {
          resourceAssignments.set(source.id, target.id);
        }
      }
    });

  resources.forEach((resource) => {
    const processId = resourceAssignments.get(resource.id);
    if (!processId) return;
    const group = resourceGroups.get(processId) ?? [];
    group.push(resource);
    resourceGroups.set(processId, group);
  });

  const flowXValues = [...positions.values()].map((position) => position.x);
  const resourceColumnX = (flowXValues.length > 0 ? Math.max(...flowXValues) : PPR_SPINE_X) + RESOURCE_X_OFFSET;
  const occupiedResourceYs: number[] = [];
  const positionResource = (resource: PprElement, desiredY: number) => {
    let y = desiredY;
    while (occupiedResourceYs.some((occupiedY) => Math.abs(occupiedY - y) < RESOURCE_GAP_Y)) {
      y += RESOURCE_GAP_Y;
    }
    positions.set(resource.id, { x: resourceColumnX, y });
    occupiedResourceYs.push(y);
  };

  const sortedResourceGroups = [...resourceGroups.entries()].sort(([leftId], [rightId]) => {
    const leftPosition = positions.get(leftId);
    const rightPosition = positions.get(rightId);
    return (leftPosition?.y ?? Number.MAX_SAFE_INTEGER) - (rightPosition?.y ?? Number.MAX_SAFE_INTEGER)
      || (leftPosition?.x ?? Number.MAX_SAFE_INTEGER) - (rightPosition?.x ?? Number.MAX_SAFE_INTEGER)
      || leftId.localeCompare(rightId);
  });
  sortedResourceGroups.forEach(([processId, group]) => {
    const processPosition = positions.get(processId);
    if (!processPosition) return;
    const sortedGroup = group.slice().sort(compareLayoutElements);
    sortedGroup.forEach((resource, index) => {
      positionResource(
        resource,
        processPosition.y + (index - (sortedGroup.length - 1) / 2) * RESOURCE_GAP_Y,
      );
    });
  });

  resources
    .filter((resource) => !positions.has(resource.id))
    .forEach((resource, index) => {
      positionResource(resource, PPR_SPINE_START_Y + index * RESOURCE_GAP_Y);
    });

  return positions;
}

function compareLayoutElements(left: PprElement, right: PprElement) {
  return left.id.localeCompare(right.id)
    || left.type.localeCompare(right.type)
    || left.name.localeCompare(right.name);
}

type SemanticFlowEdge = {
  sourceId: string;
  targetId: string;
};

function getSemanticFlowEdges(model: PprModel, elementsById: Map<string, PprElement>): SemanticFlowEdge[] {
  return getModelRelationships(model)
    .map((relationship) => {
      const source = elementsById.get(relationship.source_id);
      const target = elementsById.get(relationship.target_id);
      if (!source || !target) return null;

      const isInput = relationship.kind === 'consumed_by'
        && source.type === 'product'
        && target.type === 'process';
      const isOutput = relationship.kind === 'produces'
        && source.type === 'process'
        && target.type === 'product';
      const isSuccession = relationship.kind === 'succeeds'
        && source.type === 'process'
        && target.type === 'process';
      return isInput || isOutput || isSuccession
        ? { sourceId: source.id, targetId: target.id }
        : null;
    })
    .filter((edge): edge is SemanticFlowEdge => Boolean(edge));
}

/**
 * Rank flow nodes from upstream to downstream. Strongly connected nodes share
 * a layer when a model contains a cycle; the horizontal lane fallback keeps
 * those nodes deterministic without pretending the cycle has a direction.
 */
function getSemanticFlowLayers(model: PprModel, flowElements: PprElement[]): Map<number, PprElement[]> {
  const elementsById = new Map(flowElements.map((element) => [element.id, element]));
  const elementIds = flowElements.map((element) => element.id);
  const adjacency = new Map<string, string[]>(
    elementIds.map((elementId) => [elementId, []]),
  );
  const reverseAdjacency = new Map<string, string[]>(
    elementIds.map((elementId) => [elementId, []]),
  );

  getSemanticFlowEdges(model, elementsById).forEach(({ sourceId, targetId }) => {
    adjacency.get(sourceId)?.push(targetId);
    reverseAdjacency.get(targetId)?.push(sourceId);
  });
  adjacency.forEach((targets) => targets.sort());
  reverseAdjacency.forEach((sources) => sources.sort());

  // Kosaraju's algorithm condenses cycles into deterministic components before
  // the DAG is ranked. This gives disconnected and cyclic models a defined
  // fallback rather than relying on traversal or array insertion order.
  const visited = new Set<string>();
  const finishOrder: string[] = [];
  const visitForward = (elementId: string) => {
    if (visited.has(elementId)) return;
    visited.add(elementId);
    adjacency.get(elementId)?.forEach(visitForward);
    finishOrder.push(elementId);
  };
  elementIds.slice().sort().forEach(visitForward);

  const componentByElementId = new Map<string, number>();
  const components: string[][] = [];
  const visitReverse = (elementId: string, component: string[]) => {
    if (componentByElementId.has(elementId)) return;
    componentByElementId.set(elementId, components.length);
    component.push(elementId);
    reverseAdjacency.get(elementId)?.forEach((sourceId) => visitReverse(sourceId, component));
  };
  finishOrder.slice().reverse().forEach((elementId) => {
    if (componentByElementId.has(elementId)) return;
    const component: string[] = [];
    visitReverse(elementId, component);
    component.sort();
    components.push(component);
  });

  const componentTargets = components.map(() => new Set<number>());
  const componentIndegrees = components.map(() => 0);
  adjacency.forEach((targets, sourceId) => {
    const sourceComponent = componentByElementId.get(sourceId);
    if (sourceComponent === undefined) return;
    targets.forEach((targetId) => {
      const targetComponent = componentByElementId.get(targetId);
      if (targetComponent === undefined || targetComponent === sourceComponent) return;
      if (componentTargets[sourceComponent].has(targetComponent)) return;
      componentTargets[sourceComponent].add(targetComponent);
      componentIndegrees[targetComponent] += 1;
    });
  });

  const componentRanks = components.map(() => 0);
  const queue = components
    .map((members, index) => ({ index, key: members[0] }))
    .filter(({ index }) => componentIndegrees[index] === 0);
  const sortQueue = () => queue.sort((left, right) => left.key.localeCompare(right.key));
  sortQueue();
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    [...componentTargets[current.index]]
      .sort((left, right) => components[left][0].localeCompare(components[right][0]))
      .forEach((targetIndex) => {
        componentRanks[targetIndex] = Math.max(
          componentRanks[targetIndex],
          componentRanks[current.index] + 1,
        );
        componentIndegrees[targetIndex] -= 1;
        if (componentIndegrees[targetIndex] === 0) queue.push({
          index: targetIndex,
          key: components[targetIndex][0],
        });
      });
    sortQueue();
  }

  const layers = new Map<number, PprElement[]>();
  flowElements.forEach((element) => {
    const componentIndex = componentByElementId.get(element.id);
    const layer = componentIndex === undefined ? 0 : componentRanks[componentIndex];
    const layerElements = layers.get(layer) ?? [];
    layerElements.push(element);
    layers.set(layer, layerElements);
  });
  layers.forEach((elements) => elements.sort(compareLayoutElements));
  return layers;
}

export function getVisibleResourceIds(
  model: PprModel,
  expandedResourceIds: Set<string> = new Set(),
  selectedResourceIds: Set<string> = new Set(),
) {
  const tree = getResourceTree(model);
  const resourceIds = new Set(tree.resources.map((resource) => resource.id));
  const visible = new Set<string>();
  const addWithAncestors = (resourceId: string) => {
    if (!resourceIds.has(resourceId) || visible.has(resourceId)) return;
    visible.add(resourceId);
    getResourceAncestorIds(tree, resourceId).forEach((ancestorId) => visible.add(ancestorId));
  };

  tree.processLinkedResourceIds.forEach(addWithAncestors);
  selectedResourceIds.forEach(addWithAncestors);

  let changed = true;
  while (changed) {
    changed = false;
    [...visible].forEach((resourceId) => {
      if (!expandedResourceIds.has(resourceId)) return;
      for (const edge of tree.childrenByResourceId.get(resourceId) ?? []) {
        if (visible.has(edge.childResourceId)) continue;
        visible.add(edge.childResourceId);
        changed = true;
      }
    });
  }

  return visible;
}

export function getRelationshipHandles(
  source: PprElement | undefined,
  target: PprElement | undefined,
): PprRelationshipHandles {
  if (!source || !target) {
    return {
      sourceHandle: source ? (source.type === 'resource' ? 'source-right' : 'source-bottom') : undefined,
      targetHandle: target ? (target.type === 'resource' ? 'target-left' : 'target-top') : undefined,
    };
  }

  const sourceHandle =
    source.type === 'resource'
      ? 'source-right'
      : source.type === 'process' && target.type === 'resource'
        ? 'source-right'
        : 'source-bottom';
  const targetHandle =
    target.type === 'resource'
      ? 'target-left'
      : target.type === 'process' && source.type === 'resource'
        ? 'target-left'
        : 'target-top';

  return { sourceHandle, targetHandle };
}

function isResourceProcessRelationship(
  relationship: PprRelationship,
  source: PprElement | undefined,
  target: PprElement | undefined,
) {
  return (
    relationship.kind === 'performs' &&
    source?.type === 'resource' &&
    target?.type === 'process'
  );
}

export function missingEndpointNodeId(endpoint: 'source' | 'target', endpointId: string) {
  return `missing-${endpoint}-${encodeURIComponent(endpointId)}`;
}

function createMissingEndpointNode(
  relationship: PprRelationship,
  endpoint: 'source' | 'target',
  position: { x: number; y: number },
  contextRelationshipIds: Set<string>,
): MissingEndpointNode {
  const endpointId = endpoint === 'source' ? relationship.source_id : relationship.target_id;
  return {
    id: missingEndpointNodeId(endpoint, endpointId),
    type: 'missingEndpoint',
    position,
    data: {
      endpointId,
      endpoint,
      relationshipId: relationship.id,
      isContext: contextRelationshipIds.has(relationship.id),
      isFocusMode: contextRelationshipIds.size > 0,
    },
    draggable: false,
    selectable: false,
    connectable: false,
  };
}

export function modelToFlowNodes(
  model: PprModel,
  selectedElementIds: Set<string>,
  contextElementIds = new Set<string>(),
  contextRelationshipIds = new Set<string>(),
  visibleElementIds?: Set<string>,
  remoteSelectionsByElementId = new Map<string, PprRemoteSelection[]>(),
  layout?: PprFlowNodeLayout,
): PprFlowNode[] {
  const elementsById = getElementMap(model);
  const visibleElements = getModelUsages(model)
    .filter((element) => !visibleElementIds || element.type !== 'resource' || visibleElementIds.has(element.id));
  const parentByElementId = layout?.parentByElementId;
  const getParentDepth = (elementId: string) => {
    let depth = 0;
    let currentId = elementId;
    const visited = new Set<string>();
    while (parentByElementId?.has(currentId) && !visited.has(currentId)) {
      visited.add(currentId);
      currentId = parentByElementId.get(currentId) ?? currentId;
      depth += 1;
    }
    return depth;
  };
  const nodes: PprFlowNode[] = visibleElements
    .slice()
    .sort((left, right) =>
      getParentDepth(left.id) - getParentDepth(right.id)
      || left.id.localeCompare(right.id),
    )
    .map((element) => ({
      id: element.id,
      type: 'pprNode',
      position: (() => {
        const parentId = parentByElementId?.get(element.id);
        const parent = parentId ? elementsById.get(parentId) : undefined;
        return parent
          ? { x: element.x - parent.x, y: element.y - parent.y }
          : { x: element.x, y: element.y };
      })(),
      ...(parentByElementId?.has(element.id)
        ? {
            parentId: parentByElementId.get(element.id),
            extent: 'parent' as const,
            zIndex: 1,
          }
        : {}),
      ...(layout?.containerDimensions?.get(element.id)
        ? { style: layout.containerDimensions.get(element.id) }
        : {}),
      data: {
        element,
        isProcessContainer: layout?.containerKinds?.get(element.id) === 'process'
          || (!layout?.containerKinds && Boolean(layout?.containerDimensions?.has(element.id))),
        containedProcessCount: [...(parentByElementId?.entries() ?? [])]
          .filter(([, parentId]) => parentId === element.id).length,
        parentProcessId: parentByElementId?.get(element.id),
        isResourceContainer: layout?.containerKinds?.get(element.id) === 'resource',
        containedResourceCount: [...(parentByElementId?.entries() ?? [])]
          .filter(([, parentId]) => parentId === element.id)
          .filter(([childId]) => elementsById.get(childId)?.type === 'resource').length,
        parentResourceId: parentByElementId?.get(element.id),
        isContext: contextElementIds.has(element.id),
        isFocusMode: contextElementIds.size > 0 || contextRelationshipIds.size > 0,
        remoteSelections: remoteSelectionsByElementId.get(element.id),
      },
      selected: selectedElementIds.has(element.id),
    }));
  const missingNodes = new Map<string, MissingEndpointNode>();

  getModelRelationships(model).forEach((relationship, index) => {
    const source = elementsById.get(relationship.source_id);
    const target = elementsById.get(relationship.target_id);
    if (
      visibleElementIds &&
      ((source?.type === 'resource' && !visibleElementIds.has(source.id)) ||
        (target?.type === 'resource' && !visibleElementIds.has(target.id)))
    ) {
      return;
    }

    if (!source) {
      const id = missingEndpointNodeId('source', relationship.source_id);
      if (!missingNodes.has(id)) {
        missingNodes.set(
          id,
          createMissingEndpointNode(relationship, 'source', {
            x: (target?.x ?? 120) - 340,
            y: target?.y ?? 120 + index * 150,
          }, contextRelationshipIds),
        );
      }
    }

    if (!target) {
      const id = missingEndpointNodeId('target', relationship.target_id);
      if (!missingNodes.has(id)) {
        missingNodes.set(
          id,
          createMissingEndpointNode(relationship, 'target', {
            x: (source?.x ?? 120) + 340,
            y: source?.y ?? 120 + index * 150,
          }, contextRelationshipIds),
        );
      }
    }
  });

  return [...nodes, ...missingNodes.values()];
}

export function modelToFlowEdges(
  model: PprModel,
  selectedRelationshipIds: Set<string>,
  onDeleteRelationship?: (relationshipId: string) => void,
  onSelectRelationship?: (relationshipId: string) => void,
  showEdgeLabels = true,
  contextRelationshipIds = new Set<string>(),
  contextElementIds = new Set<string>(),
  visibleElementIds?: Set<string>,
  remoteSelectionsByRelationshipId = new Map<string, PprRemoteSelection[]>(),
): PprFlowEdge[] {
  const elementsById = getElementMap(model);

  return getModelRelationships(model)
    .filter((relationship) => {
      if (!visibleElementIds) return true;
      const source = elementsById.get(relationship.source_id);
      const target = elementsById.get(relationship.target_id);
      return !(
        (source?.type === 'resource' && !visibleElementIds.has(source.id)) ||
        (target?.type === 'resource' && !visibleElementIds.has(target.id))
      );
    })
    .map((relationship) => {
      const sourceElement = elementsById.get(relationship.source_id);
      const targetElement = elementsById.get(relationship.target_id);
      const relationshipProblem = getRelationshipProblem(relationship, elementsById);
      const problem = relationshipProblem?.title === 'Outside process review' ? undefined : relationshipProblem;
      const renderResourceProcessEdgeReversed = isResourceProcessRelationship(relationship, sourceElement, targetElement);
      const flowSource = renderResourceProcessEdgeReversed ? targetElement : sourceElement;
      const flowTarget = renderResourceProcessEdgeReversed ? sourceElement : targetElement;
      const { sourceHandle, targetHandle } = getRelationshipHandles(flowSource, flowTarget);
      const flowSourceId = renderResourceProcessEdgeReversed ? relationship.target_id : relationship.source_id;
      const flowTargetId = renderResourceProcessEdgeReversed ? relationship.source_id : relationship.target_id;
      return {
        id: relationship.id,
        type: 'pprEdge',
        source: elementsById.has(flowSourceId)
          ? flowSourceId
          : missingEndpointNodeId('source', flowSourceId),
        target: elementsById.has(flowTargetId)
          ? flowTargetId
          : missingEndpointNodeId('target', flowTargetId),
        sourceHandle,
        targetHandle,
        selected: selectedRelationshipIds.has(relationship.id),
        data: {
          relationship,
          isProductAssembly:
            relationship.kind === 'contains' &&
            sourceElement?.type === 'product' &&
            targetElement?.type === 'product',
          isProductState:
            relationship.kind === 'becomes' &&
            sourceElement?.type === 'product' &&
            targetElement?.type === 'product',
          problem,
          isContext: contextRelationshipIds.has(relationship.id),
          isFocusMode: contextElementIds.size > 0 || contextRelationshipIds.size > 0,
          remoteSelections: remoteSelectionsByRelationshipId.get(relationship.id),
          showLabel:
            showEdgeLabels ||
            selectedRelationshipIds.has(relationship.id) ||
            contextRelationshipIds.has(relationship.id) ||
            Boolean(remoteSelectionsByRelationshipId.get(relationship.id)?.length) ||
            Boolean(problem),
          onDelete: onDeleteRelationship,
          onSelect: onSelectRelationship,
        },
    };
    });
}
