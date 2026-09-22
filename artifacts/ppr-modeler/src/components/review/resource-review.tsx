import type { PprElement, PprModel } from '@workspace/api-client-react';
import { CircleAlert, Cog, GitBranch, Layers3, ShieldCheck, Users, ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  AnalysisFilterBar,
  AnalysisFrame,
  AnalysisIntegrityPanel,
  AnalysisRelationSection,
} from './analysis-view-shared';
import {
  ANALYSIS_FILTER_LABELS,
  getElementMap,
  getElementsByType,
  getResourceProcesses,
  getResourceAncestorIds,
  getResourceTree,
  type AnalysisFilter,
  type ResourceTreeEdge,
  type ResourceTreeProjection,
} from './analysis-utils';

interface ResourceReviewProps {
  model: PprModel;
  onSelectElement: (id: string) => void;
  filter: AnalysisFilter;
  onFilterChange: (filter: AnalysisFilter) => void;
  selectedElementIds: Set<string>;
  contextElementIds: Set<string>;
  hasActiveContext: boolean;
  selectedRelationshipIds: Set<string>;
  contextRelationshipIds: Set<string>;
  expandedResourceIds: Set<string>;
  onToggleResourceExpansion: (resourceId: string) => void;
  onSelectRelationship: (relationshipId: string) => void;
}

function ResourceTreeRow({
  resource,
  depth,
  path,
  edge,
  model,
  elementsById,
  projection,
  onSelectElement,
  onSelectRelationship,
  filter,
  selectedElementIds,
  contextElementIds,
  selectedRelationshipIds,
  contextRelationshipIds,
  hasActiveContext,
  expandedResourceIds,
  forcedExpandedResourceIds,
  onToggleResourceExpansion,
}: {
  resource: PprElement;
  depth: number;
  path: string[];
  edge?: ResourceTreeEdge;
  model: PprModel;
  elementsById: Map<string, PprElement>;
  projection: ResourceTreeProjection;
  onSelectElement: (id: string) => void;
  onSelectRelationship: (relationshipId: string) => void;
  filter: AnalysisFilter;
  selectedElementIds: Set<string>;
  contextElementIds: Set<string>;
  selectedRelationshipIds: Set<string>;
  contextRelationshipIds: Set<string>;
  hasActiveContext: boolean;
  expandedResourceIds: Set<string>;
  forcedExpandedResourceIds: Set<string>;
  onToggleResourceExpansion: (resourceId: string) => void;
}) {
  const childEdges = projection.childrenByResourceId.get(resource.id) ?? [];
  const isCycle = path.slice(0, -1).includes(resource.id);
  const isExpanded = expandedResourceIds.has(resource.id) || forcedExpandedResourceIds.has(resource.id);
  const hasChildren = childEdges.length > 0 && !isCycle;
  const isSelected = selectedElementIds.has(resource.id);
  const isContext = contextElementIds.has(resource.id);
  const isShared = projection.sharedResourceIds.has(resource.id);
  const isOrphan = projection.orphanResourceIds.has(resource.id);
  const performing = getResourceProcesses(model, elementsById, resource.id, 'performs');
  const supporting = getResourceProcesses(model, elementsById, resource.id, 'supports');

  return (
    <article
      data-testid={`card-resource-review-${resource.id}`}
      data-depth={depth}
      className={cn(
        'border border-border bg-card/60 transition-colors duration-150 hover:border-foreground/30',
        depth > 0 && 'ml-4 border-l-2 border-l-ppr-resource/35 sm:ml-8',
        isSelected && 'border-ring ring-1 ring-ring/60',
        !isSelected && isContext && 'border-primary/45',
      )}
    >
      {edge && (
        <div className="flex flex-wrap items-center gap-2 border-b border-border/80 bg-ppr-resource/5 px-3 py-2 text-[10px] text-muted-foreground">
          <span className="h-px w-3 bg-ppr-resource/50 sm:w-6" />
          <GitBranch className="h-3.5 w-3.5 shrink-0 text-ppr-resource" />
          <button
            type="button"
            data-testid={`button-resource-review-tree-relationship-${edge.relationshipId}`}
            onClick={() => onSelectRelationship(edge.relationshipId)}
            aria-pressed={selectedRelationshipIds.has(edge.relationshipId)}
            className={cn(
              'border px-1.5 py-1 font-mono uppercase tracking-[0.1em] transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              selectedRelationshipIds.has(edge.relationshipId)
                ? 'border-ring bg-primary/10 text-foreground ring-1 ring-ring/60'
                : 'border-border bg-background/60',
              contextRelationshipIds.has(edge.relationshipId) && !selectedRelationshipIds.has(edge.relationshipId) && 'border-primary/50 text-primary',
            )}
          >
            {edge.kind === 'contains' ? 'Contains' : 'Composed of'}
          </button>
        </div>
      )}
      <div className="flex items-stretch border-b border-border bg-muted/25">
        {hasChildren ? (
          <button
            type="button"
            data-testid={`button-resource-review-toggle-${resource.id}`}
            aria-label={isExpanded ? `Collapse ${resource.name}` : `Expand ${resource.name}`}
            aria-expanded={isExpanded}
            onClick={() => onToggleResourceExpansion(resource.id)}
            className="flex w-9 shrink-0 items-center justify-center border-r border-border text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        ) : (
          <span className="w-9 shrink-0" />
        )}
        <button
          type="button"
          data-testid={`button-resource-review-resource-${resource.id}`}
          onClick={() => onSelectElement(resource.id)}
          aria-pressed={isSelected}
          className="flex min-w-0 flex-1 items-start gap-3 px-3 py-3 text-left transition-colors hover:bg-muted/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-4"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center bg-ppr-resource text-primary-foreground">
            <Users className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="truncate font-display text-xl font-semibold uppercase tracking-wide text-foreground">{resource.name || 'Unnamed resource'}</span>
              <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">{resource.kind} · {resource.id.slice(0, 8)}</span>
            </span>
            {resource.description && <span className="mt-1 block max-w-3xl truncate text-xs text-muted-foreground">{resource.description}</span>}
          </span>
          <span className="hidden pt-1 font-mono text-[9px] uppercase tracking-wider text-muted-foreground sm:block">Inspect</span>
        </button>
        <div className="flex shrink-0 items-start gap-1 px-2 py-3">
          {isOrphan && <span className="border border-border bg-background/70 px-1.5 py-1 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">Standalone</span>}
          {isShared && <span className="border border-ppr-resource/25 bg-ppr-resource/10 px-1.5 py-1 font-mono text-[9px] uppercase tracking-wider text-ppr-resource">Shared</span>}
          {projection.cycleResourceIds.has(resource.id) && !isCycle && <span className="border border-accent/30 bg-accent/10 px-1.5 py-1 font-mono text-[9px] uppercase tracking-wider text-accent">Cycle</span>}
        </div>
      </div>
      {isCycle ? (
        <div data-testid={`resource-tree-cycle-${resource.id}`} className="flex items-center gap-2 border-b border-accent/20 bg-accent/5 px-3 py-2 text-[11px] text-accent sm:px-4">
          <CircleAlert className="h-3.5 w-3.5 shrink-0" />
          <span>Cycle detected — branch truncated to keep the resource tree finite.</span>
        </div>
      ) : (
        <div className={cn('grid gap-5 p-4', filter === 'all' ? 'md:grid-cols-2' : 'md:grid-cols-1')}>
          {(filter === 'all' || filter === 'performs') && (
            <AnalysisRelationSection
              testId={`resource-review-performing-${resource.id}`}
              testIdPrefix="resource-review"
              label="Performing"
              elements={performing}
              icon={Cog}
              emptyText="No performing assignment"
              onSelectElement={onSelectElement}
              selectedElementIds={selectedElementIds}
              contextElementIds={contextElementIds}
              hasActiveContext={hasActiveContext}
            />
          )}
          {(filter === 'all' || filter === 'supports') && (
            <AnalysisRelationSection
              testId={`resource-review-supporting-${resource.id}`}
              testIdPrefix="resource-review"
              label="Supporting"
              elements={supporting}
              icon={ShieldCheck}
              emptyText="No supporting assignment"
              onSelectElement={onSelectElement}
              selectedElementIds={selectedElementIds}
              contextElementIds={contextElementIds}
              hasActiveContext={hasActiveContext}
            />
          )}
        </div>
      )}
      {hasChildren && isExpanded && (
        <div data-testid={`resource-tree-children-${resource.id}`} className="space-y-2 border-t border-ppr-resource/15 bg-background/35 p-2 sm:p-3">
          {childEdges.map((childEdge) => {
            const child = elementsById.get(childEdge.childResourceId);
            if (!child) return null;
            return (
              <ResourceTreeRow
                key={childEdge.id}
                resource={child}
                depth={depth + 1}
                path={[...path, child.id]}
                edge={childEdge}
                model={model}
                elementsById={elementsById}
                projection={projection}
                onSelectElement={onSelectElement}
                onSelectRelationship={onSelectRelationship}
                filter={filter}
                selectedElementIds={selectedElementIds}
                contextElementIds={contextElementIds}
                selectedRelationshipIds={selectedRelationshipIds}
                contextRelationshipIds={contextRelationshipIds}
                hasActiveContext={hasActiveContext}
                expandedResourceIds={expandedResourceIds}
                forcedExpandedResourceIds={forcedExpandedResourceIds}
                onToggleResourceExpansion={onToggleResourceExpansion}
              />
            );
          })}
        </div>
      )}
    </article>
  );
}

export function ResourceReview({
  model,
  onSelectElement,
  filter,
  onFilterChange,
  selectedElementIds,
  contextElementIds,
  hasActiveContext,
  selectedRelationshipIds,
  contextRelationshipIds,
  expandedResourceIds,
  onToggleResourceExpansion,
  onSelectRelationship,
}: ResourceReviewProps) {
  const elementsById = getElementMap(model);
  const resources = getElementsByType(model, 'resource');
  const resourceTree = getResourceTree(model);
  const forcedExpandedResourceIds = new Set<string>();
  selectedElementIds.forEach((elementId) => {
    if (!resourceTree.resources.some((resource) => resource.id === elementId)) return;
    getResourceAncestorIds(resourceTree, elementId).forEach((ancestorId) => forcedExpandedResourceIds.add(ancestorId));
  });
  const filteredRelationshipCount = filter === 'all'
    ? null
    : resources.reduce((count, resource) => count + getResourceProcesses(
      model,
      elementsById,
      resource.id,
      filter === 'performs' ? 'performs' : 'supports',
    ).length, 0);
  const filterOptions = [
    { value: 'all' as const, label: ANALYSIS_FILTER_LABELS.all },
    { value: 'performs' as const, label: ANALYSIS_FILTER_LABELS.performs },
    { value: 'supports' as const, label: ANALYSIS_FILTER_LABELS.supports },
  ];

  return (
    <AnalysisFrame
      model={model}
      testId="resource-review"
      testIdPrefix="resource-review"
      header={{
        eyebrow: 'Resource review / read only',
        title: 'Resource capability tree',
        description: `An explicit resource hierarchy for ${model.name}. Start with process-linked resources, then expand the tools, fixtures, and capabilities they contain.`,
      }}
    >
      <AnalysisFilterBar
        testIdPrefix="resource-review"
        value={filter}
        options={filterOptions}
        filteredRelationshipCount={filteredRelationshipCount}
        onChange={onFilterChange}
      />
      {resources.length === 0 ? (
        <div data-testid="empty-resource-review" className="mt-6 border border-dashed border-border bg-card/40 px-6 py-14 text-center">
          <Users className="mx-auto h-8 w-8 text-muted-foreground/50" />
          <p className="mt-3 font-display text-xl uppercase tracking-wide">No resource elements found</p>
          <p className="mt-1 text-sm text-muted-foreground">Add a resource in the graph workspace to build a resource-centric review.</p>
        </div>
      ) : (
        <section data-testid="resource-tree" className="mt-6 border border-ppr-resource/30 bg-card/60">
          <div className="flex flex-wrap items-center gap-3 border-b border-ppr-resource/20 bg-ppr-resource/5 px-4 py-3">
            <Layers3 className="h-4 w-4 text-ppr-resource" />
            <div>
              <h3 className="font-display text-xl font-semibold uppercase tracking-wide">Explicit capability tree</h3>
              <p className="text-xs text-muted-foreground">Resource links are canonical; expand branches to bring descendants into the graph.</p>
            </div>
            <span data-testid="text-resource-tree-summary" className="ml-auto font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              {resourceTree.resources.length} resources · {resourceTree.edges.length} tree links · {resourceTree.processLinkedResourceIds.size} process-linked
            </span>
          </div>
          <div className="space-y-3 p-3 sm:p-4">
            {resourceTree.roots.map((root) => (
              <ResourceTreeRow
                key={root.id}
                resource={root}
                depth={0}
                path={[root.id]}
                model={model}
                elementsById={elementsById}
                projection={resourceTree}
                onSelectElement={onSelectElement}
                onSelectRelationship={onSelectRelationship}
                filter={filter}
                selectedElementIds={selectedElementIds}
                contextElementIds={contextElementIds}
                selectedRelationshipIds={selectedRelationshipIds}
                contextRelationshipIds={contextRelationshipIds}
                hasActiveContext={hasActiveContext}
                expandedResourceIds={expandedResourceIds}
                forcedExpandedResourceIds={forcedExpandedResourceIds}
                onToggleResourceExpansion={onToggleResourceExpansion}
              />
            ))}
          </div>
        </section>
      )}
      {resources.length > 0 && resourceTree.roots.length === 0 && (
        <div data-testid="empty-resource-tree" className="mt-6 border border-dashed border-border bg-card/40 px-6 py-14 text-center">
          <Users className="mx-auto h-8 w-8 text-muted-foreground/50" />
          <p className="mt-3 font-display text-xl uppercase tracking-wide">No resource roots found</p>
          <p className="mt-1 text-sm text-muted-foreground">Check the resource hierarchy for a cycle or unresolved relationship.</p>
        </div>
      )}
      <AnalysisIntegrityPanel model={model} testIdPrefix="resource-review" perspective="resource" />
    </AnalysisFrame>
  );
}