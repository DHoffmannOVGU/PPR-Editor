import type { PprElement, PprModel, PprRelationship } from '@workspace/api-client-react';
import { ArrowRight, Boxes, CircleDot, Wrench } from 'lucide-react';

type ItemChain = {
  id: string;
  name: string;
  usages: PprElement[];
};

function deriveChains(model: PprModel): ItemChain[] {
  const products = model.diagram.usages.filter((usage) => usage.type === 'product');
  const byId = new Map(products.map((product) => [product.id, product]));
  const outgoing = new Map(
    model.diagram.relationships
      .filter((relationship) => relationship.kind === 'becomes')
      .map((relationship) => [relationship.source_id, relationship.target_id]),
  );
  const incoming = new Set(outgoing.values());
  const visited = new Set<string>();
  const result: ItemChain[] = [];
  const append = (head: PprElement) => {
    const usages: PprElement[] = [];
    let current: PprElement | undefined = head;
    while (current && !visited.has(current.id)) {
      usages.push(current);
      visited.add(current.id);
      current = byId.get(outgoing.get(current.id) ?? '');
    }
    const suffix = head.id.includes('_') ? head.id.slice(head.id.indexOf('_') + 1) : head.id;
    result.push({ id: `item_${suffix}`, name: head.name, usages });
  };
  products.filter((product) => !incoming.has(product.id)).forEach(append);
  products.filter((product) => !visited.has(product.id)).forEach(append);
  return result;
}

function transitionProcess(
  relationships: PprRelationship[],
  sourceId: string,
  targetId: string,
) {
  const consumers = new Set(
    relationships
      .filter((relationship) => relationship.kind === 'consumed_by' && relationship.source_id === sourceId)
      .map((relationship) => relationship.target_id),
  );
  return relationships.find((relationship) =>
    relationship.kind === 'produces'
    && relationship.target_id === targetId
    && consumers.has(relationship.source_id))?.source_id;
}

export function ItemLifecycleView({
  model,
  onSelectElement,
}: {
  model: PprModel;
  onSelectElement: (elementId: string) => void;
}) {
  const elementsById = new Map(model.diagram.usages.map((usage) => [usage.id, usage]));
  const chains = deriveChains(model);

  return (
    <div className="h-full overflow-auto bg-background p-5 md:p-7" data-testid="item-lifecycle-view">
      <header className="mb-5 border-b border-border pb-4">
        <div className="aml-kicker">ITEM workspace</div>
        <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-display text-2xl font-semibold uppercase tracking-wide">Product lifecycles</h2>
            <p className="mt-1 text-sm text-muted-foreground">One row per physical item, from its first recorded state to its last.</p>
          </div>
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{chains.length} items · {chains.reduce((count, chain) => count + chain.usages.length, 0)} states</span>
        </div>
      </header>

      <div className="space-y-4">
        {chains.map((chain) => (
          <section key={chain.id} className="overflow-x-auto border border-border bg-card/70" data-testid={`item-row-${chain.id}`}>
            <div className="min-w-max p-4">
              <div className="mb-3 flex items-center gap-2">
                <Boxes className="h-4 w-4 text-ppr-product" />
                <span className="font-display text-lg font-semibold uppercase tracking-wide">{chain.name}</span>
                <span className="font-mono text-[9px] text-muted-foreground">{chain.id}</span>
              </div>
              <div className="flex items-stretch gap-0">
                {chain.usages.map((usage, index) => {
                  const next = chain.usages[index + 1];
                  const processId = next
                    ? transitionProcess(model.diagram.relationships, usage.id, next.id)
                    : undefined;
                  const process = processId ? elementsById.get(processId) : undefined;
                  const resources = processId
                    ? model.diagram.relationships
                      .filter((relationship) => relationship.kind === 'performs' && relationship.target_id === processId)
                      .map((relationship) => elementsById.get(relationship.source_id))
                      .filter((resource): resource is PprElement => resource?.type === 'resource')
                    : [];
                  return (
                    <div key={usage.id} className="flex items-center">
                      <button
                        type="button"
                        onClick={() => onSelectElement(usage.id)}
                        className="w-48 border-2 border-ppr-product bg-background p-3 text-left transition-colors hover:bg-ppr-product/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <div className="flex items-center gap-2 text-ppr-product">
                          <CircleDot className="h-3.5 w-3.5" />
                          <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.12em]">{usage.state || 'state not set'}</span>
                        </div>
                        <div className="mt-2 text-sm font-semibold text-foreground">{usage.name}</div>
                      </button>
                      {next && (
                        <div className="flex w-48 flex-col items-center justify-center px-3 text-center">
                          <div className="flex w-full items-center">
                            <span className="h-px flex-1 bg-primary/60" />
                            <ArrowRight className="h-4 w-4 text-primary" />
                          </div>
                          <div className="mt-1 max-w-full truncate text-xs font-semibold">{process?.name ?? 'Missing process'}</div>
                          <div className="mt-0.5 flex max-w-full items-center gap-1 truncate text-[10px] text-muted-foreground">
                            <Wrench className="h-3 w-3 shrink-0" />
                            {resources.length ? resources.map((resource) => resource.name).join(', ') : 'No performing resource'}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
