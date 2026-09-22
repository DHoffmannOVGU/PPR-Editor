import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  ViewportPortal,
  useViewport,
  useNodesState,
  useReactFlow,
  type Connection,
  type NodeChange,
  type OnConnectEnd,
  type OnConnectStart,
  type OnNodeDrag,
  type OnSelectionChangeParams,
  type Viewport,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { ElementInput, ElementUpdate, PprElement, PprModel, RelationshipInput } from '@workspace/api-client-react';
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalDistributeCenter,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalDistributeCenter,
  Loader2,
  Maximize2,
  Network,
  MousePointer2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { COLLABORATION_SURFACE_LABELS, type CollaborationCursor, type CollaborationParticipant } from '@/hooks/use-collaboration';
import { CreateRelationshipDialog } from '../dialogs/create-relationship-dialog';
import { getSupportedRelationshipKinds } from '../review/analysis-utils';
import { MissingEndpointNode, PprNode } from './ppr-node';
import { PprEdge } from './ppr-edge';
import {
  modelToFlowEdges,
  modelToFlowNodes,
  getAlignedNodePositions,
  getAlignmentGuideTolerance,
  getAlignmentGuides,
  getAutoLayoutPositions,
  getPprFlowRenderProfile,
  getSnappedNodePosition,
  type PprAlignmentGuide,
  type PprModelNode,
  type PprNodePosition,
  type PprNodeAlignment,
  type PprFlowEdge,
  type PprFlowNode,
  type PprRemoteSelection,
} from './ppr-flow-adapter';
import {
  getPprCanvasLayoutKey,
  getPprPerspectiveProjection,
  type PprCanvasLayoutKey,
  type PprCanvasLayoutPositions,
  type PprCanvasPerspective,
  type PprProductViewMode,
  type PprResourceViewMode,
} from './ppr-perspective';
import { getIndividualViewRelationshipKind, getQuickConnectionSpec } from './ppr-editing';

interface PprCanvasProps {
  model: PprModel | undefined;
  isLoading: boolean;
  perspective?: PprCanvasPerspective;
  productViewMode?: PprProductViewMode;
  onProductViewModeChange?: (mode: PprProductViewMode) => void;
  resourceViewMode?: PprResourceViewMode;
  onResourceViewModeChange?: (mode: PprResourceViewMode) => void;
  pprLevel?: number;
  onPprLevelChange?: (level: number) => void;
  collapseItemStates?: boolean;
  onCollapseItemStatesChange?: (collapsed: boolean) => void;
  onUpdateElement: (id: string, updates: ElementUpdate) => void;
  onDeleteElement: (id: string) => void;
  onCreateElement: (data: ElementInput, onSuccess?: (element: PprElement) => void) => void;
  onCreateRelationship: (data: RelationshipInput) => void;
  onRequestMerge: (firstId: string, secondId: string) => void;
  onDeleteRelationship: (id: string) => void;
  selectedElementIds: Set<string>;
  selectedRelationshipIds: Set<string>;
  contextElementIds: Set<string>;
  contextRelationshipIds: Set<string>;
  onSelectElements: (ids: Set<string>) => void;
  onSelectRelationships: (ids: Set<string>) => void;
  onBackgroundClick: () => void;
  remoteParticipants: CollaborationParticipant[];
  onCursorMove: (cursor: CollaborationCursor | null) => void;
  savedViewport?: Viewport;
  onViewportChange?: (perspective: PprCanvasPerspective, viewport: Viewport) => void;
  layoutPositions?: PprCanvasLayoutPositions;
  onLayoutPositionsChange?: (
    layoutKey: PprCanvasLayoutKey,
    positions: PprCanvasLayoutPositions,
  ) => void;
}

const nodeTypes = {
  pprNode: PprNode,
  missingEndpoint: MissingEndpointNode,
};

const edgeTypes = {
  pprEdge: PprEdge,
};

const PERSPECTIVE_TRANSITION_DURATION = 500;
const easeInOutCubic = (progress: number) => progress < 0.5
  ? 4 * progress * progress * progress
  : 1 - Math.pow(-2 * progress + 2, 3) / 2;

function getPprMiniMapNodeColor(node: PprFlowNode) {
  if (node.type === 'missingEndpoint') return 'hsl(var(--accent))';
  if (node.type !== 'pprNode') return 'hsl(var(--muted-foreground))';
  const element = (node.data as { element: { type: string } }).element;
  return `hsl(var(--ppr-${element.type}))`;
}

function setsHaveSameValues(left: Set<string>, right: Set<string>) {
  if (left.size !== right.size) return false;
  for (const value of left) {
    if (!right.has(value)) return false;
  }
  return true;
}

function getRelationshipEndpoints(sourceElement: PprElement, targetElement: PprElement) {
  const isVisualResourceProcessConnection =
    sourceElement.type === 'process' && targetElement.type === 'resource';
  return isVisualResourceProcessConnection
    ? { sourceElement: targetElement, targetElement: sourceElement }
    : { sourceElement, targetElement };
}

function getPointerClientPosition(event: MouseEvent | TouchEvent) {
  if ('clientX' in event) return { x: event.clientX, y: event.clientY };
  const touch = event.changedTouches[0] ?? event.touches[0];
  return touch ? { x: touch.clientX, y: touch.clientY } : null;
}

function getParticipantCursorColor(id: string) {
  let hash = 0;
  for (const character of id) hash = (hash * 31 + character.charCodeAt(0)) | 0;
  return `hsl(${Math.abs(hash) % 360} 78% 46%)`;
}

function PprFlowCanvas({
  model,
  isLoading,
  perspective = 'ppr',
  productViewMode = 'ppr',
  onProductViewModeChange,
  resourceViewMode = 'contains',
  onResourceViewModeChange,
  pprLevel = 0,
  onPprLevelChange,
  collapseItemStates = false,
  onCollapseItemStatesChange,
  onUpdateElement,
  onDeleteElement,
  onCreateElement,
  onCreateRelationship,
  onRequestMerge,
  onDeleteRelationship,
  selectedElementIds,
  selectedRelationshipIds,
  contextElementIds,
  contextRelationshipIds,
  onSelectElements,
  onSelectRelationships,
  onBackgroundClick,
  remoteParticipants,
  onCursorMove,
  savedViewport,
  onViewportChange,
  layoutPositions,
  onLayoutPositionsChange,
}: PprCanvasProps) {
  const { fitView, screenToFlowPosition, setViewport } = useReactFlow<PprFlowNode, PprFlowEdge>();
  const { zoom } = useViewport();
  const [relationshipDialog, setRelationshipDialog] = useState<{ sourceId: string; targetId: string } | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [renamingElementId, setRenamingElementId] = useState<string | null>(null);
  const [activeDragNode, setActiveDragNode] = useState<PprModelNode | null>(null);
  const [edges, setEdges] = useState<PprFlowEdge[]>([]);
  const [isPerspectiveTransitioning, setIsPerspectiveTransitioning] = useState(false);
  const fittedProjectionId = useRef<string | null>(null);
  const previousPerspective = useRef<PprCanvasPerspective>(perspective);
  const snappedDragPosition = useRef<{ nodeId: string; position: PprNodePosition } | null>(null);
  const renameClickCandidate = useRef<{ nodeId: string; x: number; y: number; timeStamp: number } | null>(null);
  const ignoreNextSelectionChange = useRef(false);
  const selectionGuardTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const selectionGestureRef = useRef(false);
  const pendingConnection = useRef<{ sourceId: string; sourceHandleId: string | null } | null>(null);
  const markSelectionChangeHandled = useCallback(() => {
    ignoreNextSelectionChange.current = true;
    if (selectionGuardTimer.current) clearTimeout(selectionGuardTimer.current);
    selectionGuardTimer.current = setTimeout(() => {
      ignoreNextSelectionChange.current = false;
      selectionGuardTimer.current = undefined;
    }, 0);
  }, []);
  const projection = useMemo(
    () => model
      ? getPprPerspectiveProjection(model, perspective, productViewMode, pprLevel, resourceViewMode, collapseItemStates)
      : null,
    [collapseItemStates, model, perspective, productViewMode, pprLevel, resourceViewMode],
  );
  const flowModel = projection?.model;
  const layoutKey = getPprCanvasLayoutKey(perspective, productViewMode, pprLevel, resourceViewMode);
  const canEditStructure = Boolean(model) && perspective !== 'levels';
  const isCanonicalPosition = perspective === 'ppr';
  const isPositionEditable = Boolean(flowModel);
  const renderProfile = useMemo(
    () => getPprFlowRenderProfile(
      flowModel?.diagram.usages.length ?? 0,
      flowModel?.diagram.relationships.length ?? 0,
    ),
    [flowModel?.diagram.usages.length, flowModel?.diagram.relationships.length],
  );
  const handleRenameElement = useCallback((id: string, name: string) => {
    if (!canEditStructure) return;
    const trimmedName = name.trim();
    if (!trimmedName) return;
    onUpdateElement(id, { name: trimmedName });
  }, [canEditStructure, onUpdateElement]);
  const handleEndRename = useCallback(() => {
    setRenamingElementId(null);
  }, []);
  const remoteSelectionsByElementId = useMemo(() => {
    const selections = new Map<string, PprRemoteSelection[]>();
    remoteParticipants.forEach((participant) => {
      (participant.selection ?? []).forEach((elementId) => {
        const current = selections.get(elementId) ?? [];
        current.push({
          participantId: participant.id,
          name: participant.name,
          color: participant.color,
        });
        selections.set(elementId, current);
      });
    });
    return selections;
  }, [remoteParticipants]);
  const remoteSelectionsByRelationshipId = useMemo(() => {
    const selections = new Map<string, PprRemoteSelection[]>();
    if (!model) return selections;
    model.diagram.relationships.forEach((relationship) => {
      const sourceSelections = remoteSelectionsByElementId.get(relationship.source_id) ?? [];
      const targetSelections = remoteSelectionsByElementId.get(relationship.target_id) ?? [];
      if (sourceSelections.length > 0 || targetSelections.length > 0) {
        selections.set(relationship.id, [...sourceSelections, ...targetSelections]);
      }
    });
    return selections;
  }, [model, remoteSelectionsByElementId]);
  const modelNodes = useMemo(
    () => (flowModel
      ? modelToFlowNodes(
          flowModel,
          new Set(),
          contextElementIds,
          contextRelationshipIds,
          undefined,
          remoteSelectionsByElementId,
           projection
             ? {
                 parentByElementId: projection.parentByElementId,
                 containerDimensions: projection.containerDimensions,
                  containerKinds: projection.containerKinds,
               }
             : undefined,
        ).map((node) => {
          if (node.type !== 'pprNode') return node;
          const savedPosition = isCanonicalPosition ? undefined : layoutPositions?.[node.id];
          return {
            ...node,
            ...(savedPosition ? { position: savedPosition } : {}),
            draggable: isPositionEditable,
            data: {
              ...node.data,
              onRename: canEditStructure ? handleRenameElement : undefined,
              onEndRename: canEditStructure ? handleEndRename : undefined,
              isRenaming: canEditStructure && renamingElementId === node.id,
              perspective,
            },
          };
        })
      : []),
    [
      canEditStructure,
      contextElementIds,
      contextRelationshipIds,
      flowModel,
      handleEndRename,
      handleRenameElement,
      isCanonicalPosition,
      isPositionEditable,
      layoutPositions,
      perspective,
      projection,
      renamingElementId,
      remoteSelectionsByElementId,
    ],
  );
  const [nodes, setNodes, onNodesChange] = useNodesState<PprFlowNode>(modelNodes);
  const handleNodesChange = useCallback(
    (changes: NodeChange<PprFlowNode>[]) => {
      if (changes.some((change) => change.type === 'select')) selectionGestureRef.current = true;
      const positionChange = changes.find(
        (change): change is NodeChange<PprFlowNode> & {
          type: 'position';
          position: { x: number; y: number };
          dragging?: boolean;
        } =>
          change.type === 'position' &&
          (change.dragging === true ||
            (change.dragging === false && snappedDragPosition.current?.nodeId === change.id)) &&
          Boolean(change.position),
      );
      const currentNode = positionChange
        ? nodes.find((node) => node.id === positionChange.id)
        : undefined;
      if (positionChange?.position && currentNode?.type === 'pprNode') {
        const draggedNode = { ...currentNode, position: positionChange.position };
        const snappedPosition = positionChange.dragging === false && snappedDragPosition.current
          ? snappedDragPosition.current.position
          : getSnappedNodePosition(
              draggedNode,
              getAlignmentGuides(draggedNode, [
                draggedNode,
                ...nodes.filter((node) => node.id !== draggedNode.id),
                ], getAlignmentGuideTolerance(zoom)),
            );
        snappedDragPosition.current = { nodeId: draggedNode.id, position: snappedPosition };
        if (positionChange.dragging === true) {
          setActiveDragNode({ ...draggedNode, position: snappedPosition });
        }
        if (
          snappedPosition.x !== positionChange.position.x ||
          snappedPosition.y !== positionChange.position.y
        ) {
          changes = changes.map((change) =>
            change.type === 'position' && change.id === positionChange.id
              ? { ...change, position: snappedPosition }
              : change,
          );
        }
      }
      onNodesChange(changes);
    },
    [nodes, onNodesChange, setActiveDragNode, zoom],
  );
  const handleEdgeLabelSelect = useCallback(
    (relationshipId: string) => {
      const isOnlySelected = selectedRelationshipIds.size === 1 && selectedRelationshipIds.has(relationshipId);
      markSelectionChangeHandled();
      onSelectRelationships(isOnlySelected ? new Set() : new Set([relationshipId]));
      onSelectElements(new Set());
    },
    [markSelectionChangeHandled, onSelectElements, onSelectRelationships, selectedRelationshipIds],
  );
  const modelEdges = useMemo(
    () =>
      flowModel
        ? modelToFlowEdges(
            flowModel,
            new Set(),
            canEditStructure ? onDeleteRelationship : undefined,
            handleEdgeLabelSelect,
            renderProfile.showEdgeLabels,
            contextRelationshipIds,
            contextElementIds,
            undefined,
            remoteSelectionsByRelationshipId,
          ).map((edge): PprFlowEdge => {
            if (!edge.data) return edge;
            const derived = projection?.derivedEdges.get(edge.id);
            return {
              ...edge,
              ...(perspective === 'resource'
                ? { sourceHandle: 'source-bottom', targetHandle: 'target-top' }
                : {}),
              selectable: !derived,
              deletable: canEditStructure && !derived,
              data: {
                ...edge.data,
                label: derived?.label,
                isDerived: Boolean(derived),
                  isProductAssembly: Boolean(edge.data.isProductAssembly && !derived),
                relatedElementId: derived?.relatedElementId,
                onDelete: canEditStructure && !derived ? onDeleteRelationship : undefined,
                onSelect: derived ? undefined : edge.data?.onSelect,
              },
            };
          })
        : [],
    [
      contextElementIds,
      contextRelationshipIds,
      handleEdgeLabelSelect,
      flowModel,
      canEditStructure,
      onDeleteRelationship,
      perspective,
      projection?.derivedEdges,
      productViewMode,
      remoteSelectionsByRelationshipId,
      renderProfile.showEdgeLabels,
    ],
  );

  useEffect(() => {
    const nextNodes = modelNodes.map((node) => {
      const selected = node.type === 'pprNode' && selectedElementIds.has(node.id);
      return node.selected === selected ? node : { ...node, selected };
    });
    setNodes(nextNodes);
  }, [modelNodes, selectedElementIds, setNodes]);

  useEffect(() => {
    if (previousPerspective.current === perspective) return;
    previousPerspective.current = perspective;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    setIsPerspectiveTransitioning(true);
    const timeout = window.setTimeout(
      () => setIsPerspectiveTransitioning(false),
      PERSPECTIVE_TRANSITION_DURATION + 20,
    );
    return () => window.clearTimeout(timeout);
  }, [perspective]);

  useEffect(() => {
    setEdges((currentEdges) => {
      const nextEdges = modelEdges.map((edge) => {
        const selected = selectedRelationshipIds.has(edge.id);
        return edge.selected === selected ? edge : { ...edge, selected };
      });
      return currentEdges.length === nextEdges.length && currentEdges.every((edge, index) => edge === nextEdges[index])
        ? currentEdges
        : nextEdges;
    });
  }, [modelEdges, selectedRelationshipIds]);

  useEffect(() => {
    if (!flowModel || flowModel.diagram.usages.length === 0) return;
    const projectionMode = perspective === 'product'
      ? productViewMode
      : perspective === 'resource'
        ? resourceViewMode
        : perspective === 'levels'
          ? pprLevel
          : '';
    const projectionId = `${flowModel.id}:${perspective}:${projectionMode}`;
    if (fittedProjectionId.current === projectionId) return;
    const isInitialFit = fittedProjectionId.current === null;
    fittedProjectionId.current = projectionId;
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (savedViewport) {
      void setViewport(savedViewport, {
        duration: prefersReducedMotion ? 0 : isInitialFit ? 0 : PERSPECTIVE_TRANSITION_DURATION,
      });
      return;
    }
    void fitView({
      nodes: modelNodes.map(({ id }) => ({ id })),
      padding: 0.2,
      duration: prefersReducedMotion
        ? 0
        : isInitialFit
          ? 250
          : PERSPECTIVE_TRANSITION_DURATION,
      ...(isInitialFit
        ? {}
        : {
            ease: easeInOutCubic,
            interpolate: 'linear' as const,
          }),
    });
  }, [fitView, flowModel, modelNodes, perspective, pprLevel, productViewMode, resourceViewMode, savedViewport, setViewport]);

  const alignmentGuides = useMemo<PprAlignmentGuide[]>(
    () => activeDragNode
      ? getAlignmentGuides(activeDragNode, nodes, getAlignmentGuideTolerance(zoom))
      : [],
    [activeDragNode, nodes, zoom],
  );
  const canAlignSelectedNodes = useMemo(() => {
    const selectedNodes = nodes.filter((node) =>
      node.type === 'pprNode' && selectedElementIds.has(node.id),
    );
    return selectedNodes.length > 1
      && new Set(selectedNodes.map((node) => node.parentId ?? null)).size === 1;
  }, [nodes, selectedElementIds]);

  useEffect(() => {
    const clearTransientDragState = () => {
      snappedDragPosition.current = null;
      setActiveDragNode(null);
    };
    const clearSelectionGuard = () => {
      if (selectionGuardTimer.current) clearTimeout(selectionGuardTimer.current);
    };

    window.addEventListener('blur', clearTransientDragState);
    window.addEventListener('pointercancel', clearTransientDragState);
    window.addEventListener('touchcancel', clearTransientDragState);
    window.addEventListener('lostpointercapture', clearTransientDragState);
    return () => {
      window.removeEventListener('blur', clearTransientDragState);
      window.removeEventListener('pointercancel', clearTransientDragState);
      window.removeEventListener('touchcancel', clearTransientDragState);
      window.removeEventListener('lostpointercapture', clearTransientDragState);
      clearSelectionGuard();
    };
  }, []);

  const handleNodeDragStop = useCallback<OnNodeDrag<PprFlowNode>>(
    (_event, node) => {
      if (!isPositionEditable) return;
      const finalPosition = node.type === 'pprNode' && snappedDragPosition.current?.nodeId === node.id
        ? snappedDragPosition.current.position
        : node.position;
      setActiveDragNode(null);
      if (node.type !== 'pprNode') {
        snappedDragPosition.current = null;
        return;
      }
      setNodes((currentNodes) =>
        currentNodes.map((currentNode) =>
          currentNode.id === node.id ? { ...currentNode, position: finalPosition } : currentNode,
        ),
      );
      const roundedPosition = {
        x: Math.round(finalPosition.x),
        y: Math.round(finalPosition.y),
      };
      if (isCanonicalPosition) {
        onUpdateElement(node.id, roundedPosition);
      } else {
        onLayoutPositionsChange?.(layoutKey, { [node.id]: roundedPosition });
      }
      snappedDragPosition.current = null;
    },
    [isCanonicalPosition, isPositionEditable, layoutKey, onLayoutPositionsChange, onUpdateElement, setNodes],
  );

  const handleNodeDragStart = useCallback<OnNodeDrag<PprFlowNode>>(
    (_event, node) => {
      if (!isPositionEditable) return;
      if (node.type !== 'pprNode') return;
      snappedDragPosition.current = { nodeId: node.id, position: node.position };
      setActiveDragNode(node);
    },
    [isPositionEditable],
  );

  const handleNodeDrag = useCallback<OnNodeDrag<PprFlowNode>>(
    (_event, node) => {
      if (!isPositionEditable) return;
      if (
        node.type === 'pprNode' &&
        (!snappedDragPosition.current || snappedDragPosition.current.nodeId !== node.id)
      ) {
        snappedDragPosition.current = { nodeId: node.id, position: node.position };
      }
      setActiveDragNode(node.type === 'pprNode' ? node : null);
    },
    [isPositionEditable],
  );

  const handleNodeClick = useCallback(
    (event: React.MouseEvent, node: PprFlowNode) => {
      if (node.type !== 'pprNode') return;
      const isMultiSelection = event.metaKey || event.ctrlKey;
      const isOnlySelected = selectedElementIds.size === 1 && selectedElementIds.has(node.id);
      const nextElementIds = isMultiSelection
        ? new Set([...selectedElementIds].filter((id) => id !== node.id))
        : isOnlySelected
          ? new Set<string>()
          : new Set([node.id]);
      if (isMultiSelection && !selectedElementIds.has(node.id)) nextElementIds.add(node.id);
      markSelectionChangeHandled();
      onSelectElements(nextElementIds);
      onSelectRelationships(new Set());
    },
    [markSelectionChangeHandled, onSelectElements, onSelectRelationships, selectedElementIds],
  );

  const handleEdgeClick = useCallback(
    (event: React.MouseEvent, edge: PprFlowEdge) => {
      if (edge.data?.isDerived) return;
      const isMultiSelection = event.metaKey || event.ctrlKey;
      const isOnlySelected = selectedRelationshipIds.size === 1 && selectedRelationshipIds.has(edge.id);
      const nextRelationshipIds = isMultiSelection
        ? new Set([...selectedRelationshipIds].filter((id) => id !== edge.id))
        : isOnlySelected
          ? new Set<string>()
          : new Set([edge.id]);
      if (isMultiSelection && !selectedRelationshipIds.has(edge.id)) nextRelationshipIds.add(edge.id);
      markSelectionChangeHandled();
      onSelectRelationships(nextRelationshipIds);
      onSelectElements(new Set());
    },
    [markSelectionChangeHandled, onSelectElements, onSelectRelationships, selectedRelationshipIds],
  );

  const handleSelectionChange = useCallback(
    ({ nodes: selectedNodes, edges: selectedEdges }: OnSelectionChangeParams<PprFlowNode, PprFlowEdge>) => {
      if (ignoreNextSelectionChange.current) {
        ignoreNextSelectionChange.current = false;
        selectionGestureRef.current = false;
        if (selectionGuardTimer.current) {
          clearTimeout(selectionGuardTimer.current);
          selectionGuardTimer.current = undefined;
        }
        return;
      }
      // React Flow reports its own store one render behind the controlled nodes it
      // is handed, so a report that no canvas gesture produced is a stale echo of a
      // selection the workspace already owns. Echoing it back makes the two
      // selections ping-pong until React exceeds its update depth. Clicks, edge
      // selection and background clicks update the workspace through their own
      // handlers, so only box selection and keyboard selection need this path.
      if (!selectionGestureRef.current) return;
      selectionGestureRef.current = false;
      const nextElementIds = new Set(
        selectedNodes.filter((node) => node.type === 'pprNode').map((node) => node.id),
      );
      const nextRelationshipIds = nextElementIds.size > 0
        ? new Set<string>()
        : new Set(selectedEdges.map((edge) => edge.id));
      // React Flow emits an empty transitional selection while controlled nodes
      // are being replaced. Do not let that transient event clear a user
      // selection that is already owned by the workspace.
      if ((selectedNodes.length > 0 || selectedElementIds.size === 0) && !setsHaveSameValues(nextElementIds, selectedElementIds)) {
        onSelectElements(nextElementIds);
      }
      if ((selectedEdges.length > 0 || selectedRelationshipIds.size === 0) && !setsHaveSameValues(nextRelationshipIds, selectedRelationshipIds)) {
        onSelectRelationships(nextRelationshipIds);
      }
    },
    [onSelectElements, onSelectRelationships, selectedElementIds, selectedRelationshipIds],
  );

  const handleConnect = useCallback(
    (connection: Connection) => {
      if (!canEditStructure) return;
      if (!model || !connection.source || !connection.target || connection.source === connection.target) return;
      const sourceElement = model.diagram.usages.find((element) => element.id === connection.source);
      const targetElement = model.diagram.usages.find((element) => element.id === connection.target);
      if (!sourceElement || !targetElement) return;
      const individualKind = getIndividualViewRelationshipKind(perspective, productViewMode);
      if (individualKind) {
        if (sourceElement.type !== perspective || targetElement.type !== perspective) return;
        const alreadyExists = model.diagram.relationships.some((relationship) =>
          relationship.source_id === sourceElement.id
          && relationship.target_id === targetElement.id
          && relationship.kind === individualKind,
        );
        if (!alreadyExists) {
          onCreateRelationship({
            source_id: sourceElement.id,
            target_id: targetElement.id,
            kind: individualKind,
          });
        }
        return;
      }
      if (sourceElement.type === targetElement.type) {
        onRequestMerge(sourceElement.id, targetElement.id);
        return;
      }
      const { sourceElement: relationshipSource, targetElement: relationshipTarget } =
        getRelationshipEndpoints(sourceElement, targetElement);
      const supportedKinds = getSupportedRelationshipKinds(relationshipSource.type, relationshipTarget.type);
      const existingKinds = new Set(
        (model?.diagram.relationships ?? [])
          .filter((relationship) =>
            relationship.source_id === relationshipSource.id && relationship.target_id === relationshipTarget.id)
          .map((relationship) => relationship.kind),
      );
      const availableKinds = supportedKinds.filter((kind) => !existingKinds.has(kind));

      if (availableKinds.length === 0 && supportedKinds.length === 1) return;

      setRelationshipDialog({
        sourceId: relationshipSource.id,
        targetId: relationshipTarget.id,
      });
    },
    [canEditStructure, model, onCreateRelationship, onRequestMerge, perspective, productViewMode],
  );

  const handleConnectStart = useCallback<OnConnectStart>((_event, connection) => {
    if (!canEditStructure) return;
    snappedDragPosition.current = null;
    setActiveDragNode(null);
    setIsConnecting(true);
    pendingConnection.current = connection.nodeId && connection.handleType === 'source'
      ? { sourceId: connection.nodeId, sourceHandleId: connection.handleId }
      : null;
  }, [canEditStructure]);

  const handleConnectEnd = useCallback<OnConnectEnd<PprFlowNode>>(
    (event, connectionState) => {
      if (!canEditStructure) return;
      setIsConnecting(false);
      const pending = pendingConnection.current;
      pendingConnection.current = null;
      if (!pending || connectionState.isValid || connectionState.toNode) return;

      const eventTarget = event.target;
      if (!(eventTarget instanceof Element) || !eventTarget.closest('.react-flow')) return;

      const sourceElement = model?.diagram.usages.find((element) => element.id === pending.sourceId);
      if (!sourceElement) return;
      const quickSpec = getQuickConnectionSpec(
        sourceElement,
        pending.sourceHandleId,
        perspective,
        productViewMode,
      );
      const pointer = getPointerClientPosition(event);
      if (!quickSpec || !pointer) return;

      const flowPosition = screenToFlowPosition(pointer);
      const label = quickSpec.type.charAt(0).toUpperCase() + quickSpec.type.slice(1);
      onCreateElement({
        name: `New ${label}`,
        type: quickSpec.type,
        definition_id: null,
        description: '',
        attributes: [],
        visible_in_ppr: perspective === 'ppr',
        x: Math.round(flowPosition.x - 120),
        y: Math.round(flowPosition.y - 55),
      }, (newElement) => {
        if (quickSpec.kind) {
          onCreateRelationship({
            source_id: sourceElement.id,
            target_id: newElement.id,
            kind: quickSpec.kind,
          });
          return;
        }
        const { sourceElement: relationshipSource, targetElement: relationshipTarget } =
          getRelationshipEndpoints(sourceElement, newElement);
        const supportedKinds = getSupportedRelationshipKinds(relationshipSource.type, relationshipTarget.type);
        if (supportedKinds.length === 1) {
          onCreateRelationship({
            source_id: relationshipSource.id,
            target_id: relationshipTarget.id,
            kind: supportedKinds[0],
          });
          return;
        }
        setRelationshipDialog({
          sourceId: relationshipSource.id,
          targetId: relationshipTarget.id,
        });
      });
    },
    [
      canEditStructure,
      model,
      onCreateElement,
      onCreateRelationship,
      perspective,
      productViewMode,
      screenToFlowPosition,
    ],
  );

  const handleDeleteNodes = useCallback(
    (deletedNodes: PprFlowNode[]) => {
      if (!canEditStructure) return;
      deletedNodes.forEach((node) => {
        if (node.type === 'pprNode') onDeleteElement(node.id);
      });
    },
    [canEditStructure, onDeleteElement],
  );

  const handleDeleteEdges = useCallback(
    (deletedEdges: PprFlowEdge[]) => {
      if (!canEditStructure) return;
      deletedEdges.forEach((edge) => onDeleteRelationship(edge.id));
    },
    [canEditStructure, onDeleteRelationship],
  );

  const handleAutoLayout = useCallback(() => {
    if (!flowModel || !isPositionEditable) return;
    const positions = isCanonicalPosition
      ? getAutoLayoutPositions(flowModel)
      : new Map(flowModel.diagram.usages.map((element) => {
          const parentId = projection?.parentByElementId?.get(element.id);
          const parent = parentId
            ? flowModel.diagram.usages.find((candidate) => candidate.id === parentId)
            : undefined;
          return [element.id, {
            x: element.x - (parent?.x ?? 0),
            y: element.y - (parent?.y ?? 0),
          } satisfies PprNodePosition];
        }));
    setNodes((currentNodes) =>
      currentNodes.map((node) => {
        const position = positions.get(node.id);
        return position ? { ...node, position } : node;
      }),
    );
    if (isCanonicalPosition) {
      flowModel.diagram.usages.forEach((element) => {
        const position = positions.get(element.id);
        if (position) onUpdateElement(element.id, position);
      });
    } else {
      onLayoutPositionsChange?.(layoutKey, Object.fromEntries(positions));
    }
    requestAnimationFrame(() => void fitView({ padding: 0.2, duration: 250 }));
  }, [fitView, flowModel, isCanonicalPosition, isPositionEditable, layoutKey, onLayoutPositionsChange, onUpdateElement, projection, setNodes]);

  const handleAlignNodes = useCallback((alignment: PprNodeAlignment) => {
    const alignedPositions = getAlignedNodePositions(nodes, selectedElementIds, alignment);
    const changedPositions = new Map(
      [...alignedPositions].filter(([id, position]) => {
        const node = nodes.find((candidate) => candidate.id === id);
        return node && (node.position.x !== position.x || node.position.y !== position.y);
      }),
    );
    if (changedPositions.size === 0) return;

    setNodes((currentNodes) =>
      currentNodes.map((node) => {
        const position = changedPositions.get(node.id);
        return position ? { ...node, position } : node;
      }),
    );
    const roundedPositions = Object.fromEntries(
      [...changedPositions].map(([id, position]) => [id, {
        x: Math.round(position.x),
        y: Math.round(position.y),
      }]),
    );
    if (isCanonicalPosition) {
      Object.entries(roundedPositions).forEach(([id, position]) => onUpdateElement(id, position));
    } else {
      onLayoutPositionsChange?.(layoutKey, roundedPositions);
    }
  }, [isCanonicalPosition, layoutKey, nodes, onLayoutPositionsChange, onUpdateElement, selectedElementIds, setNodes]);

  const handlePaneClick = useCallback(() => {
    markSelectionChangeHandled();
    snappedDragPosition.current = null;
    setActiveDragNode(null);
    onBackgroundClick();
  }, [markSelectionChangeHandled, onBackgroundClick]);

  const handleCanvasClickCapture = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (!target.closest('.react-flow__pane')) return;
      if (
        target.closest(
          '.react-flow__node, .react-flow__edge, .react-flow__edgelabel-renderer, .react-flow__handle, .react-flow__panel, .react-flow__controls, .react-flow__minimap',
        )
      ) {
        return;
      }
      handlePaneClick();
    },
    [handlePaneClick],
  );

  useEffect(() => {
    if (!canEditStructure) return;
    const findNameNode = (target: EventTarget | null, x: number, y: number) => {
      if (!(target instanceof Element)) return null;
      const nodeElement = target.closest<HTMLElement>('.react-flow__node');
      const nodeId = nodeElement?.dataset.id;
      const nameElement = nodeElement?.querySelector<HTMLElement>('[data-testid^="node-name-"]');
      if (!nodeId || !nameElement) return null;
      const bounds = nameElement.getBoundingClientRect();
      return x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom
        ? nodeId
        : null;
    };
    const handleNativeMouseDown = (event: MouseEvent) => {
      if (event.button !== 0) return;
      const nodeId = findNameNode(event.target, event.clientX, event.clientY);
      if (nodeId) {
        renameClickCandidate.current = {
          nodeId,
          x: event.clientX,
          y: event.clientY,
          timeStamp: event.timeStamp,
        };
      }
    };
    const handleNativeDoubleClick = (event: MouseEvent) => {
      const directNodeId = findNameNode(event.target, event.clientX, event.clientY);
      const candidate = renameClickCandidate.current;
      renameClickCandidate.current = null;
      const isNearbyCandidate = candidate
        && event.timeStamp - candidate.timeStamp <= 600
        && Math.hypot(event.clientX - candidate.x, event.clientY - candidate.y) <= 12;
      const nodeId = directNodeId ?? (isNearbyCandidate ? candidate.nodeId : null);
      if (!nodeId) return;
      event.preventDefault();
      event.stopPropagation();
      markSelectionChangeHandled();
      onSelectElements(new Set([nodeId]));
      onSelectRelationships(new Set());
      setRenamingElementId(nodeId);
    };

    document.addEventListener('mousedown', handleNativeMouseDown, true);
    document.addEventListener('dblclick', handleNativeDoubleClick, true);
    return () => {
      document.removeEventListener('mousedown', handleNativeMouseDown, true);
      document.removeEventListener('dblclick', handleNativeDoubleClick, true);
    };
  }, [canEditStructure, markSelectionChangeHandled, onSelectElements, onSelectRelationships]);

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (isConnecting) return;
      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      onCursorMove({ x: Math.round(position.x), y: Math.round(position.y) });
    },
    [isConnecting, onCursorMove, screenToFlowPosition],
  );

  useEffect(() => () => onCursorMove(null), [onCursorMove]);

  const isValidConnection = useCallback(
    (connection: Connection) => {
      if (!canEditStructure || !model || !connection.source || !connection.target || connection.source === connection.target) return false;
      const source = model.diagram.usages.find((element) => element.id === connection.source);
      const target = model.diagram.usages.find((element) => element.id === connection.target);
      if (!source || !target) return false;
      if (perspective === 'ppr') return true;
      const kind = getIndividualViewRelationshipKind(perspective, productViewMode);
      return source.type === perspective
        && target.type === perspective
        && Boolean(kind)
        && !model.diagram.relationships.some((relationship) =>
          relationship.source_id === source.id
          && relationship.target_id === target.id
          && relationship.kind === kind,
        );
    },
    [canEditStructure, model, perspective, productViewMode],
  );

  if (isLoading) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center bg-background">
        <Loader2 className="mb-4 h-8 w-8 animate-spin text-muted-foreground" />
        <p className="font-mono text-sm text-muted-foreground">Loading Model...</p>
      </div>
    );
  }

  if (!model) return null;

  return (
    <div
      className={cn('h-full w-full bg-background', flowModel?.diagram.usages.length === 0 && 'relative')}
      data-testid="ppr-flow-canvas"
      data-perspective={perspective}
      onClickCapture={handleCanvasClickCapture}
      onPointerMove={handlePointerMove}
      onKeyDown={(event) => {
        if (event.key === 'Escape') setActiveDragNode(null);
      }}
      onPointerLeave={() => {
        setActiveDragNode(null);
        onCursorMove(null);
      }}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={handleNodesChange}
        onNodeDragStart={handleNodeDragStart}
        onNodeDrag={handleNodeDrag}
        onNodeDragStop={handleNodeDragStop}
        onNodeClick={handleNodeClick}
        onEdgeClick={handleEdgeClick}
        onPaneClick={handlePaneClick}
        onMoveEnd={(_event, viewport) => onViewportChange?.(perspective, viewport)}
        onSelectionChange={handleSelectionChange}
        onConnect={handleConnect}
        onConnectStart={handleConnectStart}
        onConnectEnd={handleConnectEnd}
        isValidConnection={isValidConnection}
        onNodesDelete={handleDeleteNodes}
        onEdgesDelete={handleDeleteEdges as (edges: PprFlowEdge[]) => void}
        deleteKeyCode={canEditStructure ? ['Backspace', 'Delete'] : null}
        nodesDraggable={isPositionEditable}
        nodesConnectable={canEditStructure}
        selectionOnDrag={renderProfile.allowSelectionOnDrag}
        panOnDrag={[1, 2]}
        fitView={false}
        onlyRenderVisibleElements={renderProfile.isDense}
        minZoom={0.1}
        maxZoom={2}
        className={cn(
          'ppr-perspective-flow !bg-transparent',
          isPerspectiveTransitioning && 'is-transitioning',
          isConnecting && '[&_.react-flow__panel]:pointer-events-none',
        )}
      >
        <Background variant={BackgroundVariant.Lines} gap={40} size={1} color="hsl(var(--border) / 0.4)" />
        <Controls position="bottom-left" showInteractive={false} />
        {renderProfile.showMiniMap && (
          <MiniMap
            position="bottom-right"
            pannable
            zoomable
            nodeStrokeWidth={0}
            nodeColor={getPprMiniMapNodeColor}
          />
        )}
        {renderProfile.isDense && (
          <Panel
            position="bottom-right"
            data-testid="graph-performance-mode"
            className="!m-4 rounded-sm border border-border bg-card/95 px-2 py-1 font-mono text-[10px] text-muted-foreground shadow-sm backdrop-blur"
          >
            Dense graph mode · labels and box select simplified
          </Panel>
        )}
        <ViewportPortal>
          {alignmentGuides.map((guide) => (
            <div
              key={`${guide.axis}-${guide.coordinate}`}
              data-testid={`alignment-guide-${guide.axis}`}
              data-axis={guide.axis}
              aria-hidden="true"
              className="ppr-alignment-guide pointer-events-none absolute z-0"
              style={guide.axis === 'vertical'
                ? {
                    left: `${guide.coordinate}px`,
                    top: '-10000px',
                    height: '20000px',
                    borderLeftWidth: `${1 / Math.max(zoom, 0.01)}px`,
                  }
                : {
                    left: '-10000px',
                    top: `${guide.coordinate}px`,
                    width: '20000px',
                    borderTopWidth: `${1 / Math.max(zoom, 0.01)}px`,
                  }}
            />
          ))}
          {remoteParticipants.map((participant) => {
            if (!participant.cursor) return null;
            const color = getParticipantCursorColor(participant.id);
            return (
              <div
                key={participant.id}
                data-testid={`remote-cursor-${participant.id}`}
                className="pointer-events-none absolute left-0 top-0 z-20"
                style={{ transform: `translate(${participant.cursor.x}px, ${participant.cursor.y}px)` }}
              >
                <div
                  className="flex -translate-x-1 -translate-y-1 items-center gap-1 whitespace-nowrap rounded-sm border bg-card px-1.5 py-0.5 font-mono text-[10px] font-semibold shadow-md"
                  style={{ borderColor: color, color }}
                >
                  <MousePointer2 className="h-3 w-3 fill-current" aria-hidden="true" />
                  <span>{participant.name}</span>
                  {participant.surface && (
                    <span data-testid={`remote-surface-${participant.id}`} className="border-l border-current/30 pl-1 opacity-75">
                      {COLLABORATION_SURFACE_LABELS[participant.surface]}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </ViewportPortal>
        {isPositionEditable && canAlignSelectedNodes && (
          <Panel
            position="top-left"
            data-testid="graph-align-tools"
            className="!m-4 flex flex-col gap-1 rounded-sm border border-border bg-card/95 p-1 shadow-sm backdrop-blur"
          >
            <div className="px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              Align selected · {selectedElementIds.size}
            </div>
            <div className="flex items-center gap-0.5">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 rounded-sm"
                aria-label="Align left"
                title="Align left edges"
                data-testid="graph-align-left"
                onClick={() => handleAlignNodes('left')}
              >
                <AlignStartVertical className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 rounded-sm"
                aria-label="Align horizontal center"
                title="Align horizontal centers"
                data-testid="graph-align-center-horizontal"
                onClick={() => handleAlignNodes('center-horizontal')}
              >
                <AlignCenterVertical className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 rounded-sm"
                aria-label="Align right"
                title="Align right edges"
                data-testid="graph-align-right"
                onClick={() => handleAlignNodes('right')}
              >
                <AlignEndVertical className="h-3.5 w-3.5" />
              </Button>
              <span className="mx-1 h-4 w-px bg-border" />
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 rounded-sm"
                aria-label="Distribute horizontally"
                title="Distribute horizontally"
                data-testid="graph-distribute-horizontal"
                onClick={() => handleAlignNodes('distribute-horizontal')}
              >
                <AlignHorizontalDistributeCenter className="h-3.5 w-3.5" />
              </Button>
            </div>
            <div className="flex items-center gap-0.5">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 rounded-sm"
                aria-label="Align top"
                title="Align top edges"
                data-testid="graph-align-top"
                onClick={() => handleAlignNodes('top')}
              >
                <AlignStartHorizontal className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 rounded-sm"
                aria-label="Align vertical center"
                title="Align vertical centers"
                data-testid="graph-align-center-vertical"
                onClick={() => handleAlignNodes('center-vertical')}
              >
                <AlignCenterHorizontal className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 rounded-sm"
                aria-label="Align bottom"
                title="Align bottom edges"
                data-testid="graph-align-bottom"
                onClick={() => handleAlignNodes('bottom')}
              >
                <AlignEndHorizontal className="h-3.5 w-3.5" />
              </Button>
              <span className="mx-1 h-4 w-px bg-border" />
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 rounded-sm"
                aria-label="Distribute vertically"
                title="Distribute vertically"
                data-testid="graph-distribute-vertical"
                onClick={() => handleAlignNodes('distribute-vertical')}
              >
                <AlignVerticalDistributeCenter className="h-3.5 w-3.5" />
              </Button>
            </div>
          </Panel>
        )}
        {perspective === 'product' && onProductViewModeChange && (
          <Panel
            position="top-center"
            data-testid="product-view-mode-switcher"
            className="!m-4 flex items-center gap-2 rounded-sm border border-border bg-card/95 p-1.5 shadow-sm backdrop-blur"
          >
            <div className="px-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              Product lens
            </div>
            <div role="group" aria-label="Product view mode" className="flex border border-border/80 bg-muted/40 p-0.5">
              <button
                type="button"
                data-testid="button-product-view-ppr"
                aria-pressed={productViewMode === 'ppr'}
                onClick={() => onProductViewModeChange('ppr')}
                className={`h-7 px-2.5 font-mono text-[10px] uppercase tracking-[0.08em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  productViewMode === 'ppr'
                    ? 'bg-card text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                PPR-derived
              </button>
              <button
                type="button"
                data-testid="button-product-view-bom"
                aria-pressed={productViewMode === 'bom'}
                onClick={() => onProductViewModeChange('bom')}
                className={`h-7 px-2.5 font-mono text-[10px] uppercase tracking-[0.08em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  productViewMode === 'bom'
                    ? 'bg-card text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Gozinto BOM
              </button>
            </div>
          </Panel>
        )}
        {perspective === 'resource' && onResourceViewModeChange && (
          <Panel
            position="top-center"
            data-testid="resource-view-mode-switcher"
            className="!m-4 flex items-center gap-2 rounded-sm border border-border bg-card/95 p-1.5 shadow-sm backdrop-blur"
          >
            <div className="px-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              Resource lens
            </div>
            <div role="group" aria-label="Resource view mode" className="flex border border-border/80 bg-muted/40 p-0.5">
              <button
                type="button"
                data-testid="button-resource-view-contains"
                aria-pressed={resourceViewMode === 'contains'}
                onClick={() => onResourceViewModeChange('contains')}
                className={`h-7 px-2.5 font-mono text-[10px] uppercase tracking-[0.08em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  resourceViewMode === 'contains'
                    ? 'bg-card text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Contains tree
              </button>
              <button
                type="button"
                data-testid="button-resource-view-nested"
                aria-pressed={resourceViewMode === 'nested'}
                onClick={() => onResourceViewModeChange('nested')}
                className={`h-7 px-2.5 font-mono text-[10px] uppercase tracking-[0.08em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  resourceViewMode === 'nested'
                    ? 'bg-card text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Nested subresources
              </button>
            </div>
          </Panel>
        )}
        {perspective === 'levels' && onPprLevelChange && projection && (
          <Panel
            position="top-center"
            data-testid="ppr-level-switcher"
            className="!m-4 flex items-center gap-2 rounded-sm border border-border bg-card/95 p-1.5 shadow-sm backdrop-blur"
          >
            <div className="px-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              Depth
            </div>
            <div role="group" aria-label="PPR level depth" className="flex border border-border/80 bg-muted/40 p-0.5">
              {[0, 1, 2, 3].map((level) => {
                const enabled = level <= (projection.maxLevel ?? 0);
                return (
                  <button
                    key={level}
                    type="button"
                    data-testid={`button-ppr-level-${level}`}
                    aria-pressed={pprLevel === level}
                    disabled={!enabled}
                    onClick={() => onPprLevelChange(level)}
                    className={`h-7 min-w-8 px-2 font-mono text-[10px] uppercase tracking-[0.08em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                      pprLevel === level
                        ? 'bg-card text-foreground shadow-sm'
                        : enabled
                          ? 'text-muted-foreground hover:text-foreground'
                          : 'cursor-not-allowed text-muted-foreground/40'
                    }`}
                  >
                    L{level}
                  </button>
                );
              })}
            </div>
            <span className="pr-1 text-[10px] text-muted-foreground">
              {pprLevel === 0 ? 'Summary' : 'Expanded'}
            </span>
          </Panel>
        )}
        <Panel position="top-right" className="!m-4 flex items-center gap-1 rounded-sm border border-border bg-card/95 p-1 shadow-sm backdrop-blur">
          {(isPositionEditable || perspective === 'levels') && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-2 rounded-sm text-xs"
              onClick={handleAutoLayout}
              title={perspective === 'levels' ? 'Automatically arrange this PPR layer' : 'Automatically arrange the graph'}
            >
              <Network className="h-3.5 w-3.5" /> {perspective === 'levels' ? 'Auto layout layer' : 'Auto layout'}
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-sm"
            onClick={() => void fitView({ padding: 0.2, duration: 250 })}
            title="Fit graph to view"
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </Button>
        </Panel>
        {flowModel?.diagram.usages.length === 0 && (
          <Panel
            position="top-center"
            data-testid={`empty-${perspective}-perspective`}
            className="!mt-16 border border-dashed border-accent/50 bg-card/95 px-5 py-4 text-center shadow-sm backdrop-blur"
          >
            <div className="aml-kicker text-accent">AutomationML / PPR model</div>
            <p className="mt-1 font-display text-lg uppercase tracking-wide text-foreground">
              {model.diagram.usages.length === 0
                ? 'Empty model workspace'
                : perspective === 'ppr'
                  ? 'No usages included in PPR'
                  : `No ${perspective} elements in this view`}
            </p>
            <p className="mt-1 max-w-xs text-xs text-muted-foreground">
              {model.diagram.usages.length === 0
                ? 'Create a Product, Process, or Resource to start mapping an interoperable engineering model.'
                : perspective === 'ppr'
                  ? 'Open an individual view and include the usages that belong in the main PPR diagram.'
                  : 'This perspective has no matching elements yet. Use its quick-create palette or place a matching Library definition.'}
            </p>
          </Panel>
        )}
      </ReactFlow>
      {relationshipDialog && (
        <CreateRelationshipDialog
          open
          onOpenChange={(open) => {
            if (!open) setRelationshipDialog(null);
          }}
          sourceId={relationshipDialog.sourceId}
          targetId={relationshipDialog.targetId}
          model={model}
          onCreateRelationship={onCreateRelationship}
        />
      )}
    </div>
  );
}

export function PprCanvas(props: PprCanvasProps) {
  return (
    <ReactFlowProvider>
      <PprFlowCanvas {...props} />
    </ReactFlowProvider>
  );
}
