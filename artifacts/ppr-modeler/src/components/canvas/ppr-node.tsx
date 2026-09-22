import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Boxes, Cog, Eye, EyeOff, Wrench, AlertTriangle } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PprElement } from '@workspace/api-client-react';
import { cn } from '@/lib/utils';
import type {
  MissingEndpointNode,
  MissingEndpointNodeData,
  PprModelNode,
  PprModelNodeData,
  PprRemoteSelection,
} from './ppr-flow-adapter';

const TYPE_ICONS = {
  product: Boxes,
  process: Cog,
  resource: Wrench,
} as const;

const typeClasses = {
  product: 'border-ppr-product text-ppr-product',
  process: 'border-ppr-process text-ppr-process',
  resource: 'border-ppr-resource text-ppr-resource',
} as const;

function InlineNodeName({
  element,
  onRename,
  isRenaming = false,
  onEndRename,
}: {
  element: PprElement;
  onRename?: (elementId: string, name: string) => void;
  isRenaming?: boolean;
  onEndRename?: () => void;
}) {
  const [draft, setDraft] = useState(element.name);
  const [isEditing, setIsEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const editingRef = useRef(false);

  useEffect(() => {
    if (isRenaming && !editingRef.current) {
      editingRef.current = true;
      setDraft(element.name);
      setIsEditing(true);
      return;
    }
    if (!isRenaming && !editingRef.current) setDraft(element.name);
  }, [element.name, isRenaming]);

  useEffect(() => {
    if (!isEditing) return;
    const frame = requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => cancelAnimationFrame(frame);
  }, [isEditing]);

  const finishEditing = useCallback((save: boolean) => {
    if (!editingRef.current) return;
    editingRef.current = false;
    setIsEditing(false);
    onEndRename?.();
    if (!save) return;

    const nextName = draft.trim();
    if (nextName && nextName !== element.name) {
      onRename?.(element.id, nextName);
    }
  }, [draft, element.id, element.name, onRename]);

  if (isEditing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => finishEditing(true)}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Enter') {
            event.preventDefault();
            finishEditing(true);
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            finishEditing(false);
          }
        }}
        onMouseDown={(event) => event.stopPropagation()}
        aria-label={`Edit ${element.name} name`}
        data-testid={`node-name-input-${element.id}`}
        className="nodrag nopan box-border h-5 min-w-0 flex-1 border border-ring bg-background px-1 py-0 text-sm font-semibold leading-tight text-foreground outline-none"
      />
    );
  }

  return (
    <h3
      className="min-w-0 flex-1 leading-tight font-semibold text-card-foreground"
      data-testid={`node-name-${element.id}`}
      title={onRename ? 'Double-click to rename' : undefined}
    >
      {element.name}
    </h3>
  );
}

function ElementNodeContent({
  element,
  selected,
  onRename,
  isRenaming = false,
  onEndRename,
  perspective = 'ppr',
  dataIsProcessContainer = false,
  containedProcessCount = 0,
  parentProcessId,
  dataIsResourceContainer = false,
  containedResourceCount = 0,
  parentResourceId,
  isContext = false,
  isFocusMode = false,
  remoteSelections = [],
}: {
  element: PprElement;
  selected: boolean;
  onRename?: (elementId: string, name: string) => void;
  isRenaming?: boolean;
  onEndRename?: () => void;
  perspective?: PprModelNodeData['perspective'];
  dataIsProcessContainer?: boolean;
  containedProcessCount?: number;
  parentProcessId?: string;
  dataIsResourceContainer?: boolean;
  containedResourceCount?: number;
  parentResourceId?: string;
  isContext?: boolean;
  isFocusMode?: boolean;
  remoteSelections?: PprRemoteSelection[];
}) {
  const Icon = TYPE_ICONS[element.type];
  const isProcessContainer = (perspective === 'process' || perspective === 'levels') && dataIsProcessContainer;
  const isResourceContainer = (perspective === 'resource' || perspective === 'levels') && dataIsResourceContainer;
  const isContainer = isProcessContainer || isResourceContainer;
  const remoteSelectionShadow = remoteSelections.length > 0
    ? remoteSelections.map((selection, index) => `0 0 0 ${3 + index * 3}px ${selection.color}`).join(', ')
    : undefined;
  const selectionShadow = [
    selected ? '0 0 0 3px hsl(var(--ring))' : undefined,
    remoteSelectionShadow,
  ].filter(Boolean).join(', ') || undefined;
  const hasVerticalHandles = perspective === 'product'
    || perspective === 'resource'
    || element.type !== 'resource';
  const hasHorizontalHandles = (perspective === 'ppr' || perspective === 'levels') && element.type !== 'product';
  const isVisibleInPpr = element.visible_in_ppr !== false;

  return (
    <div
      data-testid={`node-ppr-${element.id}`}
      data-ppr-visible={isVisibleInPpr ? 'true' : 'false'}
      data-process-container={isProcessContainer ? 'true' : undefined}
      data-resource-container={isResourceContainer ? 'true' : undefined}
      data-process-parent-id={parentProcessId}
      data-resource-parent-id={parentResourceId}
      className={cn(
      isContainer
        ? 'relative h-full w-full overflow-visible border-2 border-dashed bg-ppr-process/5 shadow-sm transition-shadow'
        : 'relative w-60 overflow-visible border-2 bg-card shadow-sm transition-shadow',
        typeClasses[element.type],
        selected && 'ring-2 ring-ring ring-offset-2 ring-offset-background shadow-md',
        !selected && isContext && 'ring-1 ring-primary/60 ring-offset-1 ring-offset-background',
        !selected && 'hover:shadow-md',
      )}
      style={{
        borderColor: `hsl(var(--ppr-${element.type}))`,
        backgroundColor: isContainer ? `hsl(var(--ppr-${isResourceContainer ? 'resource' : 'process'}) / 0.05)` : undefined,
        boxShadow: selectionShadow,
      }}
    >
      {remoteSelections.length > 0 && (
        <div className="pointer-events-none absolute -top-6 left-0 flex max-w-full gap-1">
          {remoteSelections.map((selection) => (
            <span
              key={selection.participantId}
              className="max-w-32 truncate rounded-sm border bg-card px-1.5 py-0.5 font-mono text-[10px] font-semibold shadow-sm"
              style={{ borderColor: selection.color, color: selection.color }}
              title={`${selection.name} selected ${element.name}`}
            >
              {selection.name}
            </span>
          ))}
        </div>
      )}
      {isContainer ? (
        <>
          <div
            className="flex items-center justify-between border-b px-3 py-2 text-[10px] font-mono font-bold uppercase tracking-[0.12em]"
            style={{
              borderColor: `hsl(var(--ppr-${isResourceContainer ? 'resource' : 'process'}) / 0.25)`,
              backgroundColor: `hsl(var(--ppr-${isResourceContainer ? 'resource' : 'process'}) / 0.15)`,
              color: `hsl(var(--ppr-${isResourceContainer ? 'resource' : 'process'}))`,
            }}
          >
            <span>{isResourceContainer ? 'Resource container' : 'Process container'}</span>
            <span className="flex items-center gap-2">
              <span
                className="flex items-center gap-1"
                title={isVisibleInPpr ? 'Included in PPR diagram' : 'Only visible in this individual view'}
              >
                {isVisibleInPpr ? <Eye className="h-2.5 w-2.5" /> : <EyeOff className="h-2.5 w-2.5" />}
                {isVisibleInPpr ? 'PPR' : 'View only'}
              </span>
              <span>
                {isResourceContainer
                  ? `${containedResourceCount} child resource${containedResourceCount === 1 ? '' : 's'}`
                  : `${containedProcessCount} subprocess${containedProcessCount === 1 ? '' : 'es'}`}
              </span>
            </span>
          </div>
          <div className="bg-card/90 p-3">
            <div className="flex items-start gap-2">
              <Icon className="h-5 w-5 shrink-0" style={{ color: `hsl(var(--ppr-${element.type}))` }} />
              <InlineNodeName
                element={element}
                onRename={onRename}
                isRenaming={isRenaming}
                onEndRename={onEndRename}
              />
            </div>
            {element.description && <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{element.description}</p>}
          </div>
          <div
            className="pointer-events-none absolute bottom-2 left-3 font-mono text-[9px] uppercase tracking-[0.12em]"
            style={{ color: `hsl(var(--ppr-${isResourceContainer ? 'resource' : 'process'}) / 0.75)` }}
          >
            {isResourceContainer ? 'Nested capability view' : 'Nested subprocess view'}
          </div>
        </>
      ) : (
        <>
          <div
            className="flex items-center px-3 py-1 text-xs font-mono font-bold tracking-tight text-white"
            style={{ backgroundColor: `hsl(var(--ppr-${element.type}))` }}
          >
            <span className="uppercase">{element.type}</span>
            {perspective !== 'ppr' && (
              <span
                className="ml-auto flex items-center gap-1 text-[8px] font-semibold uppercase tracking-[0.08em] text-white/90"
                title={isVisibleInPpr ? 'Included in PPR diagram' : 'Only visible in this individual view'}
              >
                {isVisibleInPpr ? <Eye className="h-2.5 w-2.5" /> : <EyeOff className="h-2.5 w-2.5" />}
                {isVisibleInPpr ? 'PPR' : 'View only'}
              </span>
            )}
          </div>

          <div className="p-3 pb-4">
            <div className="mb-2 flex items-start gap-2">
              <Icon className="h-5 w-5 shrink-0" style={{ color: `hsl(var(--ppr-${element.type}))` }} />
              <InlineNodeName
                element={element}
                onRename={onRename}
                isRenaming={isRenaming}
                onEndRename={onEndRename}
              />
              {element.type === 'product' && element.state && (
                <span
                  data-testid={`product-state-chip-${element.id}`}
                  className="shrink-0 border border-ppr-product/35 bg-ppr-product/10 px-1.5 py-0.5 font-mono text-[8px] font-semibold uppercase tracking-[0.08em] text-ppr-product"
                >
                  {element.state}
                </span>
              )}
            </div>

            {element.description && <p className="line-clamp-2 text-xs text-muted-foreground">{element.description}</p>}

            {element.attributes.length > 0 && (
              <div className="mt-2 grid grid-cols-2 gap-x-2 gap-y-1 border-t border-border pt-2 text-xs">
                {element.attributes.slice(0, 4).map((attribute) => (
                  <div key={attribute.id} className="col-span-2 flex justify-between">
                    <span className="truncate text-muted-foreground">{attribute.name}</span>
                    <span className="truncate pl-2 text-right font-mono font-medium text-card-foreground">
                      {attribute.value}
                      {attribute.unit && <span className="ml-1 text-muted-foreground">{attribute.unit}</span>}
                    </span>
                  </div>
                ))}
                {element.attributes.length > 4 && (
                  <div className="col-span-2 mt-1 text-[10px] text-muted-foreground">+ {element.attributes.length - 4} more</div>
                )}
              </div>
            )}
          </div>
        </>
      )}

      {hasVerticalHandles && (
        <Handle
          type="target"
          position={Position.Top}
          id="target-top"
          className="!h-3 !w-3 !border-2 !border-background"
          style={{ backgroundColor: `hsl(var(--ppr-${element.type}))` }}
          aria-label={`${element.name} top relationship target`}
        />
      )}
      {hasHorizontalHandles && (
        <Handle
          type="target"
          position={Position.Left}
          id="target-left"
          className="!h-3 !w-3 !border-2 !border-background"
          style={{ backgroundColor: `hsl(var(--ppr-${element.type}))` }}
          aria-label={`${element.name} left relationship target`}
        />
      )}
      {hasVerticalHandles && (
        <Handle
          type="source"
          position={Position.Bottom}
          id="source-bottom"
          className="!h-3 !w-3 !border-2 !border-background"
          style={{ backgroundColor: `hsl(var(--ppr-${element.type}))` }}
          aria-label={`${element.name} bottom relationship source`}
        />
      )}
      {hasHorizontalHandles && (
        <Handle
          type="source"
          position={Position.Right}
          id="source-right"
          className="!h-3 !w-3 !border-2 !border-background"
          style={{ backgroundColor: `hsl(var(--ppr-${element.type}))` }}
          aria-label={`${element.name} right relationship source`}
        />
      )}
    </div>
  );
}

export function PprNode({ data, selected }: NodeProps<PprModelNode>) {
  const nodeData: PprModelNodeData = data;
  return (
    <ElementNodeContent
      element={nodeData.element}
      selected={selected}
      onRename={nodeData.onRename}
      isRenaming={nodeData.isRenaming}
      onEndRename={nodeData.onEndRename}
      perspective={nodeData.perspective}
      dataIsProcessContainer={nodeData.isProcessContainer}
      containedProcessCount={nodeData.containedProcessCount}
      parentProcessId={nodeData.parentProcessId}
      dataIsResourceContainer={nodeData.isResourceContainer}
      containedResourceCount={nodeData.containedResourceCount}
      parentResourceId={nodeData.parentResourceId}
      isContext={nodeData.isContext}
      isFocusMode={nodeData.isFocusMode}
      remoteSelections={nodeData.remoteSelections}
    />
  );
}

export function MissingEndpointNode({ data }: NodeProps<MissingEndpointNode>) {
  const nodeData: MissingEndpointNodeData = data;
  return (
    <div
      data-testid={`node-missing-${nodeData.endpoint}-${nodeData.endpointId}`}
      className={cn(
        'w-60 border-2 border-dashed border-accent bg-accent/10 px-3 py-3 text-accent shadow-sm',
        nodeData.isContext && 'ring-1 ring-primary/60 ring-offset-1 ring-offset-background',
      )}
      title={`Missing ${nodeData.endpoint} endpoint ${nodeData.endpointId}`}
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="min-w-0">
          <div className="font-display text-base font-semibold uppercase tracking-wide">Missing endpoint</div>
          <div className="mt-1 break-all font-mono text-[10px] text-muted-foreground">{nodeData.endpointId}</div>
          <div className="mt-2 text-[10px] uppercase tracking-wider text-accent">
            {nodeData.endpoint} of {nodeData.relationshipId.slice(0, 8)}
          </div>
        </div>
      </div>
    </div>
  );
}
