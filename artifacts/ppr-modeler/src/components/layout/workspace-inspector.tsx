import type { ElementInput, ElementUpdate, PprElement, PprModel, PprRelationship, RelationshipInput, RelationshipUpdate } from '@workspace/api-client-react';
import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Boxes, Cog, Eye, EyeOff, GitMerge, HelpCircle, Link2, Network, Plus, Unlink, Wrench } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ElementInspector } from '../inspector/element-inspector';
import type { PprCanvasPerspective } from '../canvas/ppr-perspective';
import {
  getElementMap,
  getProductProcesses,
  getProductBom,
  getRelatedElements,
  getResourceProcesses,
  getResourceTree,
} from '../review/analysis-utils';
import { ProductBomQuantityEditor } from '../review/product-review';

interface WorkspaceInspectorProps {
  model: PprModel | undefined;
  selectedElements: PprElement[];
  selectedRelationships: PprRelationship[];
  perspective?: PprCanvasPerspective;
  readOnly?: boolean;
  onCreateElement: (data: ElementInput, onSuccess?: (element: PprElement) => void) => void;
  onUpdateElement: (id: string, updates: ElementUpdate) => void;
  onDeleteElement: (id: string) => void;
  onDeleteRelationship: (id: string) => void;
  onUpdateRelationship: (id: string, updates: RelationshipUpdate) => void;
  onCreateRelationship: (data: RelationshipInput) => void;
  onRequestMerge: (firstId: string, secondId: string) => void;
  onRequestRelationship: (sourceId: string, targetId: string) => void;
}

const PERSPECTIVE_INSPECTOR_COPY: Record<PprCanvasPerspective, { eyebrow: string; title: string }> = {
  ppr: { eyebrow: 'Semantic editor', title: 'Properties' },
  levels: { eyebrow: 'PPR Levels', title: 'Derived context' },
  process: { eyebrow: 'Process perspective', title: 'Flow context' },
  product: { eyebrow: 'Product perspective', title: 'State & provenance' },
  resource: { eyebrow: 'Resource perspective', title: 'Hierarchy context' },
};

function IdentityInspector({
  model,
  element,
  onUpdate,
  onCreateRelationship,
  onDeleteRelationship,
}: {
  model: PprModel;
  element: PprElement;
  onUpdate: (updates: ElementUpdate) => void;
  onCreateRelationship: (data: RelationshipInput) => void;
  onDeleteRelationship: (id: string) => void;
}) {
  const [state, setState] = useState(element.state ?? '');
  const [nextId, setNextId] = useState('');
  const [previousId, setPreviousId] = useState('');
  useEffect(() => {
    setState(element.state ?? '');
    setNextId('');
    setPreviousId('');
  }, [element.id, element.state]);

  const definition = model.library.definitions.find((candidate) => candidate.id === element.definition_id);
  const vocabulary = definition?.states ?? [];
  const products = model.diagram.usages.filter((candidate) => candidate.type === 'product' && candidate.id !== element.id);
  const outgoing = model.diagram.relationships.find((relationship) =>
    relationship.kind === 'becomes' && relationship.source_id === element.id);
  const incoming = model.diagram.relationships.find((relationship) =>
    relationship.kind === 'becomes' && relationship.target_id === element.id);
  const usageName = (id: string) => model.diagram.usages.find((candidate) => candidate.id === id)?.name ?? id;
  const stateListId = `identity-states-${element.id}`;

  return (
    <section data-testid={`identity-inspector-${element.id}`} className="space-y-3 border-b border-primary/20 bg-primary/5 p-4">
      <div className="font-mono text-[9px] font-semibold uppercase tracking-[0.16em] text-primary">Identity</div>
      <div className="space-y-1.5">
        <label htmlFor={`state-${element.id}`} className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">State</label>
        <Input
          id={`state-${element.id}`}
          list={stateListId}
          value={state}
          placeholder="e.g. raw, machined, released"
          className="h-8 rounded-sm text-xs"
          onChange={(event) => setState(event.target.value)}
          onBlur={() => onUpdate({ state: state.trim() || null })}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.currentTarget.blur();
            }
          }}
        />
        <datalist id={stateListId}>
          {vocabulary.map((value) => <option key={value} value={value} />)}
        </datalist>
        <p className="text-[10px] text-muted-foreground">Choose a definition state or enter a new one.</p>
      </div>

      {incoming ? (
        <div className="flex items-center gap-2 border border-border bg-background/70 px-2 py-1.5 text-xs">
          <ArrowLeft className="h-3.5 w-3.5 text-primary" />
          <span className="min-w-0 flex-1 truncate">from {usageName(incoming.source_id)}</span>
          <Button variant="ghost" size="icon" className="h-6 w-6" title="Remove incoming identity link" onClick={() => onDeleteRelationship(incoming.id)}>
            <Unlink className="h-3 w-3" />
          </Button>
        </div>
      ) : (
        <div className="flex gap-2">
          <select aria-label="Becomes from" value={previousId} onChange={(event) => setPreviousId(event.target.value)} className="h-8 min-w-0 flex-1 border border-border bg-background px-2 text-xs">
            <option value="">← from…</option>
            {products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
          </select>
          <Button size="sm" variant="outline" disabled={!previousId} onClick={() => {
            onCreateRelationship({ source_id: previousId, target_id: element.id, kind: 'becomes' });
            setPreviousId('');
          }}>Link</Button>
        </div>
      )}

      {outgoing ? (
        <div className="flex items-center gap-2 border border-border bg-background/70 px-2 py-1.5 text-xs">
          <ArrowRight className="h-3.5 w-3.5 text-primary" />
          <span className="min-w-0 flex-1 truncate">to {usageName(outgoing.target_id)}</span>
          <Button variant="ghost" size="icon" className="h-6 w-6" title="Remove outgoing identity link" onClick={() => onDeleteRelationship(outgoing.id)}>
            <Unlink className="h-3 w-3" />
          </Button>
        </div>
      ) : (
        <div className="flex gap-2">
          <select aria-label="Becomes to" value={nextId} onChange={(event) => setNextId(event.target.value)} className="h-8 min-w-0 flex-1 border border-border bg-background px-2 text-xs">
            <option value="">becomes →</option>
            {products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
          </select>
          <Button size="sm" variant="outline" disabled={!nextId} onClick={() => {
            onCreateRelationship({ source_id: element.id, target_id: nextId, kind: 'becomes' });
            setNextId('');
          }}>Link</Button>
        </div>
      )}
    </section>
  );
}

function ContextList({
  label,
  elements,
  empty,
}: {
  label: string;
  elements: PprElement[];
  empty: string;
}) {
  return (
    <section>
      <div className="font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </div>
      {elements.length > 0 ? (
        <div className="mt-1.5 space-y-1">
          {elements.map((element) => (
            <div
              key={element.id}
              className="flex items-center gap-2 border border-border bg-background/70 px-2 py-1.5 text-xs"
              title={element.description || element.name}
            >
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: `hsl(var(--ppr-${element.type}))` }}
              />
              <span className="min-w-0 flex-1 truncate">{element.name}</span>
              <span className="font-mono text-[8px] uppercase text-muted-foreground">{element.type}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-1 text-[11px] text-muted-foreground">{empty}</p>
      )}
    </section>
  );
}

function PerspectiveElementContext({
  model,
  element,
  perspective,
  onUpdateRelationship,
  onCreateElement,
  onCreateRelationship,
}: {
  model: PprModel;
  element: PprElement;
  perspective: PprCanvasPerspective;
  onUpdateRelationship: (id: string, updates: RelationshipUpdate) => void;
  onCreateElement: (data: ElementInput, onSuccess?: (element: PprElement) => void) => void;
  onCreateRelationship: (data: RelationshipInput) => void;
}) {
  if (perspective === 'ppr') return null;
  const elementsById = getElementMap(model);

  if (element.type === 'product') {
    const producers = getProductProcesses(model, elementsById, element.id, 'upstream');
    const consumers = getProductProcesses(model, elementsById, element.id, 'downstream');
    const componentEdges = getProductBom(model).childrenByProductId.get(element.id) ?? [];
    const state = producers.length === 0
      ? consumers.length === 0 ? 'Standalone product' : 'Input material'
      : consumers.length === 0 ? 'Final product' : 'Intermediate state';
    return (
      <div data-testid="product-state-sidebar" className="space-y-4 border-b border-border bg-ppr-product/5 p-4">
        <div className="flex items-center gap-2">
          <Boxes className="h-4 w-4 text-ppr-product" />
          <div>
            <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">Inferred state</div>
            <div className="mt-0.5 text-sm font-semibold text-foreground">{state}</div>
          </div>
        </div>
        <ContextList label="Produced by" elements={producers} empty="No producing process" />
        <ContextList label="Consumed by" elements={consumers} empty="No consuming process" />
        {componentEdges.length > 0 && (
          <section data-testid="product-input-quantities-sidebar">
            <div className="font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Product inputs
            </div>
            <div className="mt-1.5 space-y-2">
              {componentEdges.map((edge) => {
                const child = elementsById.get(edge.childProductId);
                const process = elementsById.get(edge.processId);
                return (
                  <div key={edge.id} className="border border-border bg-background/70">
                    <div className="flex items-start justify-between gap-2 px-2 py-2 text-xs">
                      <div className="min-w-0">
                        <div className="truncate font-medium">{child?.name ?? edge.childProductId}</div>
                        <div className="mt-0.5 truncate text-[10px] text-muted-foreground">via {process?.name ?? 'process'}</div>
                      </div>
                      <span
                        data-testid={`product-bom-quantity-${edge.id}`}
                        className="shrink-0 text-right font-mono text-[10px] text-ppr-product"
                      >
                        {edge.quantity == null ? 'Unspecified' : edge.quantity}{edge.unit ? ` ${edge.unit}` : ''}
                      </span>
                    </div>
                    <ProductBomQuantityEditor edge={edge} onUpdateRelationship={onUpdateRelationship} />
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </div>
    );
  }

  if (element.type === 'process') {
    const inputs = getRelatedElements(model, elementsById, element.id, 'consumed_by');
    const outputs = getRelatedElements(model, elementsById, element.id, 'produces');
    const performing = [...elementsById.values()].filter((candidate) =>
      candidate.type === 'resource'
      && getResourceProcesses(model, elementsById, candidate.id, 'performs').some((process) => process.id === element.id),
    );
    const supporting = [...elementsById.values()].filter((candidate) =>
      candidate.type === 'resource'
      && getResourceProcesses(model, elementsById, candidate.id, 'supports').some((process) => process.id === element.id),
    );
    const parentProcesses = model.diagram.relationships
      .filter((relationship) => relationship.kind === 'contains' && relationship.target_id === element.id)
      .map((relationship) => elementsById.get(relationship.source_id))
      .filter((candidate): candidate is PprElement => candidate?.type === 'process');
    const subprocesses = model.diagram.relationships
      .filter((relationship) => relationship.kind === 'contains' && relationship.source_id === element.id)
      .map((relationship) => elementsById.get(relationship.target_id))
      .filter((candidate): candidate is PprElement => candidate?.type === 'process');
    const addSubprocess = () => {
      onCreateElement({
        name: 'New subprocess',
        type: 'process',
        definition_id: null,
        description: '',
        attributes: [],
        visible_in_ppr: false,
        x: element.x + 40,
        y: element.y + 160,
      }, (subprocess) => {
        onCreateRelationship({
          source_id: element.id,
          target_id: subprocess.id,
          kind: 'contains',
        });
      });
    };
    return (
      <div data-testid="process-context-sidebar" className="space-y-4 border-b border-border bg-ppr-process/5 p-4">
        <div className="flex items-center gap-2 text-sm font-semibold"><Cog className="h-4 w-4 text-ppr-process" /> Process structure</div>
        {perspective === 'process' && (
          <>
            <ContextList label="Parent process" elements={parentProcesses} empty="Top-level process" />
            <ContextList label="Subprocesses" elements={subprocesses} empty="No subprocesses" />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full gap-2 rounded-sm text-xs"
              data-testid={`button-add-subprocess-${element.id}`}
              onClick={addSubprocess}
            >
              <Plus className="h-3.5 w-3.5" /> Add subprocess
            </Button>
            <p className="text-[10px] leading-relaxed text-muted-foreground">
              To nest an existing process, select the parent first and the subprocess second, then create a <span className="font-mono">contains</span> relationship.
            </p>
          </>
        )}
        <ContextList label="Inputs" elements={inputs} empty="No product inputs" />
        <ContextList label="Outputs" elements={outputs} empty="No product outputs" />
        <ContextList label="Performing resources" elements={performing} empty="No performing resource" />
        <ContextList label="Supporting resources" elements={supporting} empty="No supporting resource" />
      </div>
    );
  }

  const tree = getResourceTree(model);
  const parents = (tree.parentsByResourceId.get(element.id) ?? [])
    .map((id) => elementsById.get(id))
    .filter((candidate): candidate is PprElement => candidate?.type === 'resource');
  const children = (tree.childrenByResourceId.get(element.id) ?? [])
    .map((edge) => elementsById.get(edge.childResourceId))
    .filter((candidate): candidate is PprElement => candidate?.type === 'resource');
  const performing = getResourceProcesses(model, elementsById, element.id, 'performs');
  const supporting = getResourceProcesses(model, elementsById, element.id, 'supports');
  return (
    <div data-testid="resource-context-sidebar" className="space-y-4 border-b border-border bg-ppr-resource/5 p-4">
      <div className="flex items-center gap-2 text-sm font-semibold"><Wrench className="h-4 w-4 text-ppr-resource" /> Resource hierarchy</div>
      <ContextList label="Parent resources" elements={parents} empty="Top-level resource" />
      <ContextList label="Contained resources" elements={children} empty="No contained resources" />
      <ContextList label="Performs" elements={performing} empty="No performing assignment" />
      <ContextList label="Supports" elements={supporting} empty="No supporting assignment" />
    </div>
  );
}

function PprVisibilityControl({
  element,
  perspective,
  onUpdate,
}: {
  element: PprElement;
  perspective: PprCanvasPerspective;
  onUpdate: (updates: ElementUpdate) => void;
}) {
  const isVisible = element.visible_in_ppr !== false;
  const Icon = isVisible ? Eye : EyeOff;
  return (
    <section
      data-testid={`ppr-visibility-${element.id}`}
      className="border-b border-border bg-muted/10 p-4"
    >
      <div className="flex items-start gap-2.5">
        <Icon className={isVisible ? 'mt-0.5 h-4 w-4 text-primary' : 'mt-0.5 h-4 w-4 text-muted-foreground'} />
        <div className="min-w-0 flex-1">
          <div className="font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            PPR diagram visibility
          </div>
          <p className="mt-1 text-xs text-foreground">
            {isVisible ? 'Included in the main PPR diagram' : `Only visible in the ${element.type} view`}
          </p>
          {perspective !== 'ppr' && (
            <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
              {isVisible
                ? 'Its relationships appear in PPR when their other endpoints are included too.'
                : 'Keep supporting detail here, or promote it when it belongs in the main diagram.'}
            </p>
          )}
        </div>
      </div>
      <Button
        type="button"
        variant={isVisible ? 'outline' : 'default'}
        size="sm"
        className="mt-3 w-full gap-2 rounded-sm text-xs"
        data-testid={`button-toggle-ppr-visibility-${element.id}`}
        onClick={() => onUpdate({ visible_in_ppr: !isVisible })}
      >
        {isVisible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
        {isVisible ? 'Remove from PPR diagram' : 'Include in PPR diagram'}
      </Button>
    </section>
  );
}

export function WorkspaceInspector({
  model,
  selectedElements,
  selectedRelationships,
  perspective = 'ppr',
  onCreateElement,
  onUpdateElement,
  onDeleteElement,
  onDeleteRelationship,
  onUpdateRelationship,
  onCreateRelationship,
  onRequestMerge,
  onRequestRelationship,
  readOnly = false,
}: WorkspaceInspectorProps) {
  const inspectorCopy = PERSPECTIVE_INSPECTOR_COPY[perspective];
  const canMerge =
    selectedElements.length === 2 &&
    selectedElements[0].type === selectedElements[1].type &&
    selectedElements.every((element) => element.kind === 'usage');

  return (
    <aside className="hidden w-80 shrink-0 border-l border-border bg-card flex-col z-10 shadow-sm shadow-l xl:flex">
      <div className="border-b border-border bg-muted/20 px-4 py-3 shrink-0">
        <div className="aml-kicker">{inspectorCopy.eyebrow}</div>
        <h2 className="mt-1 font-display text-lg font-semibold uppercase tracking-tight text-foreground">{inspectorCopy.title}</h2>
      </div>
      <div className="flex-1 overflow-y-auto">
        {selectedElements.length === 1 ? (
          <>
            {readOnly ? (
              <div className="border-b border-border bg-muted/20 p-4">
                <div className="aml-kicker">Derived selection</div>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  PPR Levels is a read-only projection. Edit this {selectedElements[0].type} from the PPR surface.
                </p>
              </div>
            ) : (
              <PprVisibilityControl
                element={selectedElements[0]}
                perspective={perspective}
                onUpdate={(updates) => onUpdateElement(selectedElements[0].id, updates)}
              />
            )}
            {model && (
              <PerspectiveElementContext
                model={model}
                element={selectedElements[0]}
                perspective={perspective}
                onUpdateRelationship={onUpdateRelationship}
                onCreateElement={onCreateElement}
                onCreateRelationship={onCreateRelationship}
              />
            )}
            {!readOnly && model && selectedElements[0].type === 'product' && selectedElements[0].kind === 'usage' && (
              <IdentityInspector
                model={model}
                element={selectedElements[0]}
                onUpdate={(updates) => onUpdateElement(selectedElements[0].id, updates)}
                onCreateRelationship={onCreateRelationship}
                onDeleteRelationship={onDeleteRelationship}
              />
            )}
            {readOnly ? (
              <div className="space-y-3 p-4">
                <div>
                  <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">Name</div>
                  <div className="mt-1 text-sm font-semibold text-foreground">{selectedElements[0].name}</div>
                </div>
                {selectedElements[0].description && (
                  <div>
                    <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">Description</div>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{selectedElements[0].description}</p>
                  </div>
                )}
                {selectedElements[0].attributes.length > 0 && (
                  <div>
                    <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">Attributes</div>
                    <div className="mt-1 space-y-1">
                      {selectedElements[0].attributes.map((attribute) => (
                        <div key={attribute.id} className="flex justify-between gap-2 border border-border bg-background/70 px-2 py-1 text-xs">
                          <span className="truncate text-muted-foreground">{attribute.name}</span>
                          <span className="truncate font-mono">{attribute.value}{attribute.unit ? ` ${attribute.unit}` : ''}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <ElementInspector
                element={selectedElements[0]}
                definitions={model?.library.definitions ?? []}
                onUpdate={(updates) => onUpdateElement(selectedElements[0].id, updates)}
                onDelete={() => onDeleteElement(selectedElements[0].id)}
              />
            )}
          </>
        ) : selectedElements.length > 1 ? (
          <div className="space-y-4 p-4">
            <div>
              <p className="aml-kicker">Selection</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {selectedElements.length} elements selected
              </p>
            </div>
            {canMerge ? (
              <div className="space-y-3 border-t border-border pt-4">
                <div>
                  <p className="text-sm font-semibold">Same-type usages</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Merge these {selectedElements[0].type} usages, or create a typed relationship without combining them.
                  </p>
                </div>
                <div className="grid gap-2">
                  <Button
                    className="w-full gap-2 rounded-sm"
                    onClick={() => onRequestMerge(selectedElements[0].id, selectedElements[1].id)}
                    data-testid="button-merge-selected"
                  >
                    <GitMerge className="h-3.5 w-3.5" />
                    Merge selected usages
                  </Button>
                  <Button
                    variant="outline"
                    className="w-full gap-2 rounded-sm"
                    onClick={() => onRequestRelationship(selectedElements[0].id, selectedElements[1].id)}
                    data-testid="button-create-relationship-selected"
                  >
                    <Link2 className="h-3.5 w-3.5" />
                    Create relationship
                  </Button>
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Select exactly two usages of the same type to enable merging.
              </p>
            )}
          </div>
        ) : selectedRelationships.length === 1 ? (
          <div className="p-4">
            <p className="aml-kicker mb-2">Relationship Selected</p>
            <div className="border border-border bg-muted p-2 font-mono text-xs mb-4">
              {selectedRelationships[0].kind}
            </div>
            {!readOnly && (
              <Button
                variant="destructive"
                size="sm"
                className="w-full"
                onClick={() => onDeleteRelationship(selectedRelationships[0].id)}
              >
                Delete Relationship
              </Button>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-center p-6 text-muted-foreground">
            {perspective === 'ppr' ? <HelpCircle className="w-8 h-8 mb-4 opacity-20" /> : <Network className="w-8 h-8 mb-4 opacity-20" />}
            <p className="text-sm">
              {perspective === 'ppr'
                ? 'Select an element or relationship on the canvas to inspect it.'
                : `Select a visible node to inspect its properties and ${perspective === 'levels' ? 'level' : perspective} context.`}
            </p>
          </div>
        )}
      </div>
    </aside>
  );
}
