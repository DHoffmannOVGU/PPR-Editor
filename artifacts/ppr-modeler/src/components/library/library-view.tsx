import { useEffect, useMemo, useState } from 'react';
import type { DefinitionInput, DefinitionUpdate, PprElement } from '@workspace/api-client-react';
import { Boxes, Check, ChevronDown, ChevronRight, ChevronUp, Cog, Folder, GitBranch, Library, Plus, Search, Trash2, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ElementInspector } from '../inspector/element-inspector';
import { toast } from 'sonner';

interface LibraryViewProps {
  definitions: PprElement[];
  usages: PprElement[];
  typeFilter?: PprElement['type'] | null;
  onTypeFilterChange?: (type: PprElement['type'] | null) => void;
  onCreateDefinition: (data: DefinitionInput, onSuccess?: (definition: PprElement) => void) => void;
  onUpdateDefinition: (id: string, updates: DefinitionUpdate) => void;
  onDeleteDefinition: (id: string) => void;
}

const TYPE_ICONS = {
  product: Boxes,
  process: Cog,
  resource: Users,
} as const;

const DEFINITION_TYPES = ['product', 'process', 'resource'] as const;
const ALL_COLLECTIONS = '__all_collections__';
const GENERAL_COLLECTION = 'General';
const ROOT_DEFINITION = '__root_definition__';

const TYPE_COLORS = {
  product: 'text-[hsl(var(--ppr-product))]',
  process: 'text-[hsl(var(--ppr-process))]',
  resource: 'text-[hsl(var(--ppr-resource))]',
} as const;

function definitionCollection(definition: PprElement) {
  return definition.domain?.trim() || GENERAL_COLLECTION;
}

function getInheritancePath(definition: PprElement, definitions: PprElement[]) {
  const byId = new Map(definitions.map((candidate) => [candidate.id, candidate]));
  const path: PprElement[] = [definition];
  const visited = new Set([definition.id]);
  let parentId = definition.parent_definition_id;
  while (parentId) {
    const parent = byId.get(parentId);
    if (!parent || visited.has(parent.id)) break;
    path.unshift(parent);
    visited.add(parent.id);
    parentId = parent.parent_definition_id;
  }
  return path;
}

function canBeParent(candidate: PprElement, definition: PprElement, definitions: PprElement[]) {
  if (candidate.type !== definition.type || candidate.id === definition.id) return false;
  const byId = new Map(definitions.map((item) => [item.id, item]));
  const visited = new Set<string>();
  let current: PprElement | undefined = candidate;
  while (current && !visited.has(current.id)) {
    if (current.id === definition.id) return false;
    visited.add(current.id);
    current = current.parent_definition_id ? byId.get(current.parent_definition_id) : undefined;
  }
  return true;
}

function DefinitionCard({
  definition,
  usageCount,
  parentName,
  selected,
  onSelect,
}: {
  definition: PprElement;
  usageCount: number;
  parentName?: string;
  selected: boolean;
  onSelect: () => void;
}) {
  const Icon = TYPE_ICONS[definition.type];

  return (
    <button
      type="button"
      data-testid={`library-definition-${definition.id}`}
      aria-pressed={selected}
      onClick={onSelect}
      className={`group flex min-h-[5.25rem] w-full flex-col border p-3 text-left transition-colors ${
        selected
          ? 'border-primary bg-primary/[0.07] shadow-sm'
          : 'border-border bg-card hover:border-foreground/35 hover:bg-muted/30'
      }`}
    >
      <span className="flex w-full items-start gap-2.5">
        <span className={`flex h-7 w-7 shrink-0 items-center justify-center border bg-background ${TYPE_COLORS[definition.type]}`}>
          <Icon className="h-3.5 w-3.5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-foreground">{definition.name}</span>
          <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
            {definition.description || 'No description yet'}
          </span>
          {parentName && (
            <span className="mt-1 flex items-center gap-1 truncate font-mono text-[8px] uppercase tracking-wider text-primary/70">
              <GitBranch className="h-2.5 w-2.5 shrink-0" /> Specializes {parentName}
            </span>
          )}
        </span>
      </span>
      <span className="mt-auto flex w-full items-center gap-2 pt-2 font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground">
        <span className="truncate">{definitionCollection(definition)}</span>
        <span className="ml-auto shrink-0">{usageCount} {usageCount === 1 ? 'usage' : 'usages'}</span>
      </span>
    </button>
  );
}

function ProductStatesEditor({
  states,
  onChange,
}: {
  states: string[];
  onChange: (states: string[]) => void;
}) {
  const move = (index: number, offset: -1 | 1) => {
    const target = index + offset;
    if (target < 0 || target >= states.length) return;
    const next = [...states];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };
  return (
    <div className="mt-4 border-t border-border pt-4" data-testid="definition-states-editor">
      <div className="flex items-center justify-between gap-2">
        <Label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Lifecycle states</Label>
        <Button type="button" variant="ghost" size="sm" className="h-6 gap-1 px-1.5 text-[10px]" onClick={() => onChange([...states, `State ${states.length + 1}`])}>
          <Plus className="h-3 w-3" /> Add
        </Button>
      </div>
      <div className="mt-2 space-y-1.5">
        {states.map((state, index) => (
          <div key={`${state}-${index}`} className="flex items-center gap-1">
            <span className="w-5 text-center font-mono text-[9px] text-muted-foreground">{index + 1}</span>
            <Input
              key={`${state}-${index}`}
              defaultValue={state}
              aria-label={`Lifecycle state ${index + 1}`}
              className="h-7 min-w-0 flex-1 rounded-sm text-xs"
              onBlur={(event) => {
                const value = event.target.value.trim();
                if (!value || value === state || states.includes(value)) return;
                onChange(states.map((candidate, candidateIndex) => candidateIndex === index ? value : candidate));
              }}
            />
            <Button type="button" variant="ghost" size="icon" className="h-7 w-6" disabled={index === 0} onClick={() => move(index, -1)}><ChevronUp className="h-3 w-3" /></Button>
            <Button type="button" variant="ghost" size="icon" className="h-7 w-6" disabled={index === states.length - 1} onClick={() => move(index, 1)}><ChevronDown className="h-3 w-3" /></Button>
            <Button type="button" variant="ghost" size="icon" className="h-7 w-6 text-destructive" onClick={() => onChange(states.filter((_, candidateIndex) => candidateIndex !== index))}><Trash2 className="h-3 w-3" /></Button>
          </div>
        ))}
        {states.length === 0 && <p className="border border-dashed border-border p-2 text-center text-[10px] text-muted-foreground">Free-text states still work. Add vocabulary when useful.</p>}
      </div>
    </div>
  );
}

export function LibraryView({
  definitions,
  usages,
  typeFilter = null,
  onTypeFilterChange,
  onCreateDefinition,
  onUpdateDefinition,
  onDeleteDefinition,
}: LibraryViewProps) {
  const [selectedDefinitionId, setSelectedDefinitionId] = useState<string | null>(definitions[0]?.id ?? null);
  const [selectedCollection, setSelectedCollection] = useState(ALL_COLLECTIONS);
  const [query, setQuery] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<DefinitionInput['type']>('resource');
  const [newDomain, setNewDomain] = useState('');
  const [newParentDefinitionId, setNewParentDefinitionId] = useState(ROOT_DEFINITION);
  const [domainDraft, setDomainDraft] = useState('');
  const [domainDirty, setDomainDirty] = useState(false);

  const scopedDefinitions = useMemo(
    () => typeFilter
      ? definitions.filter((definition) => definition.type === typeFilter)
      : definitions,
    [definitions, typeFilter],
  );
  const selectedDefinition = scopedDefinitions.find((definition) => definition.id === selectedDefinitionId);
  const definitionById = useMemo(
    () => new Map(definitions.map((definition) => [definition.id, definition])),
    [definitions],
  );
  const selectedInheritancePath = useMemo(
    () => selectedDefinition ? getInheritancePath(selectedDefinition, definitions) : [],
    [definitions, selectedDefinition],
  );
  const availableParents = useMemo(
    () => selectedDefinition
      ? definitions.filter((candidate) => canBeParent(candidate, selectedDefinition, definitions))
      : [],
    [definitions, selectedDefinition],
  );
  const usageCountByDefinition = useMemo(
    () => new Map(definitions.map((definition) => [
      definition.id,
      usages.filter((usage) => usage.definition_id === definition.id).length,
    ])),
    [definitions, usages],
  );
  const collections = useMemo(() => {
    const names = [...new Set(scopedDefinitions.map(definitionCollection))];
    return names.sort((first, second) => {
      if (first === GENERAL_COLLECTION) return -1;
      if (second === GENERAL_COLLECTION) return 1;
      return first.localeCompare(second);
    });
  }, [scopedDefinitions]);
  const collectionCounts = useMemo(
    () => new Map(collections.map((collection) => [
      collection,
      scopedDefinitions.filter((definition) => definitionCollection(definition) === collection).length,
    ])),
    [collections, scopedDefinitions],
  );
  const normalizedQuery = query.trim().toLowerCase();
  const visibleDefinitions = useMemo(
    () => scopedDefinitions.filter((definition) => {
      if (selectedCollection !== ALL_COLLECTIONS && definitionCollection(definition) !== selectedCollection) return false;
      if (!normalizedQuery) return true;
      return [definition.name, definition.description, definition.type, definitionCollection(definition)]
        .some((value) => value?.toLowerCase().includes(normalizedQuery));
    }),
    [normalizedQuery, scopedDefinitions, selectedCollection],
  );

  useEffect(() => {
    if (selectedDefinitionId && scopedDefinitions.some((definition) => definition.id === selectedDefinitionId)) return;
    setSelectedDefinitionId(scopedDefinitions[0]?.id ?? null);
  }, [scopedDefinitions, selectedDefinitionId]);

  useEffect(() => {
    setSelectedCollection(ALL_COLLECTIONS);
    setQuery('');
  }, [typeFilter]);

  useEffect(() => {
    if (visibleDefinitions.some((definition) => definition.id === selectedDefinitionId)) return;
    setSelectedDefinitionId(visibleDefinitions[0]?.id ?? null);
  }, [selectedDefinitionId, visibleDefinitions]);

  useEffect(() => {
    setDomainDraft(selectedDefinition?.domain ?? '');
    setDomainDirty(false);
  }, [selectedDefinition?.domain, selectedDefinition?.id]);

  const openCreateDialog = (type: DefinitionInput['type'] = 'resource') => {
    setNewName('');
    setNewType(type);
    setNewDomain(selectedCollection === ALL_COLLECTIONS || selectedCollection === GENERAL_COLLECTION ? '' : selectedCollection);
    setNewParentDefinitionId(ROOT_DEFINITION);
    setCreateOpen(true);
  };

  const selectNewType = (type: DefinitionInput['type']) => {
    setNewType(type);
    const currentParent = definitions.find((definition) => definition.id === newParentDefinitionId);
    if (currentParent?.type !== type) setNewParentDefinitionId(ROOT_DEFINITION);
  };

  const createDefinition = () => {
    const name = newName.trim();
    if (!name) return;
    const domain = newDomain.trim() || null;
    onCreateDefinition(
      {
        name,
        type: newType,
        domain,
        parent_definition_id: newParentDefinitionId === ROOT_DEFINITION ? null : newParentDefinitionId,
        description: '',
        attributes: [],
      },
      (definition) => {
        setSelectedDefinitionId(definition.id);
        setSelectedCollection(definitionCollection(definition));
        setCreateOpen(false);
        toast.success(`${definition.name} added to ${definitionCollection(definition)}`, {
          description: definition.parent_definition_id
            ? `Specializes ${definitionById.get(definition.parent_definition_id)?.name ?? 'its parent definition'}.`
            : 'Created as a root definition.',
        });
      },
    );
  };

  const commitDomain = () => {
    if (!selectedDefinition) return;
    const domain = domainDraft.trim() || null;
    if (domain === (selectedDefinition.domain ?? null)) {
      setDomainDirty(false);
      return;
    }
    onUpdateDefinition(selectedDefinition.id, { domain });
    setSelectedCollection(domain || GENERAL_COLLECTION);
    setDomainDirty(false);
  };

  return (
    <div data-testid="ppr-library-view" className="flex h-full min-h-0 bg-background">
      <aside className="hidden w-72 shrink-0 border-r border-border bg-card/60 md:flex md:flex-col">
        <div className="border-b border-border p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="aml-kicker">Reusable assets</div>
              <h2 className="mt-1 font-display text-xl font-semibold uppercase tracking-tight">Library</h2>
            </div>
            <Button
              size="sm"
              className="h-8 gap-1.5 rounded-sm px-2.5 text-xs"
              data-testid="button-create-definition"
              onClick={() => openCreateDialog(typeFilter ?? 'resource')}
            >
              <Plus className="h-3.5 w-3.5" /> Add
            </Button>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
            Organize definitions by the engineering context they belong to.
          </p>
          <div className="relative mt-3">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search definitions…"
              aria-label="Search library definitions"
              data-testid="library-search"
              className="h-8 rounded-sm pl-8 text-xs"
            />
          </div>
        </div>

        <ScrollArea className="min-h-0 flex-1">
          <div className="p-3">
            <div className="mb-2 px-2 aml-kicker">Collections</div>
            <button
              type="button"
              data-testid="library-collection-all"
              aria-pressed={selectedCollection === ALL_COLLECTIONS}
              onClick={() => setSelectedCollection(ALL_COLLECTIONS)}
              className={`flex h-9 w-full items-center gap-2 px-2 text-left text-xs transition-colors ${
                selectedCollection === ALL_COLLECTIONS ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
              }`}
            >
              <Library className="h-3.5 w-3.5" />
              <span className="min-w-0 flex-1 truncate font-medium">{typeFilter ? `All ${typeFilter}s` : 'All definitions'}</span>
              <span className="font-mono text-[10px] opacity-70">{scopedDefinitions.length}</span>
            </button>
            <div className="mt-1 space-y-0.5">
              {collections.map((collection) => (
                <button
                  key={collection}
                  type="button"
                  data-testid={`library-collection-${collection.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
                  aria-pressed={selectedCollection === collection}
                  onClick={() => setSelectedCollection(collection)}
                  className={`flex h-9 w-full items-center gap-2 px-2 text-left text-xs transition-colors ${
                    selectedCollection === collection ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
                  }`}
                >
                  <Folder className="h-3.5 w-3.5" />
                  <span className="min-w-0 flex-1 truncate font-medium">{collection}</span>
                  <span className="font-mono text-[10px] opacity-70">{collectionCounts.get(collection)}</span>
                </button>
              ))}
              {collections.length === 0 && (
                <div className="border border-dashed border-border p-3 text-center text-[10px] text-muted-foreground">
                  Collections appear when definitions are added.
                </div>
              )}
            </div>
          </div>
        </ScrollArea>

        <div className="border-t border-border p-3">
          <div className="grid grid-cols-3 divide-x divide-border border border-border bg-background">
            {DEFINITION_TYPES.map((type) => {
              const Icon = TYPE_ICONS[type];
              return (
                <button
                  key={type}
                  type="button"
                  title={`Add ${type} definition`}
                  onClick={() => openCreateDialog(type)}
                  className="flex flex-col items-center gap-1 px-1 py-2 transition-colors hover:bg-muted"
                >
                  <Icon className={`h-3.5 w-3.5 ${TYPE_COLORS[type]}`} />
                  <span className="font-mono text-[9px] uppercase tracking-wider">
                    {definitions.filter((definition) => definition.type === type).length} {type}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex min-h-14 shrink-0 items-center justify-between gap-4 border-b border-border px-4 py-2.5 lg:px-5">
          <div className="min-w-0">
            <div className="aml-kicker">{typeFilter ? `${typeFilter} library` : selectedCollection === ALL_COLLECTIONS ? 'Complete catalog' : 'Library collection'}</div>
            <h2 className="truncate font-display text-lg font-semibold uppercase tracking-tight">
              {selectedCollection === ALL_COLLECTIONS
                ? typeFilter ? `${typeFilter} definitions` : 'All definitions'
                : selectedCollection}
            </h2>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <span className="hidden font-mono text-[10px] uppercase tracking-wider text-muted-foreground sm:block">
              {visibleDefinitions.length} of {scopedDefinitions.length}
            </span>
            <Button size="sm" className="h-8 gap-1.5 rounded-sm text-xs md:hidden" onClick={() => openCreateDialog(typeFilter ?? 'resource')}>
              <Plus className="h-3.5 w-3.5" /> Definition
            </Button>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1 border-b border-border bg-muted/10 px-4 py-2 lg:px-5" role="group" aria-label="Library PPR type filter">
          <button
            type="button"
            data-testid="library-type-filter-all"
            aria-pressed={typeFilter === null}
            onClick={() => onTypeFilterChange?.(null)}
            className={`h-7 border px-2.5 font-mono text-[9px] uppercase tracking-wider ${typeFilter === null ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background hover:bg-muted'}`}
          >
            All types
          </button>
          {DEFINITION_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              data-testid={`library-type-filter-${type}`}
              aria-pressed={typeFilter === type}
              onClick={() => onTypeFilterChange?.(type)}
              className={`h-7 border px-2.5 font-mono text-[9px] uppercase tracking-wider ${typeFilter === type ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background hover:bg-muted'}`}
            >
              {type}
            </button>
          ))}
        </div>

        <div className="flex min-h-0 flex-1">
          <ScrollArea className="min-w-0 flex-1">
            <div className="p-4 lg:p-5">
              <div className="relative mb-4 md:hidden">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search definitions…"
                  aria-label="Search library definitions"
                  className="h-8 rounded-sm pl-8 text-xs"
                />
              </div>

              <div className="space-y-6">
                {DEFINITION_TYPES.map((type) => {
                  const Icon = TYPE_ICONS[type];
                  const typeDefinitions = visibleDefinitions.filter((definition) => definition.type === type);
                  if (typeDefinitions.length === 0) return null;
                  return (
                    <section key={type} data-testid={`library-type-section-${type}`}>
                      <div className="mb-2.5 flex items-center gap-2 border-b border-border pb-2">
                        <Icon className={`h-3.5 w-3.5 ${TYPE_COLORS[type]}`} />
                        <h3 className="aml-kicker">{type}{type === 'process' ? 'es' : 's'}</h3>
                        <span className="ml-auto font-mono text-[10px] text-muted-foreground">{typeDefinitions.length}</span>
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2 2xl:grid-cols-3">
                        {typeDefinitions.map((definition) => (
                          <DefinitionCard
                            key={definition.id}
                            definition={definition}
                            usageCount={usageCountByDefinition.get(definition.id) ?? 0}
                            parentName={definition.parent_definition_id ? definitionById.get(definition.parent_definition_id)?.name : undefined}
                            selected={definition.id === selectedDefinitionId}
                            onSelect={() => setSelectedDefinitionId(definition.id)}
                          />
                        ))}
                      </div>
                    </section>
                  );
                })}
              </div>

              {visibleDefinitions.length === 0 && (
                <div className="flex min-h-[18rem] flex-col items-center justify-center border border-dashed border-border p-8 text-center">
                  <Library className="h-7 w-7 text-muted-foreground" />
                  <h3 className="mt-3 text-sm font-semibold">No matching definitions</h3>
                  <p className="mt-1 max-w-xs text-xs text-muted-foreground">
                    {scopedDefinitions.length === 0
                      ? typeFilter
                        ? `Create a reusable ${typeFilter} definition or switch to another type.`
                        : 'Create a reusable Product, Process, or Resource definition to get started.'
                      : 'Try another search or choose a different collection.'}
                  </p>
                  <Button size="sm" className="mt-4 gap-1.5 rounded-sm text-xs" onClick={() => openCreateDialog(typeFilter ?? 'resource')}>
                    <Plus className="h-3.5 w-3.5" /> Create definition
                  </Button>
                </div>
              )}
            </div>
          </ScrollArea>

          <aside className="hidden w-[22rem] shrink-0 border-l border-border bg-card lg:flex lg:flex-col">
            {selectedDefinition ? (
              <>
                <div className="shrink-0 border-b border-border p-4">
                  <div className="aml-kicker">Definition context</div>
                  <Label htmlFor="definition-domain" className="mt-3 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Collection / domain
                  </Label>
                  <Input
                    id="definition-domain"
                    data-testid="definition-domain-input"
                    value={domainDraft}
                    onChange={(event) => {
                      setDomainDraft(event.target.value);
                      setDomainDirty(true);
                    }}
                    onBlur={commitDomain}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') event.currentTarget.blur();
                    }}
                    placeholder="General"
                    className="mt-1.5 h-8 rounded-sm text-xs"
                  />
                  <div className={`mt-1.5 flex items-center gap-1.5 text-[9px] ${domainDirty ? 'text-amber-700 dark:text-amber-300' : 'text-emerald-700 dark:text-emerald-300'}`}>
                    {domainDirty ? <span className="h-1.5 w-1.5 rounded-full bg-current" /> : <Check className="h-3 w-3" />}
                    {domainDirty ? 'Press Enter or leave the field to save' : `Saved in ${selectedDefinition.domain || GENERAL_COLLECTION}`}
                  </div>

                  <Label htmlFor="definition-parent" className="mt-4 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Specializes / parent
                  </Label>
                  <Select
                    value={selectedDefinition.parent_definition_id ?? ROOT_DEFINITION}
                    onValueChange={(value) => onUpdateDefinition(selectedDefinition.id, {
                      parent_definition_id: value === ROOT_DEFINITION ? null : value,
                    })}
                  >
                    <SelectTrigger id="definition-parent" data-testid="definition-parent-select" className="mt-1.5 h-8 rounded-sm text-xs">
                      <GitBranch className="mr-1 h-3.5 w-3.5" />
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ROOT_DEFINITION}>None — root definition</SelectItem>
                      {availableParents.map((definition) => (
                        <SelectItem key={definition.id} value={definition.id}>
                          {definition.name} · {definitionCollection(definition)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="mt-1.5 text-[10px] leading-relaxed text-muted-foreground">
                    Place this definition beneath a broader {selectedDefinition.type} concept.
                  </p>
                  <div data-testid="definition-inheritance-path" className="mt-2 flex flex-wrap items-center gap-1 border border-border bg-background px-2 py-1.5">
                    {selectedInheritancePath.map((definition, index) => (
                      <span key={definition.id} className="contents">
                        {index > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground" />}
                        <span className={index === selectedInheritancePath.length - 1 ? 'text-[10px] font-semibold' : 'text-[10px] text-muted-foreground'}>
                          {definition.name}
                        </span>
                      </span>
                    ))}
                  </div>
                  {selectedDefinition.type === 'product' && (
                    <ProductStatesEditor
                      states={selectedDefinition.states ?? []}
                      onChange={(states) => onUpdateDefinition(selectedDefinition.id, { states })}
                    />
                  )}
                </div>
                <div className="min-h-0 flex-1">
                  <ElementInspector
                    element={selectedDefinition}
                    definitions={[]}
                    onUpdate={(updates) => onUpdateDefinition(selectedDefinition.id, {
                      name: updates.name,
                      description: updates.description,
                      attributes: updates.attributes,
                    })}
                    onDelete={() => onDeleteDefinition(selectedDefinition.id)}
                    deleteDisabled={(usageCountByDefinition.get(selectedDefinition.id) ?? 0) > 0 || definitions.some((definition) => definition.parent_definition_id === selectedDefinition.id)}
                    deleteHint={(usageCountByDefinition.get(selectedDefinition.id) ?? 0) > 0
                      ? 'Remove its diagram usages first'
                      : definitions.some((definition) => definition.parent_definition_id === selectedDefinition.id)
                        ? 'Reassign its child definitions first'
                        : 'Delete definition'}
                    deleteLabel="Delete definition"
                  />
                </div>
              </>
            ) : (
              <div className="flex h-full items-center justify-center p-8 text-center text-xs text-muted-foreground">
                Select a definition to inspect its context and engineering properties.
              </div>
            )}
          </aside>
        </div>
      </section>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent data-testid="create-definition-dialog" className="rounded-sm sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display text-xl uppercase tracking-tight">New library definition</DialogTitle>
            <DialogDescription>
              Define the reusable asset and place it in the context where engineers will look for it.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              createDefinition();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="new-definition-name" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Name</Label>
              <Input
                id="new-definition-name"
                autoFocus
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                placeholder="e.g. Six-axis robot"
                className="rounded-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label id="new-definition-type-label" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">PPR type</Label>
              <div role="group" aria-labelledby="new-definition-type-label" className="grid grid-cols-3 divide-x divide-border border border-border bg-background">
                {DEFINITION_TYPES.map((type) => {
                  const Icon = TYPE_ICONS[type];
                  return (
                    <button
                      key={type}
                      type="button"
                      data-testid={`new-definition-type-${type}`}
                      aria-pressed={newType === type}
                      onClick={() => selectNewType(type)}
                      className={`flex h-14 flex-col items-center justify-center gap-1 transition-colors ${
                        newType === type ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
                      }`}
                    >
                      <Icon className={`h-4 w-4 ${newType === type ? '' : TYPE_COLORS[type]}`} />
                      <span className="font-mono text-[9px] uppercase tracking-wider">{type}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-definition-domain" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Collection / domain</Label>
              <Input
                id="new-definition-domain"
                value={newDomain}
                onChange={(event) => setNewDomain(event.target.value)}
                placeholder="e.g. Robotics, Logistics"
                maxLength={80}
                className="rounded-sm"
              />
              {collections.some((collection) => collection !== GENERAL_COLLECTION) && (
                <div className="flex flex-wrap gap-1 pt-0.5">
                  {collections.filter((collection) => collection !== GENERAL_COLLECTION).slice(0, 5).map((collection) => (
                    <button
                      key={collection}
                      type="button"
                      onClick={() => setNewDomain(collection)}
                      className={`border px-2 py-1 font-mono text-[8px] uppercase tracking-wider transition-colors ${
                        newDomain === collection ? 'border-primary bg-primary text-primary-foreground' : 'border-border hover:bg-muted'
                      }`}
                    >
                      {collection}
                    </button>
                  ))}
                </div>
              )}
              <div data-testid="new-definition-domain-confirmation" className="flex items-center gap-1.5 border border-emerald-600/25 bg-emerald-500/[0.06] px-2 py-1.5 text-[10px] text-emerald-700 dark:text-emerald-300">
                <Check className="h-3 w-3 shrink-0" />
                Will be saved in <strong>{newDomain.trim() || GENERAL_COLLECTION}</strong>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-definition-parent" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Specializes / parent</Label>
              <Select value={newParentDefinitionId} onValueChange={setNewParentDefinitionId}>
                <SelectTrigger id="new-definition-parent" className="rounded-sm">
                  <GitBranch className="mr-1 h-3.5 w-3.5" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ROOT_DEFINITION}>None — root definition</SelectItem>
                  {definitions.filter((definition) => definition.type === newType).map((definition) => (
                    <SelectItem key={definition.id} value={definition.id}>
                      {definition.name} · {definitionCollection(definition)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[10px] text-muted-foreground">Optional ontology link to a broader {newType} definition.</p>
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={!newName.trim()} className="rounded-sm">Create definition</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
