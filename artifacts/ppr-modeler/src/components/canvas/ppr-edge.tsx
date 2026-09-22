import { BaseEdge, EdgeLabelRenderer, MarkerType, Position, getBezierPath, type EdgeProps } from '@xyflow/react';
import { AlertTriangle, Boxes, X } from 'lucide-react';
import type { PprRelationshipKind } from '@workspace/api-client-react';
import { cn } from '@/lib/utils';
import type { PprEdgeData, PprFlowEdge } from './ppr-flow-adapter';

const KIND_LABELS: Record<PprRelationshipKind, string> = {
  consumed_by: 'Consumed by',
  produces: 'Produces',
  performs: 'Performs',
  succeeds: 'Precedes',
  contains: 'Contains',
  becomes: 'Becomes',
};

export function PprEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition = Position.Bottom,
  targetPosition = Position.Top,
  selected = false,
  data,
}: EdgeProps<PprFlowEdge>) {
  if (!data) return null;
  const edgeData: PprEdgeData = data;
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    curvature: 0.25,
  });
  const relationship = edgeData.relationship;
  const label = edgeData.label ?? KIND_LABELS[relationship.kind];
  const isComposition = relationship.kind === 'contains';
  const isProductFlow = relationship.kind === 'succeeds' && Boolean(edgeData.isDerived);
  const isProductAssembly = Boolean(edgeData.isProductAssembly);
  const isProductState = Boolean(edgeData.isProductState);
  const isProblem = Boolean(edgeData.problem);
  const isContext = Boolean(edgeData.isContext);
  const isFocusMode = Boolean(edgeData.isFocusMode);
  const remoteSelections = edgeData.remoteSelections ?? [];
  const remoteSelectionColor = remoteSelections[0]?.color;
  const shouldRenderLabel = !isProductState && ((edgeData.showLabel ?? true) || selected);
  const stroke = selected
    ? 'hsl(var(--ring))'
    : isContext
      ? 'hsl(var(--primary))'
      : remoteSelectionColor
        ? remoteSelectionColor
        : isProductFlow
          ? 'hsl(var(--ppr-product))'
        : isProductAssembly
          ? 'hsl(var(--ppr-product))'
        : isProductState
          ? 'hsl(var(--primary))'
      : isProblem
        ? 'hsl(var(--accent))'
        : 'hsl(var(--muted-foreground))';

  return (
    <>
      <BaseEdge
        id={id}
        data-testid={isProductState ? `identity-rail-${id}` : undefined}
        path={edgePath}
        markerEnd={isComposition || isProductState ? undefined : MarkerType.ArrowClosed}
        style={{
          stroke,
          strokeWidth: isProductState ? (selected ? 2 : 1.25) : selected || isContext || remoteSelections.length > 0 || isProductFlow || isProductAssembly ? 3 : 2,
          strokeDasharray: isComposition || isProductAssembly ? '4,4' : isProductFlow ? '8,5' : undefined,
          opacity: remoteSelections.length > 0 && !selected && !isContext ? 0.72 : 1,
        }}
      />
      {shouldRenderLabel && (
        <EdgeLabelRenderer>
          <div
            className="ppr-edge-label nodrag nopan pointer-events-none absolute"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              zIndex: 10_000,
            }}
          >
            <div
              data-testid={`edge-ppr-${relationship.id}`}
              className={cn(
                'flex items-center gap-1 rounded-sm border bg-card px-2 py-1 font-mono text-[10px] font-bold shadow-sm transition-colors',
                selected ? 'border-ring text-foreground'
                  : isProductFlow || isProductAssembly
                    ? 'border-[hsl(var(--ppr-product))] text-[hsl(var(--ppr-product))]'
                    : isProductState
                      ? 'border-primary text-primary'
                      : isProblem ? 'border-accent/60 text-accent' : 'border-border text-foreground',
                isContext && !selected && 'border-primary/50 text-primary',
                remoteSelectionColor && !selected && !isContext && 'border-current/60',
              )}
              aria-label={
                isProductFlow
                  ? `Product flow: ${label}`
                  : isProductAssembly
                    ? `Product assembly: ${label}`
                    : isProductState
                      ? `Product state transfer: ${label}`
                      : label
              }
              title={edgeData.problem?.detail}
              onClick={() => edgeData.onSelect?.(relationship.id)}
            >
              {isProblem && <AlertTriangle className="h-3 w-3 shrink-0 text-accent" />}
              {isProductFlow && (
                <span
                  data-testid={`product-flow-label-${relationship.id}`}
                  className="flex items-center gap-1 border-r border-[hsl(var(--ppr-product)/0.35)] pr-1.5 text-[9px] uppercase tracking-[0.12em]"
                >
                  <Boxes className="h-3 w-3 shrink-0" aria-hidden="true" />
                  Product flow
                </span>
              )}
              {isProductAssembly && (
                <span className="flex items-center gap-1 border-r border-[hsl(var(--ppr-product)/0.35)] pr-1.5 text-[9px] uppercase tracking-[0.12em]">
                  <Boxes className="h-3 w-3 shrink-0" aria-hidden="true" />
                  Assembly
                </span>
              )}
              <span>{label}</span>
              {selected && edgeData.onDelete && (
                <button
                  type="button"
                  aria-label={`Delete ${KIND_LABELS[relationship.kind]} relationship`}
                  className="pointer-events-auto ml-1 flex h-4 w-4 items-center justify-center rounded-sm bg-destructive text-destructive-foreground transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={(event) => {
                    event.stopPropagation();
                    edgeData.onDelete?.(relationship.id);
                  }}
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
