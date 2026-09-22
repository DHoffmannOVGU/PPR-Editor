import { useMemo } from 'react';
import type { PprElement, PprModel } from '@workspace/api-client-react';
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpFromLine,
  Boxes,
  CircleAlert,
  CircleDashed,
  CornerDownRight,
  GitBranch,
  Layers3,
  Route,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  AnalysisElementChip,
  AnalysisFrame,
  AnalysisRelationSection,
} from './analysis-view-shared';
import {
  getProcessSpecification,
  type ProcessSpecificationFlow,
  type ProcessSpecificationProcessNode,
  type ProcessSpecificationProduct,
  type ProcessSpecificationProjection,
} from './process-specification-utils';

interface ProcessSpecificationProps {
  model: PprModel;
  onSelectElement: (id: string) => void;
  selectedElementIds: Set<string>;
  contextElementIds: Set<string>;
  hasActiveContext: boolean;
}

const chipPrefix = 'process-specification';

function elementIsSelected(element: PprElement, selectedElementIds: Set<string>) {
  return selectedElementIds.has(element.id);
}

function elementIsContext(element: PprElement, contextElementIds: Set<string>) {
  return contextElementIds.has(element.id);
}

function productRoleLabel(role: ProcessSpecificationProduct['role']) {
  switch (role) {
    case 'external-input':
      return 'External feed';
    case 'terminal-output':
      return 'Terminal output';
    case 'standalone':
      return 'Unconnected product';
    case 'boundary':
      return 'Stage bridge';
  }
}

function ProductChip({
  product,
  onSelectElement,
  selectedElementIds,
  contextElementIds,
  hasActiveContext,
}: {
  product: PprElement;
  onSelectElement: (id: string) => void;
  selectedElementIds: Set<string>;
  contextElementIds: Set<string>;
  hasActiveContext: boolean;
}) {
  return (
    <AnalysisElementChip
      element={product}
      testIdPrefix={chipPrefix}
      onSelectElement={onSelectElement}
      isSelected={elementIsSelected(product, selectedElementIds)}
      isContext={elementIsContext(product, contextElementIds)}
      hasActiveContext={hasActiveContext}
    />
  );
}

function ProductList({
  label,
  products,
  icon: Icon,
  onSelectElement,
  selectedElementIds,
  contextElementIds,
  hasActiveContext,
}: {
  label: string;
  products: PprElement[];
  icon: LucideIcon;
  onSelectElement: (id: string) => void;
  selectedElementIds: Set<string>;
  contextElementIds: Set<string>;
  hasActiveContext: boolean;
}) {
  if (products.length === 0) return null;

  return (
    <div className="border-t border-border/80 pt-2.5">
      <div className="mb-1.5 flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
        <Icon className="h-3 w-3 text-ppr-product" />
        <span>{label}</span>
        <span className="ml-auto text-foreground/55">{products.length.toString().padStart(2, '0')}</span>
      </div>
      <div className="space-y-1.5">
        {products.map((product) => (
          <ProductChip
            key={product.id}
            product={product}
            onSelectElement={onSelectElement}
            selectedElementIds={selectedElementIds}
            contextElementIds={contextElementIds}
            hasActiveContext={hasActiveContext}
          />
        ))}
      </div>
    </div>
  );
}

function ProcessNodeCard({
  node,
  onSelectElement,
  selectedElementIds,
  contextElementIds,
  hasActiveContext,
  path,
  nested = false,
}: {
  node: ProcessSpecificationProcessNode;
  onSelectElement: (id: string) => void;
  selectedElementIds: Set<string>;
  contextElementIds: Set<string>;
  hasActiveContext: boolean;
  path: Set<string>;
  nested?: boolean;
}) {
  const process = node.process;
  const selected = elementIsSelected(process, selectedElementIds);
  const context = elementIsContext(process, contextElementIds);
  const cycleDetected = node.isCycle || path.has(process.id);
  const nextPath = new Set(path);
  nextPath.add(process.id);

  return (
    <article
      data-testid={`process-specification-process-${process.id}`}
      className={cn(
        'min-w-[282px] border bg-card/80 transition-[border-color,opacity,transform] duration-200',
        nested ? 'border-border/80 bg-background/45' : 'border-border',
        'hover:-translate-y-px hover:border-foreground/35',
        selected && 'border-ring ring-1 ring-ring/60',
        !selected && context && 'border-primary/55',
      )}
    >
      <div className={cn('border-b border-border px-3 py-2.5', nested ? 'bg-muted/15' : 'bg-muted/25')}>
        <div className="mb-2 flex items-center justify-between gap-2 font-mono text-[9px] uppercase tracking-[0.15em] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            {nested ? <CornerDownRight className="h-3 w-3 text-ppr-process" /> : <Route className="h-3 w-3 text-ppr-process" />}
            {nested ? 'Contained operation' : 'Process stage'}
          </span>
          <span className="text-foreground/50">{process.id.slice(0, 8)}</span>
        </div>
        <AnalysisElementChip
          element={process}
          testIdPrefix={chipPrefix}
          onSelectElement={onSelectElement}
          isSelected={selected}
          isContext={context}
          hasActiveContext={hasActiveContext}
        />
        {process.description && (
          <p className="mt-2 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">{process.description}</p>
        )}
      </div>

      <div className="space-y-2.5 p-3">
        <ProductList
          label="Inputs"
          products={node.inputs}
          icon={ArrowDownToLine}
          onSelectElement={onSelectElement}
          selectedElementIds={selectedElementIds}
          contextElementIds={contextElementIds}
          hasActiveContext={hasActiveContext}
        />
        <ProductList
          label="Outputs"
          products={node.outputs}
          icon={ArrowUpFromLine}
          onSelectElement={onSelectElement}
          selectedElementIds={selectedElementIds}
          contextElementIds={contextElementIds}
          hasActiveContext={hasActiveContext}
        />

        {cycleDetected ? (
          <div
            data-testid={`process-specification-cycle-${process.id}`}
            className="flex items-start gap-2 border border-accent/35 bg-accent/5 px-2.5 py-2 text-[10px] text-accent"
          >
            <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              <strong className="font-semibold uppercase tracking-[0.12em]">Cycle boundary</strong>
              <span className="mt-0.5 block font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                Recursion halted at this operation
              </span>
            </span>
          </div>
        ) : node.children.length > 0 ? (
          <div data-testid={`process-specification-nested-${process.id}`} className="border-t border-border/80 pt-2.5">
            <div className="mb-1.5 flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
              <Layers3 className="h-3 w-3 text-ppr-process" />
              <span>Contained subprocesses</span>
              <span className="ml-auto text-foreground/55">{node.children.length.toString().padStart(2, '0')}</span>
            </div>
            <div className="space-y-2">
              {node.children.map((child) => (
                <ProcessNodeCard
                  key={child.process.id}
                  node={child}
                  onSelectElement={onSelectElement}
                  selectedElementIds={selectedElementIds}
                  contextElementIds={contextElementIds}
                  hasActiveContext={hasActiveContext}
                  path={nextPath}
                  nested
                />
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </article>
  );
}

function FlowBridge({
  flow,
  projection,
  onSelectElement,
  selectedElementIds,
  contextElementIds,
  hasActiveContext,
}: {
  flow: ProcessSpecificationFlow;
  projection: ProcessSpecificationProjection;
  onSelectElement: (id: string) => void;
  selectedElementIds: Set<string>;
  contextElementIds: Set<string>;
  hasActiveContext: boolean;
}) {
  const processById = useMemo(
    () => new Map(projection.processes.map((process) => [process.id, process])),
    [projection.processes],
  );
  const source = processById.get(flow.sourceProcessId);
  const target = processById.get(flow.targetProcessId);
  const product = flow.productId
    ? projection.products.find((item) => item.product.id === flow.productId)?.product
    : undefined;

  if (!source || !target) return null;

  return (
    <div
      data-testid={`process-specification-bridge-${flow.id}`}
      className="flex min-w-[640px] items-center gap-2 border-y border-dashed border-border/80 bg-background/35 px-3 py-2.5 transition-colors duration-150 hover:border-foreground/30"
    >
      <button
        type="button"
        data-testid={`button-process-specification-flow-source-${source.id}`}
        onClick={() => onSelectElement(source.id)}
        className={cn(
          'min-w-[136px] border px-2.5 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          elementIsSelected(source, selectedElementIds) && 'border-ring bg-primary/10',
          !elementIsSelected(source, selectedElementIds) && elementIsContext(source, contextElementIds) && 'border-primary/50 bg-primary/5',
        )}
      >
        <span className="block truncate font-display text-sm font-semibold uppercase tracking-wide">{source.name || 'Unnamed process'}</span>
        <span className="mt-0.5 block font-mono text-[9px] uppercase tracking-wider text-muted-foreground">source stage</span>
      </button>

      <div className="flex min-w-[94px] flex-1 items-center gap-2">
        <span className="h-px flex-1 bg-border" />
        {product ? (
          <div className="w-[190px] shrink-0">
            <ProductChip
              product={product}
              onSelectElement={onSelectElement}
              selectedElementIds={selectedElementIds}
              contextElementIds={contextElementIds}
              hasActiveContext={hasActiveContext}
            />
          </div>
        ) : (
          <span className="shrink-0 border border-dashed border-border px-2 py-1 font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
            Direct flow
          </span>
        )}
        <ArrowRight className={cn('h-4 w-4 shrink-0 text-ppr-process', flow.kind === 'direct' && 'text-muted-foreground')} />
        <span className="h-px flex-1 bg-border" />
      </div>

      <button
        type="button"
        data-testid={`button-process-specification-flow-target-${target.id}`}
        onClick={() => onSelectElement(target.id)}
        className={cn(
          'min-w-[136px] border px-2.5 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          elementIsSelected(target, selectedElementIds) && 'border-ring bg-primary/10',
          !elementIsSelected(target, selectedElementIds) && elementIsContext(target, contextElementIds) && 'border-primary/50 bg-primary/5',
        )}
      >
        <span className="block truncate font-display text-sm font-semibold uppercase tracking-wide">{target.name || 'Unnamed process'}</span>
        <span className="mt-0.5 block font-mono text-[9px] uppercase tracking-wider text-muted-foreground">target stage</span>
      </button>
      <span className="hidden w-[82px] font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground lg:block">
        {flow.kind === 'product' ? 'material bridge' : 'relationship'}
      </span>
    </div>
  );
}

function EdgeSection({
  title,
  description,
  testId,
  products,
  icon: Icon,
  emptyText,
  onSelectElement,
  selectedElementIds,
  contextElementIds,
  hasActiveContext,
}: {
  title: string;
  description: string;
  testId: string;
  products: ProcessSpecificationProduct[];
  icon: LucideIcon;
  emptyText: string;
  onSelectElement: (id: string) => void;
  selectedElementIds: Set<string>;
  contextElementIds: Set<string>;
  hasActiveContext: boolean;
}) {
  return (
    <section data-testid={testId} className="border border-border bg-card/45 p-3.5">
      <div className="mb-3 flex items-start gap-2.5">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center border border-ppr-product/30 bg-ppr-product/10 text-ppr-product">
          <Icon className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-display text-lg font-semibold uppercase tracking-wide">{title}</h3>
            <span className="font-mono text-[10px] text-muted-foreground">{products.length.toString().padStart(2, '0')}</span>
          </div>
          <p className="mt-0.5 text-[11px] text-muted-foreground">{description}</p>
        </div>
      </div>
      <AnalysisRelationSection
        testId={`${testId}-list`}
        testIdPrefix={chipPrefix}
        label={productRoleLabel(products[0]?.role ?? 'standalone')}
        elements={products.map((item) => item.product)}
        icon={Icon}
        emptyText={emptyText}
        emptyTestId={`${testId}-empty`}
        onSelectElement={onSelectElement}
        selectedElementIds={selectedElementIds}
        contextElementIds={contextElementIds}
        hasActiveContext={hasActiveContext}
      />
    </section>
  );
}

function SpecificationEmptyState() {
  return (
    <div data-testid="process-specification-empty" className="mt-6 border border-dashed border-border bg-card/40 px-6 py-16 text-center">
      <GitBranch className="mx-auto h-9 w-9 text-muted-foreground/55" />
      <p className="mt-3 font-display text-2xl font-semibold uppercase tracking-wide">No process stages to draw</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
        Add process elements and graph relationships in the workspace to generate a process specification.
      </p>
    </div>
  );
}

export function ProcessSpecification({
  model,
  onSelectElement,
  selectedElementIds,
  contextElementIds,
  hasActiveContext,
}: ProcessSpecificationProps) {
  const projection = useMemo(() => getProcessSpecification(model), [model]);
  const rootRankByProcessId = useMemo(() => {
    const ranks = new Map<string, number>();
    projection.rows.forEach((row) => {
      row.processes.forEach((node) => ranks.set(node.process.id, row.rank));
    });
    return ranks;
  }, [projection.rows]);
  const flowsBySourceRank = useMemo(() => {
    const groups = new Map<number, ProcessSpecificationFlow[]>();
    projection.flows.forEach((flow) => {
      const rank = rootRankByProcessId.get(flow.sourceProcessId) ?? 0;
      const flows = groups.get(rank) ?? [];
      flows.push(flow);
      groups.set(rank, flows);
    });
    return groups;
  }, [projection.flows, rootRankByProcessId]);

  return (
    <AnalysisFrame
      model={model}
      testId="process-specification"
      testIdPrefix={chipPrefix}
      header={{
        eyebrow: 'Process specification / read only',
        title: 'Production flow',
        description: `A derived stage-by-stage drawing of ${model.name}. Select any process or product to inspect its source graph element.`,
      }}
    >
      {projection.processes.length === 0 ? (
        <SpecificationEmptyState />
      ) : (
        <div className="mt-6 space-y-6">
          <section
            data-testid="process-specification-external-inputs"
            className="border border-ppr-product/30 bg-ppr-product/5 p-3.5"
          >
            <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1">
              <div className="flex items-center gap-2">
                <ArrowDownToLine className="h-4 w-4 text-ppr-product" />
                <h3 className="font-display text-lg font-semibold uppercase tracking-wide">External inputs</h3>
              </div>
              <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                material entering the modeled boundary
              </span>
            </div>
            <AnalysisRelationSection
              testId="process-specification-external-input-list"
              testIdPrefix={chipPrefix}
              label="Feed products"
              elements={projection.externalProducts.map((item) => item.product)}
              icon={Boxes}
              emptyText="No products enter from outside the modeled process"
              emptyTestId="process-specification-external-inputs-empty"
              onSelectElement={onSelectElement}
              selectedElementIds={selectedElementIds}
              contextElementIds={contextElementIds}
              hasActiveContext={hasActiveContext}
            />
          </section>

          <section data-testid="process-specification-flow-drawing" className="border border-border bg-card/30">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-muted/20 px-3.5 py-3">
              <div className="flex items-center gap-2.5">
                <span className="flex h-7 w-7 items-center justify-center bg-ppr-process text-primary-foreground">
                  <GitBranch className="h-3.5 w-3.5" />
                </span>
                <div>
                  <h3 className="font-display text-xl font-semibold uppercase tracking-wide">Stage sequence</h3>
                  <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
                    {projection.rows.length.toString().padStart(2, '0')} depth bands · {projection.flows.length.toString().padStart(2, '0')} bridges
                  </p>
                </div>
              </div>
              {projection.cycleProcessIds.size > 0 && (
                <div className="flex items-center gap-1.5 border border-accent/30 bg-accent/5 px-2.5 py-1.5 font-mono text-[9px] uppercase tracking-[0.12em] text-accent">
                  <CircleAlert className="h-3.5 w-3.5" />
                  {projection.cycleProcessIds.size} cycle marker{projection.cycleProcessIds.size === 1 ? '' : 's'}
                </div>
              )}
            </div>

            <div className="space-y-1 p-3">
              {projection.rows.map((row) => (
                <div key={row.rank} data-testid={`process-specification-row-${row.rank}`}>
                  <div className="mb-2 flex items-center gap-2 font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
                    <span className="flex h-5 w-5 items-center justify-center bg-ppr-process text-[9px] text-primary-foreground">
                      {String(row.rank + 1).padStart(2, '0')}
                    </span>
                    <span>Depth band {String(row.rank + 1).padStart(2, '0')}</span>
                    <span className="h-px flex-1 bg-border/80" />
                    <span>{row.processes.length} parallel stage{row.processes.length === 1 ? '' : 's'}</span>
                  </div>
                  <div className="overflow-x-auto pb-2">
                    <div className="flex min-w-max items-stretch gap-3">
                      {row.processes.map((node) => (
                        <ProcessNodeCard
                          key={node.process.id}
                          node={node}
                          onSelectElement={onSelectElement}
                          selectedElementIds={selectedElementIds}
                          contextElementIds={contextElementIds}
                          hasActiveContext={hasActiveContext}
                          path={new Set()}
                        />
                      ))}
                    </div>
                  </div>
                  {(flowsBySourceRank.get(row.rank) ?? []).length > 0 && (
                    <div className="mt-1 space-y-1.5 border-l-2 border-ppr-process/25 pl-3">
                      {(flowsBySourceRank.get(row.rank) ?? []).map((flow) => (
                        <FlowBridge
                          key={flow.id}
                          flow={flow}
                          projection={projection}
                          onSelectElement={onSelectElement}
                          selectedElementIds={selectedElementIds}
                          contextElementIds={contextElementIds}
                          hasActiveContext={hasActiveContext}
                        />
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>

          <section data-testid="process-specification-edge-sections" className="grid gap-4 lg:grid-cols-2">
            <EdgeSection
              title="Terminal outputs"
              description="Products with no downstream consumer in the model."
              testId="process-specification-terminal-outputs"
              products={projection.terminalOutputs}
              icon={ArrowUpFromLine}
              emptyText="No terminal outputs have been derived"
              onSelectElement={onSelectElement}
              selectedElementIds={selectedElementIds}
              contextElementIds={contextElementIds}
              hasActiveContext={hasActiveContext}
            />
            <EdgeSection
              title="Standalone products"
              description="Products currently outside every process handoff."
              testId="process-specification-standalone-products"
              products={projection.standaloneProducts}
              icon={CircleDashed}
              emptyText="No standalone products have been derived"
              onSelectElement={onSelectElement}
              selectedElementIds={selectedElementIds}
              contextElementIds={contextElementIds}
              hasActiveContext={hasActiveContext}
            />
          </section>
        </div>
      )}

    </AnalysisFrame>
  );
}

export default ProcessSpecification;