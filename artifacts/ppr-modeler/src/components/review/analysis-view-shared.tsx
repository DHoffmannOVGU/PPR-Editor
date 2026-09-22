import type { ComponentProps, ComponentType, ReactNode } from 'react';
import type { LucideProps } from 'lucide-react';
import type { PprElement, PprModel } from '@workspace/api-client-react';
import { AlertTriangle, Boxes, CheckCircle2, CircleDashed, Cog, Filter, Link2, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  ANALYSIS_FILTER_LABELS,
  getAnalysisCounts,
  getRelationshipProblems,
  type AnalysisFilter,
  type AnalysisIntegrityPerspective,
  type RelationshipProblem,
  type RelationBucket,
} from './analysis-utils';

const TYPE_ICONS = {
  product: Boxes,
  process: Cog,
  resource: Users,
} as const;

const TYPE_CLASSES = {
  product: 'border-ppr-product/25 bg-ppr-product/10 text-ppr-product',
  process: 'border-ppr-process/25 bg-ppr-process/10 text-ppr-process',
  resource: 'border-ppr-resource/30 bg-ppr-resource/10 text-ppr-resource',
} as const;

export function AnalysisHeader({
  model,
  testIdPrefix,
  eyebrow,
  title,
  description,
  showCounts = true,
  showLegend = true,
}: {
  model: PprModel;
  testIdPrefix: string;
  eyebrow: string;
  title: string;
  description: string;
  showCounts?: boolean;
  showLegend?: boolean;
}) {
  const counts = getAnalysisCounts(model);

  return (
    <header data-testid={`${testIdPrefix}-analysis-header`} className="border-b border-border pb-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            <span className="h-1.5 w-1.5 bg-accent" />
            {eyebrow}
          </div>
          <h2 data-testid={`text-${testIdPrefix}-title`} className="font-display text-3xl font-semibold uppercase tracking-tight text-foreground">
            {title}
          </h2>
          <p data-testid={`text-${testIdPrefix}-description`} className="mt-1 max-w-2xl text-sm text-muted-foreground">
            {description}
          </p>
        </div>
        {showCounts && (
          <div className="grid grid-cols-3 divide-x divide-border border border-border bg-card/60">
            <div className="px-4 py-2.5">
              <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Processes</div>
              <div data-testid={`text-${testIdPrefix}-process-count`} className="mt-1 font-display text-2xl font-semibold text-ppr-process">{counts.process.toString().padStart(2, '0')}</div>
            </div>
            <div className="px-4 py-2.5">
              <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Products</div>
              <div data-testid={`text-${testIdPrefix}-product-count`} className="mt-1 font-display text-2xl font-semibold text-ppr-product">{counts.product.toString().padStart(2, '0')}</div>
            </div>
            <div className="px-4 py-2.5">
              <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Resources</div>
              <div data-testid={`text-${testIdPrefix}-resource-count`} className="mt-1 font-display text-2xl font-semibold text-ppr-resource">{counts.resource.toString().padStart(2, '0')}</div>
            </div>
          </div>
        )}
      </div>
      {showLegend && (
        <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 bg-ppr-product" /> Product</span>
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 bg-ppr-process" /> Process</span>
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 bg-ppr-resource" /> Resource</span>
          <span className="ml-auto flex items-center gap-1.5 text-foreground/60"><Link2 className="h-3.5 w-3.5" /> Source of truth: graph relationships</span>
        </div>
      )}
    </header>
  );
}

export function AnalysisFilterBar({
  testIdPrefix,
  value,
  options,
  filteredRelationshipCount,
  onChange,
}: {
  testIdPrefix: string;
  value: AnalysisFilter;
  options: Array<{ value: AnalysisFilter; label: string }>;
  filteredRelationshipCount: number | null;
  onChange: (value: AnalysisFilter) => void;
}) {
  const activeLabel = options.find((option) => option.value === value)?.label ?? ANALYSIS_FILTER_LABELS[value];

  return (
    <section data-testid={`${testIdPrefix}-filter-bar`} className="mt-5 border border-border bg-card/50 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-1 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          <Filter className="h-3.5 w-3.5" />
          <span>Relationship role</span>
        </div>
        <div className="flex flex-wrap gap-1">
          {options.map((option) => {
            const isActive = value === option.value;
            return (
              <button
                key={option.value}
                type="button"
                data-testid={`${testIdPrefix}-filter-${option.value}`}
                aria-pressed={isActive}
                onClick={() => onChange(option.value)}
                className={cn(
                  'border px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.1em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  isActive
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border bg-background/60 text-muted-foreground hover:border-foreground/35 hover:text-foreground',
                )}
              >
                {option.label}
              </button>
            );
          })}
        </div>
        <span data-testid={`${testIdPrefix}-filter-status`} className="ml-auto text-[11px] text-muted-foreground">
          {filteredRelationshipCount === null ? (
            <>Showing all relationship roles</>
          ) : filteredRelationshipCount === 0 ? (
            <>No {activeLabel.toLowerCase()} relationships found · clear filter to show all roles</>
          ) : (
            <>Showing {filteredRelationshipCount} {activeLabel.toLowerCase()} {filteredRelationshipCount === 1 ? 'relationship' : 'relationships'}</>
          )}
        </span>
      </div>
    </section>
  );
}

export function AnalysisElementChip({
  element,
  testIdPrefix,
  onSelectElement,
  isSelected = false,
  isContext = false,
  hasActiveContext = false,
}: {
  element: PprElement;
  testIdPrefix: string;
  onSelectElement: (id: string) => void;
  isSelected?: boolean;
  isContext?: boolean;
  hasActiveContext?: boolean;
}) {
  const Icon = TYPE_ICONS[element.type];
  return (
    <button
      type="button"
      data-testid={`button-${testIdPrefix}-element-${element.id}`}
      onClick={() => onSelectElement(element.id)}
      className={cn(
        'group flex min-w-0 items-center gap-2 border bg-background/55 px-2.5 py-2 text-left transition-colors duration-150',
        'hover:border-foreground/35 hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        isSelected && 'border-ring bg-primary/10 ring-1 ring-ring/60',
        !isSelected && isContext && 'border-primary/50 bg-primary/5',
      )}
      aria-pressed={isSelected}
    >
      <span className={cn('flex h-6 w-6 shrink-0 items-center justify-center border text-[10px] font-semibold', TYPE_CLASSES[element.type])}>
        <Icon className="h-3.5 w-3.5" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-xs font-medium text-foreground group-hover:text-primary">{element.name || 'Unnamed element'}</span>
        <span className="mt-0.5 block truncate font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
          {element.kind} · {element.id.slice(0, 8)}
        </span>
      </span>
    </button>
  );
}

export function AnalysisRelationSection({
  testId,
  testIdPrefix,
  label,
  elements,
  icon: Icon,
  emptyText,
  emptyTestId,
  onSelectElement,
  selectedElementIds,
  contextElementIds,
  hasActiveContext = false,
}: {
  testId: string;
  testIdPrefix: string;
  label: string;
  elements: PprElement[];
  icon: ComponentType<LucideProps>;
  emptyText: string;
  emptyTestId?: string;
  onSelectElement: (id: string) => void;
  selectedElementIds?: Set<string>;
  contextElementIds?: Set<string>;
  hasActiveContext?: boolean;
}) {
  return (
    <section data-testid={testId} className="min-w-0">
      <div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        <Icon className="h-3.5 w-3.5 text-foreground/70" />
        <span>{label}</span>
        <span className="ml-auto font-mono text-[10px] text-foreground/60">{elements.length.toString().padStart(2, '0')}</span>
      </div>
      <div className="space-y-1.5">
        {elements.length === 0 ? (
          <div data-testid={emptyTestId ?? `empty-${testIdPrefix}-${testId.split('-').at(-1)}`} className="flex min-h-[42px] items-center gap-2 border border-dashed border-border/80 px-2.5 text-[11px] text-muted-foreground">
            <CircleDashed className="h-3.5 w-3.5 shrink-0 opacity-70" />
            <span>{emptyText}</span>
          </div>
        ) : (
          elements.map((element) => (
            <AnalysisElementChip
              key={element.id}
              element={element}
              testIdPrefix={testIdPrefix}
              onSelectElement={onSelectElement}
              isSelected={selectedElementIds?.has(element.id)}
              isContext={contextElementIds?.has(element.id)}
              hasActiveContext={hasActiveContext}
            />
          ))
        )}
      </div>
    </section>
  );
}

export function AnalysisIntegrityPanel({
  model,
  testIdPrefix,
  perspective = 'process',
}: {
  model: PprModel;
  testIdPrefix: string;
  perspective?: AnalysisIntegrityPerspective;
}) {
  const problems = getRelationshipProblems(model, perspective);
  if (problems.length === 0) return null;

  return (
    <section data-testid={`${testIdPrefix}-integrity-panel`} className="mt-8 border border-accent/35 bg-accent/5">
      <div className="flex items-start gap-3 border-b border-accent/20 px-4 py-3">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
        <div>
          <h3 className="font-display text-lg font-semibold uppercase tracking-wide">Relationship integrity</h3>
          <p className="text-xs text-muted-foreground">These links remain visible because they need attention before they can be interpreted in this perspective.</p>
        </div>
        <span data-testid={`text-${testIdPrefix}-problem-count`} className="ml-auto font-mono text-xs text-accent">{problems.length.toString().padStart(2, '0')}</span>
      </div>
      <div className="divide-y divide-accent/15">
        {problems.map(({ relationship, problem }) => (
          <div key={relationship.id} data-testid={`row-${testIdPrefix}-problem-${relationship.id}`} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-xs">
            <span className="font-mono text-[10px] uppercase tracking-wider text-accent">{problem.title}</span>
            <span className="text-muted-foreground">{problem.detail}</span>
            <span className="ml-auto font-mono text-[9px] text-muted-foreground">{relationship.id.slice(0, 8)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

export function AnalysisFooter({ model, testIdPrefix }: { model: PprModel; testIdPrefix: string }) {
  return (
    <footer data-testid={`${testIdPrefix}-footer`} className="flex flex-wrap items-center gap-2 border-t border-border py-5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
      <CheckCircle2 className="h-3.5 w-3.5 text-ppr-product" />
      <span>{model.diagram.usages.length} usages in diagram</span>
      <span className="text-border">/</span>
      <span>{model.diagram.relationships.length} relationships in source graph</span>
      <span className="ml-auto">Read-only surface · edit via inspector</span>
    </footer>
  );
}

export function AnalysisFrame({
  model,
  testId,
  testIdPrefix,
  header,
  children,
}: {
  model: PprModel;
  testId: string;
  testIdPrefix: string;
  header: Omit<ComponentProps<typeof AnalysisHeader>, 'model' | 'testIdPrefix'>;
  children: ReactNode;
}) {
  return (
    <div data-testid={testId} className="h-full overflow-y-auto bg-background">
      <div className="mx-auto max-w-[1500px] px-5 py-6 lg:px-8">
        <AnalysisHeader {...header} model={model} testIdPrefix={testIdPrefix} />
        {children}
        <AnalysisFooter model={model} testIdPrefix={testIdPrefix} />
      </div>
    </div>
  );
}

export type { RelationshipProblem };