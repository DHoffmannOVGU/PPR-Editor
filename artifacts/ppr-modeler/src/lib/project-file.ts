import type { PprDiagram, PprElement, PprLibrary, PprModel, PprRelationship } from '@workspace/api-client-react';
import type { Viewport } from '@xyflow/react';
import { modelToFlowEdges, modelToFlowNodes } from '@/components/canvas/ppr-flow-adapter';
import {
  getPprCanvasLayoutKey,
  getPprPerspectiveProjection,
  type PprCanvasLayouts,
  type PprCanvasLayoutPositions,
  type PprCanvasPerspective,
  type PprProductViewMode,
  type PprResourceViewMode,
} from '@/components/canvas/ppr-perspective';

export const PPR_PROJECT_FILE_TYPE = 'ppr-modeler-project';
export const PPR_PROJECT_SCHEMA_VERSION = 1;

export type ProjectWorkspaceSurface = 'graph' | 'library' | 'levels' | 'item' | 'process' | 'product' | 'resource';

export type ProjectFlowNode = {
  id: string;
  type: string;
  position: { x: number; y: number };
  parentId?: string;
  extent?: 'parent';
  style?: { width?: number; height?: number };
  data: {
    element?: PprElement;
    endpoint?: 'source' | 'target';
    endpoint_id?: string;
    relationship_id?: string;
    is_process_container?: boolean;
    parent_process_id?: string;
    is_resource_container?: boolean;
    parent_resource_id?: string;
  };
};

export type ProjectFlowEdge = {
  id: string;
  type: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  data: {
    relationship?: PprRelationship;
    is_derived: boolean;
    label?: string;
    related_element_id?: string;
  };
};

export type ProjectFlowSnapshot = {
  nodes: ProjectFlowNode[];
  edges: ProjectFlowEdge[];
  viewport: Viewport;
  viewport_saved: boolean;
};

export type PprProjectFile = {
  file_type: typeof PPR_PROJECT_FILE_TYPE;
  schema_version: typeof PPR_PROJECT_SCHEMA_VERSION;
  saved_at: string;
  project: Pick<PprModel, 'id' | 'name' | 'description'>;
  library: PprLibrary;
  diagram: PprDiagram;
  react_flow: Record<PprCanvasPerspective, ProjectFlowSnapshot>;
  workspace: {
    surface: ProjectWorkspaceSurface;
    /** Retained as a fixed marker so version-one project files stay compatible. */
    process_view_mode: 'nested';
    product_view_mode: PprProductViewMode;
    resource_view_mode?: PprResourceViewMode;
  };
};

type CreateProjectFileOptions = Omit<PprProjectFile['workspace'], 'process_view_mode'> & {
  viewports?: Partial<Record<PprCanvasPerspective, Viewport>>;
  layouts?: PprCanvasLayouts;
};

const DEFAULT_VIEWPORT: Viewport = { x: 0, y: 0, zoom: 1 };
const REQUIRED_PERSPECTIVES: PprCanvasPerspective[] = ['ppr', 'process', 'product', 'resource'];
const PERSPECTIVES: PprCanvasPerspective[] = ['ppr', 'levels', 'process', 'product', 'resource'];

function buildFlowSnapshot(
  model: PprModel,
  perspective: PprCanvasPerspective,
  productViewMode: PprProductViewMode,
  resourceViewMode: PprResourceViewMode,
  viewport?: Viewport,
  layoutPositions?: PprCanvasLayoutPositions,
): ProjectFlowSnapshot {
  const projection = getPprPerspectiveProjection(model, perspective, productViewMode, 0, resourceViewMode);
  const nodes = modelToFlowNodes(
    projection.model,
    new Set(),
    new Set(),
    new Set(),
    undefined,
    new Map(),
    {
      parentByElementId: projection.parentByElementId,
      containerDimensions: projection.containerDimensions,
      containerKinds: projection.containerKinds,
    },
  ).map((node): ProjectFlowNode => {
    if (node.type === 'pprNode') {
      return {
        id: node.id,
        type: node.type,
        position: node.position,
        ...(node.parentId ? { parentId: node.parentId, extent: 'parent' as const } : {}),
        ...(node.style && typeof node.style === 'object'
          ? { style: { width: Number(node.style.width) || undefined, height: Number(node.style.height) || undefined } }
          : {}),
        data: {
          element: node.data.element,
          is_process_container: node.data.isProcessContainer,
          parent_process_id: node.data.parentProcessId,
          is_resource_container: node.data.isResourceContainer,
          parent_resource_id: node.data.parentResourceId,
        },
      };
    }
    return {
      id: node.id,
      type: node.type ?? 'missingEndpoint',
      position: node.position,
      data: {
        endpoint: node.data.endpoint,
        endpoint_id: node.data.endpointId,
        relationship_id: node.data.relationshipId,
      },
    };
  }).map((node) => {
    const position = node.data.element ? layoutPositions?.[node.id] : undefined;
    return position ? { ...node, position } : node;
  });
  const edges = modelToFlowEdges(projection.model, new Set()).map((edge): ProjectFlowEdge => {
    const derived = projection.derivedEdges.get(edge.id);
    return {
      id: edge.id,
      type: edge.type ?? 'pprEdge',
      source: edge.source,
      target: edge.target,
      sourceHandle: perspective === 'resource' ? 'source-bottom' : edge.sourceHandle,
      targetHandle: perspective === 'resource' ? 'target-top' : edge.targetHandle,
      data: {
        relationship: edge.data?.relationship,
        is_derived: Boolean(derived),
        ...(derived?.label ? { label: derived.label } : {}),
        ...(derived?.relatedElementId ? { related_element_id: derived.relatedElementId } : {}),
      },
    };
  });

  return {
    nodes,
    edges,
    viewport: viewport ?? DEFAULT_VIEWPORT,
    viewport_saved: Boolean(viewport),
  };
}

export function createPprProjectFile(model: PprModel, options: CreateProjectFileOptions): PprProjectFile {
  const resourceViewMode = options.resource_view_mode ?? 'contains';
  const reactFlow = Object.fromEntries(PERSPECTIVES.map((perspective) => {
    const layoutKey = getPprCanvasLayoutKey(
      perspective,
      options.product_view_mode,
      0,
      resourceViewMode,
    );
    return [
      perspective,
      buildFlowSnapshot(
        model,
        perspective,
        options.product_view_mode,
        resourceViewMode,
        options.viewports?.[perspective],
        perspective === 'ppr' ? undefined : options.layouts?.[layoutKey],
      ),
    ];
  })) as Record<PprCanvasPerspective, ProjectFlowSnapshot>;

  return {
    file_type: PPR_PROJECT_FILE_TYPE,
    schema_version: PPR_PROJECT_SCHEMA_VERSION,
    saved_at: new Date().toISOString(),
    project: { id: model.id, name: model.name, description: model.description },
    library: model.library,
    diagram: model.diagram,
    react_flow: reactFlow,
    workspace: {
      surface: options.surface,
      process_view_mode: 'nested',
      product_view_mode: options.product_view_mode,
      resource_view_mode: options.resource_view_mode ?? 'contains',
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isPprProjectFile(value: unknown): value is PprProjectFile {
  if (!isRecord(value)) return false;
  if (value.file_type !== PPR_PROJECT_FILE_TYPE || value.schema_version !== PPR_PROJECT_SCHEMA_VERSION) return false;
  if (!isRecord(value.project) || !isRecord(value.library) || !isRecord(value.diagram)) return false;
  if (!Array.isArray(value.library.definitions) || !Array.isArray(value.diagram.usages) || !Array.isArray(value.diagram.relationships)) return false;
  if (!isRecord(value.react_flow) || !isRecord(value.workspace)) return false;
  const reactFlow = value.react_flow;
  return REQUIRED_PERSPECTIVES.every((perspective) => {
    const snapshot = reactFlow[perspective];
    return isRecord(snapshot) && Array.isArray(snapshot.nodes) && Array.isArray(snapshot.edges) && isRecord(snapshot.viewport);
  }) && (
    reactFlow.levels === undefined
    || (isRecord(reactFlow.levels)
      && Array.isArray(reactFlow.levels.nodes)
      && Array.isArray(reactFlow.levels.edges)
      && isRecord(reactFlow.levels.viewport))
  );
}

export function parsePprProjectFile(value: unknown): PprProjectFile {
  if (!isPprProjectFile(value)) {
    throw new Error('This is not a supported PPR project file.');
  }
  if (value.react_flow.levels) return value;
  return {
    ...value,
    react_flow: {
      ...value.react_flow,
      levels: {
        nodes: [],
        edges: [],
        viewport: DEFAULT_VIEWPORT,
        viewport_saved: false,
      },
    },
  };
}

export function getProjectModel(projectFile: PprProjectFile): PprModel {
  return {
    id: projectFile.project.id,
    name: projectFile.project.name,
    description: projectFile.project.description,
    library: projectFile.library,
    diagram: projectFile.diagram,
  };
}

export function getSavedProjectViewports(projectFile: PprProjectFile) {
  return Object.fromEntries(PERSPECTIVES.flatMap((perspective) => {
    const snapshot = projectFile.react_flow[perspective];
    return snapshot.viewport_saved ? [[perspective, snapshot.viewport]] : [];
  })) as Partial<Record<PprCanvasPerspective, Viewport>>;
}

export function getSavedProjectLayouts(projectFile: PprProjectFile): PprCanvasLayouts {
  const resourceViewMode = projectFile.workspace.resource_view_mode ?? 'contains';
  const layouts: PprCanvasLayouts = {};
  PERSPECTIVES.forEach((perspective) => {
    if (perspective === 'ppr') return;
    const positions = Object.fromEntries(
      projectFile.react_flow[perspective].nodes.flatMap((node) => {
        if (
          !node.data.element
          || !Number.isFinite(node.position.x)
          || !Number.isFinite(node.position.y)
        ) return [];
        return [[node.id, node.position]];
      }),
    ) as PprCanvasLayoutPositions;
    if (Object.keys(positions).length === 0) return;
    const layoutKey = getPprCanvasLayoutKey(
      perspective,
      projectFile.workspace.product_view_mode,
      0,
      resourceViewMode,
    );
    layouts[layoutKey] = positions;
  });
  return layouts;
}

export function getPprProjectFilename(model: PprModel) {
  const base = model.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'untitled';
  return `${base}.ppr-project.json`;
}
