import type { PprElement, PprModel, RelationshipUpdate } from '@workspace/api-client-react';
import { useEffect, useState } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, Boxes, Check, ChevronDown, ChevronRight, CircleAlert, GitBranch, Layers3, Pencil, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  AnalysisElementChip,
  AnalysisFilterBar,
  AnalysisFrame,
  AnalysisIntegrityPanel,
  AnalysisRelationSection,
} from './analysis-view-shared';
import {
  ANALYSIS_FILTER_LABELS,
  getElementMap,
  getElementsByType,
  getProductBom,
  getProductProcesses,
  type AnalysisFilter,
  type ProductBomEdge,
  type ProductBomProjection,
} from './analysis-utils';

interface ProductReviewProps {
  model: PprModel;
  onSelectElement: (id: string) => void;
  filter: AnalysisFilter;
  onFilterChange: (filter: AnalysisFilter) => void;
  selectedElementIds: Set<string>;
  contextElementIds: Set<string>;
  hasActiveContext: boolean;
  onUpdateRelationship: (id: string, updates: RelationshipUpdate) => void;
}

function ProductFlowContext({
  product,
  model,
  elementsById,
  onSelectElement,
  filter,
}: {
  product: PprElement;
  model: PprModel;
  elementsById: Map<string, PprElement>;
  onSelectElement: (id: string) => void;
  filter: AnalysisFilter;
}) {
  const upstream = getProductProcesses(model, elementsById, product.id, 'upstream');
  const downstream = getProductProcesses(model, elementsById, product.id, 'downstream');

  return (
    <div className={cn('grid gap-3 border-t border-border/80 p-3', filter === 'all' ? 'md:grid-cols-2' : 'md:grid-cols-1')}>
      {(filter === 'all' || filter === 'produces') && (
        <AnalysisRelationSection
          testId={`product-review-upstream-${product.id}`}
          testIdPrefix="product-review"
          label="Produced by"
          elements={upstream}
          icon={ArrowDownToLine}
          emptyText="No producing process"
          onSelectElement={onSelectElement}
        />
      )}
      {(filter === 'all' || filter === 'consumed_by') && (
        <AnalysisRelationSection
          testId={`product-review-downstream-${product.id}`}
          testIdPrefix="product-review"
          label="Consumed by"
          elements={downstream}
          icon={ArrowUpFromLine}
          emptyText="No consuming process"
          onSelectElement={onSelectElement}
        />
      )}
    </div>
  );
}

function ProductBomRow({
  product,
  depth,
  path,
  edge,
  model,
  elementsById,
  projection,
  onSelectElement,
  filter,
  selectedElementIds,
  contextElementIds,
  hasActiveContext,
  onUpdateRelationship,
}: {
  product: PprElement;
  depth: number;
  path: string[];
  edge?: ProductBomEdge;
  model: PprModel;
  elementsById: Map<string, PprElement>;
  projection: ProductBomProjection;
  onSelectElement: (id: string) => void;
  filter: AnalysisFilter;
  selectedElementIds: Set<string>;
  contextElementIds: Set<string>;
  hasActiveContext: boolean;
  onUpdateRelationship: (id: string, updates: RelationshipUpdate) => void;
}) {
  const childEdges = projection.childrenByProductId.get(product.id) ?? [];
  const isCycle = path.slice(0, -1).includes(product.id);
  const [expanded, setExpanded] = useState(depth < 2);
  const isSelected = selectedElementIds.has(product.id);
  const isContext = contextElementIds.has(product.id);
  const isOrphan = projection.orphanProductIds.has(product.id);
  const isShared = projection.sharedProductIds.has(product.id);
  const hasChildren = childEdges.length > 0 && !isCycle;
  const quantityLabel = edge?.quantity == null ? 'Unspecified' : String(edge.quantity);

  return (
    <article
      data-testid={`card-product-review-${product.id}`}
      data-depth={depth}
      className={cn(
        'relative border border-border bg-card/60 transition-colors duration-150 hover:border-foreground/30',
        depth > 0 && 'ml-4 border-l-2 border-l-ppr-product/35 sm:ml-8',
        isSelected && 'border-ring ring-1 ring-ring/60',
        !isSelected && isContext && 'border-primary/45',
      )}
    >
      {edge && (
        <div data-testid={`product-bom-link-${edge.id}`} className="flex items-center gap-2 border-b border-border/70 bg-ppr-process/5 px-3 py-1.5 text-[10px] text-muted-foreground">
          <span className="h-px w-3 bg-ppr-process/50 sm:w-6" />
          <GitBranch className="h-3.5 w-3.5 shrink-0 text-ppr-process" />
          <span className="font-mono uppercase tracking-[0.1em]">Built from</span>
          {edge.isAmbiguous && (
            <span className="border border-accent/30 bg-accent/10 px-1.5 py-1 font-mono text-[9px] uppercase tracking-wider text-accent" title="This process has multiple outputs, so the input-to-output assignment is inferred">
              Ambiguous flow
            </span>
          )}
          {elementsById.get(edge.processId) && (
            <AnalysisElementChip
              element={elementsById.get(edge.processId)!}
              testIdPrefix="product-review-bom-process"
              onSelectElement={onSelectElement}
            />
          )}
        </div>
      )}
      <div className="flex items-stretch border-b border-border bg-muted/25">
        {hasChildren ? (
          <button
            type="button"
            data-testid={`button-product-review-toggle-${product.id}`}
            aria-label={expanded ? `Collapse ${product.name}` : `Expand ${product.name}`}
            aria-expanded={expanded}
            onClick={() => setExpanded((current) => !current)}
            className="flex w-9 shrink-0 items-center justify-center border-r border-border text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        ) : (
          <span className="w-9 shrink-0" />
        )}
        <button
          type="button"
          data-testid={`button-product-review-product-${product.id}`}
          onClick={() => onSelectElement(product.id)}
          aria-pressed={isSelected}
          className="flex min-w-0 flex-1 items-start gap-3 px-3 py-2 text-left transition-colors hover:bg-muted/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-4"
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center bg-ppr-product text-primary-foreground">
            <Boxes className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="truncate font-display text-lg font-semibold uppercase tracking-wide text-foreground">{product.name || 'Unnamed product'}</span>
              <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">{product.kind} · {product.id.slice(0, 8)}</span>
            </span>
            {product.description && <span className="block max-w-3xl truncate text-xs text-muted-foreground">{product.description}</span>}
          </span>
          {edge && (
            <span
              data-testid={`product-bom-quantity-${edge.id}`}
              className={cn(
                'flex shrink-0 flex-col items-end border-l border-border/70 pl-3 text-right font-mono text-[10px] uppercase tracking-wider',
                edge.quantity == null ? 'text-muted-foreground' : 'text-ppr-product',
              )}
              title={edge.quantity == null ? 'Input quantity is unspecified' : 'Input quantity'}
            >
              <span className="text-[9px] text-muted-foreground">Quantity</span>
              <span>{quantityLabel}{edge.unit ? ` ${edge.unit}` : ''}</span>
            </span>
          )}
        </button>
        {edge && (
          <ProductBomQuantityEditor
            edge={edge}
            onUpdateRelationship={onUpdateRelationship}
          />
        )}
        <div className="flex shrink-0 items-start gap-1 px-2 py-3">
          {isOrphan && <span className="border border-border bg-background/70 px-1.5 py-1 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">Standalone</span>}
          {isShared && <span className="border border-ppr-product/25 bg-ppr-product/10 px-1.5 py-1 font-mono text-[9px] uppercase tracking-wider text-ppr-product">Shared</span>}
          {projection.cycleProductIds.has(product.id) && !isCycle && <span className="border border-accent/30 bg-accent/10 px-1.5 py-1 font-mono text-[9px] uppercase tracking-wider text-accent">Cycle</span>}
        </div>
      </div>
      {isCycle ? (
        <div data-testid={`product-bom-cycle-${product.id}`} className="flex items-center gap-2 border-b border-accent/20 bg-accent/5 px-3 py-2 text-[11px] text-accent sm:px-4">
          <CircleAlert className="h-3.5 w-3.5 shrink-0" />
          <span>Cycle detected — branch truncated to keep the BOM finite.</span>
        </div>
      ) : (
        <ProductFlowContext
          product={product}
          model={model}
          elementsById={elementsById}
          onSelectElement={onSelectElement}
          filter={filter}
        />
      )}
      {hasChildren && expanded && (
        <div data-testid={`product-bom-children-${product.id}`} className="space-y-1.5 border-t border-ppr-product/15 bg-background/35 p-2 sm:p-3">
          {childEdges.map((childEdge) => {
            const child = elementsById.get(childEdge.childProductId);
            if (!child) return null;
            return (
              <ProductBomRow
                key={childEdge.id}
                product={child}
                depth={depth + 1}
                path={[...path, child.id]}
                edge={childEdge}
                model={model}
                elementsById={elementsById}
                projection={projection}
                onSelectElement={onSelectElement}
                filter={filter}
                selectedElementIds={selectedElementIds}
                contextElementIds={contextElementIds}
                hasActiveContext={hasActiveContext}
                onUpdateRelationship={onUpdateRelationship}
              />
            );
          })}
        </div>
      )}
    </article>
  );
}

export function ProductBomQuantityEditor({
  edge,
  onUpdateRelationship,
}: {
  edge: ProductBomEdge;
  onUpdateRelationship: (id: string, updates: RelationshipUpdate) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [quantityDraft, setQuantityDraft] = useState(edge.quantity == null ? '' : String(edge.quantity));
  const [unitDraft, setUnitDraft] = useState(edge.unit ?? '');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!editing) {
      setQuantityDraft(edge.quantity == null ? '' : String(edge.quantity));
      setUnitDraft(edge.unit ?? '');
    }
  }, [edge.quantity, edge.unit, editing]);

  const startEditing = () => {
    setQuantityDraft(edge.quantity == null ? '' : String(edge.quantity));
    setUnitDraft(edge.unit ?? '');
    setError(null);
    setEditing(true);
  };

  const cancelEditing = () => {
    setError(null);
    setEditing(false);
  };

  const save = () => {
    const trimmedQuantity = quantityDraft.trim();
    let quantity: number | null = null;
    if (trimmedQuantity) {
      const parsedQuantity = Number(trimmedQuantity);
      if (!Number.isFinite(parsedQuantity) || parsedQuantity < 0) {
        setError('Enter a number greater than or equal to 0, or leave it blank.');
        return;
      }
      quantity = parsedQuantity;
    }

    onUpdateRelationship(edge.inputRelationshipId, {
      quantity,
      unit: unitDraft.trim() || null,
    });
    setError(null);
    setEditing(false);
  };

  return (
    <div
      data-testid={`product-bom-quantity-editor-${edge.id}`}
      className="shrink-0 border-l border-border/70 px-3 py-2"
    >
      {!editing ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          data-testid={`button-product-bom-edit-${edge.id}`}
          onClick={startEditing}
          className="h-7 gap-1.5 px-2 text-[10px] uppercase tracking-wider text-muted-foreground"
        >
          <Pencil className="h-3 w-3" />
          Edit input
        </Button>
      ) : (
        <div className="w-[208px] space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
              Edit input
            </span>
            <button
              type="button"
              aria-label="Cancel input edit"
              data-testid={`button-product-bom-cancel-${edge.id}`}
              onClick={cancelEditing}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="grid grid-cols-[1fr_68px] gap-1.5">
            <div className="space-y-1">
              <Label htmlFor={`quantity-${edge.id}`} className="text-[9px] uppercase tracking-wider text-muted-foreground">
                Quantity
              </Label>
              <Input
                id={`quantity-${edge.id}`}
                data-testid={`product-bom-quantity-input-${edge.id}`}
                type="text"
                inputMode="decimal"
                value={quantityDraft}
                onChange={(event) => setQuantityDraft(event.target.value)}
                placeholder="Unspecified"
                className="h-7 rounded-sm bg-background px-2 font-mono text-xs"
                aria-invalid={Boolean(error)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`unit-${edge.id}`} className="text-[9px] uppercase tracking-wider text-muted-foreground">
                Unit
              </Label>
              <Input
                id={`unit-${edge.id}`}
                data-testid={`product-bom-unit-input-${edge.id}`}
                value={unitDraft}
                onChange={(event) => setUnitDraft(event.target.value)}
                placeholder="kg"
                className="h-7 rounded-sm bg-background px-2 font-mono text-xs"
              />
            </div>
          </div>
          {error && (
            <p
              data-testid={`product-bom-quantity-error-${edge.id}`}
              className="text-[10px] leading-tight text-destructive"
            >
              {error}
            </p>
          )}
          <Button
            type="button"
            size="sm"
            data-testid={`button-product-bom-save-${edge.id}`}
            onClick={save}
            className="h-7 w-full gap-1.5 text-[10px] uppercase tracking-wider"
          >
            <Check className="h-3 w-3" />
            Save input
          </Button>
        </div>
      )}
    </div>
  );
}

export function ProductReview({
  model,
  onSelectElement,
  filter,
  onFilterChange,
  selectedElementIds,
  contextElementIds,
  hasActiveContext,
  onUpdateRelationship,
}: ProductReviewProps) {
  const elementsById = getElementMap(model);
  const products = getElementsByType(model, 'product');
  const bom = getProductBom(model);
  const filteredRelationshipCount = filter === 'all'
    ? null
    : products.reduce((count, product) => count + getProductProcesses(
      model,
      elementsById,
      product.id,
      filter === 'produces' ? 'upstream' : 'downstream',
    ).length, 0);
  const filterOptions = [
    { value: 'all' as const, label: ANALYSIS_FILTER_LABELS.all },
    { value: 'produces' as const, label: 'Produced by' },
    { value: 'consumed_by' as const, label: 'Consumed by' },
  ];

  return (
    <AnalysisFrame
      model={model}
      testId="product-review"
      testIdPrefix="product-review"
      header={{
        eyebrow: 'Product review / editable BOM',
          title: 'Product BOM',
          description: `Edit input quantities and units directly on the flow-derived material structure for ${model.name}.`,
          showCounts: false,
          showLegend: false,
      }}
    >
      <AnalysisFilterBar
        testIdPrefix="product-review"
        value={filter}
        options={filterOptions}
        filteredRelationshipCount={filteredRelationshipCount}
        onChange={onFilterChange}
      />
      {products.length === 0 ? (
        <div data-testid="empty-product-review" className="mt-6 border border-dashed border-border bg-card/40 px-6 py-14 text-center">
          <Boxes className="mx-auto h-8 w-8 text-muted-foreground/50" />
          <p className="mt-3 font-display text-xl uppercase tracking-wide">No product elements found</p>
          <p className="mt-1 text-sm text-muted-foreground">Add a product in the graph workspace to build a product-centric review.</p>
        </div>
      ) : (
        <div className="mt-6 space-y-5">
          <section data-testid="product-bom-tree" className="border border-ppr-product/30 bg-card/60">
            <div className="flex flex-wrap items-center gap-3 border-b border-ppr-product/20 bg-ppr-product/5 px-4 py-2.5">
              <Layers3 className="h-4 w-4 text-ppr-product" />
              <div>
                <h3 className="font-display text-lg font-semibold uppercase tracking-wide">BOM structure</h3>
              </div>
              <span data-testid="text-product-bom-summary" className="ml-auto font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                {bom.products.length} products · {bom.childrenByProductId.size} parent nodes
              </span>
            </div>
            <div className="space-y-3 p-3 sm:p-4">
              {bom.roots.map((root) => (
                <ProductBomRow
                  key={root.id}
                  product={root}
                  depth={0}
                  path={[root.id]}
                  model={model}
                  elementsById={elementsById}
                  projection={bom}
                  onSelectElement={onSelectElement}
                  filter={filter}
                  selectedElementIds={selectedElementIds}
                  contextElementIds={contextElementIds}
                  hasActiveContext={hasActiveContext}
                  onUpdateRelationship={onUpdateRelationship}
                />
              ))}
            </div>
          </section>
        </div>
      )}
      <AnalysisIntegrityPanel model={model} testIdPrefix="product-review" />
    </AnalysisFrame>
  );
}
