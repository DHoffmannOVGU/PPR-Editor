import { useEffect, useMemo, useState } from 'react';
import type { ElementInput, PprElement } from '@workspace/api-client-react';
import { BookOpen, Boxes, Cog, Folder, Plus, Search, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import type { PprCanvasPerspective } from '../canvas/ppr-perspective';

const NEW_USAGE_POSITIONS = {
  product: { x: 100, y: 720 },
  process: { x: 470, y: 720 },
  resource: { x: 820, y: 720 },
} as const;
const TYPE_ICONS = { product: Boxes, process: Cog, resource: Users } as const;
const DEFINITION_TYPES = ['product', 'process', 'resource'] as const;
const ALL_TYPES = '__all_types__';
const ALL_COLLECTIONS = '__all_collections__';
const GENERAL_COLLECTION = 'General';
const SUGGESTED_LIMIT = 4;

interface ElementsPaletteProps {
  definitions: PprElement[];
  usages: PprElement[];
  perspective?: PprCanvasPerspective;
  onCreateElement: (data: ElementInput, onSuccess?: (element: PprElement) => void) => void;
  onOpenLibrary?: () => void;
}

const PERSPECTIVE_PALETTE_COPY: Record<PprCanvasPerspective, {
  eyebrow: string;
  title: string;
  description: string;
}> = {
  ppr: {
    eyebrow: 'PPR / diagram',
    title: 'Add to model',
    description: 'Create a PPR usage or place a linked definition from the Library.',
  },
  product: {
    eyebrow: 'Product / tree',
    title: 'Add product',
    description: 'Add products and components to this tree. New usages start as product-view only.',
  },
  process: {
    eyebrow: 'Process / tree',
    title: 'Add process',
    description: 'Add processes and subprocesses here without crowding the PPR diagram.',
  },
  levels: {
    eyebrow: 'PPR Levels',
    title: 'Derived view',
    description: 'This view is read-only. Return to the PPR surface to author changes.',
  },
  resource: {
    eyebrow: 'Resource / tree',
    title: 'Add resource',
    description: 'Add resources and subresources here, then promote the ones needed in PPR.',
  },
};

function definitionCollection(definition: PprElement) {
  return definition.domain?.trim() || GENERAL_COLLECTION;
}

export function ElementsPalette({
  definitions,
  usages,
  perspective = 'ppr',
  onCreateElement,
  onOpenLibrary,
}: ElementsPaletteProps) {
  const [browserOpen, setBrowserOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState(ALL_TYPES);
  const [collectionFilter, setCollectionFilter] = useState(ALL_COLLECTIONS);
  const [recentDefinitionIds, setRecentDefinitionIds] = useState<string[]>([]);
  const paletteCopy = PERSPECTIVE_PALETTE_COPY[perspective];
  const availableTypes = perspective === 'ppr'
    ? DEFINITION_TYPES
    : perspective === 'levels'
      ? []
      : [perspective] as const;
  const scopedDefinitions = useMemo(
    () => perspective === 'ppr' || perspective === 'levels'
      ? definitions
      : definitions.filter((definition) => definition.type === perspective),
    [definitions, perspective],
  );

  useEffect(() => {
    setTypeFilter(perspective === 'ppr' || perspective === 'levels' ? ALL_TYPES : perspective);
    setCollectionFilter(ALL_COLLECTIONS);
    setQuery('');
  }, [perspective]);

  const usageCounts = useMemo(() => {
    const counts = new Map<string, number>();
    usages.forEach((usage) => {
      if (usage.definition_id) counts.set(usage.definition_id, (counts.get(usage.definition_id) ?? 0) + 1);
    });
    return counts;
  }, [usages]);
  const collections = useMemo(
    () => [...new Set(scopedDefinitions.map(definitionCollection))].sort((a, b) => {
      if (a === GENERAL_COLLECTION) return -1;
      if (b === GENERAL_COLLECTION) return 1;
      return a.localeCompare(b);
    }),
    [scopedDefinitions],
  );
  const definitionById = useMemo(
    () => new Map(definitions.map((definition) => [definition.id, definition])),
    [definitions],
  );
  const suggested = useMemo(() => {
    const ranked = [...scopedDefinitions].sort((a, b) => {
      const aRecent = recentDefinitionIds.indexOf(a.id);
      const bRecent = recentDefinitionIds.indexOf(b.id);
      if ((aRecent >= 0) !== (bRecent >= 0)) return aRecent >= 0 ? -1 : 1;
      if (aRecent >= 0 && aRecent !== bRecent) return aRecent - bRecent;
      return (usageCounts.get(b.id) ?? 0) - (usageCounts.get(a.id) ?? 0) || a.name.localeCompare(b.name);
    });
    const result: PprElement[] = [];
    availableTypes.forEach((type) => {
      const candidate = ranked.find((definition) => definition.type === type);
      if (candidate) result.push(candidate);
    });
    ranked.forEach((definition) => {
      if (result.length < SUGGESTED_LIMIT && !result.some(({ id }) => id === definition.id)) result.push(definition);
    });
    return result.slice(0, SUGGESTED_LIMIT);
  }, [availableTypes, recentDefinitionIds, scopedDefinitions, usageCounts]);
  const visibleDefinitions = useMemo(() => {
    const search = query.trim().toLowerCase();
    return scopedDefinitions.filter((definition) => {
      if (typeFilter !== ALL_TYPES && definition.type !== typeFilter) return false;
      if (collectionFilter !== ALL_COLLECTIONS && definitionCollection(definition) !== collectionFilter) return false;
      const parentName = definition.parent_definition_id
        ? definitionById.get(definition.parent_definition_id)?.name
        : undefined;
      return !search || [definition.name, definition.description, definition.type, definitionCollection(definition), parentName]
        .some((value) => value?.toLowerCase().includes(search));
    });
  }, [collectionFilter, definitionById, query, scopedDefinitions, typeFilter]);

  const addStandalone = (type: PprElement['type']) => {
    const label = type.charAt(0).toUpperCase() + type.slice(1);
    onCreateElement({
      name: `New ${label}`,
      type,
      definition_id: null,
      description: '',
      attributes: [],
      visible_in_ppr: perspective === 'ppr',
      ...NEW_USAGE_POSITIONS[type],
    });
    toast.success(`${label} usage created`);
  };
  const addFromLibrary = (definition: PprElement, closeBrowser = false) => {
    const instanceNumber = (usageCounts.get(definition.id) ?? 0) + 1;
    onCreateElement({
      name: `${definition.name} ${instanceNumber}`,
      type: definition.type,
      definition_id: definition.id,
      description: '',
      attributes: [],
      visible_in_ppr: perspective === 'ppr',
      ...NEW_USAGE_POSITIONS[definition.type],
    });
    setRecentDefinitionIds((current) => [definition.id, ...current.filter((id) => id !== definition.id)].slice(0, SUGGESTED_LIMIT));
    if (closeBrowser) setBrowserOpen(false);
    toast.success(`${definition.name} ${instanceNumber} created`, {
      description: `Linked to ${definitionCollection(definition)} / ${definition.type}.`,
    });
  };

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b border-border bg-muted/20 px-4 py-3">
        <div className="aml-kicker">{paletteCopy.eyebrow}</div>
        <h2 className="mt-1 font-display text-lg font-semibold uppercase tracking-tight">{paletteCopy.title}</h2>
        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{paletteCopy.description}</p>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-5 p-4">
          <section>
            <div className="mb-2 aml-kicker">Quick create</div>
            <div
              className="grid divide-x divide-border border border-border bg-background"
              style={{ gridTemplateColumns: `repeat(${availableTypes.length}, minmax(0, 1fr))` }}
            >
              {availableTypes.map((type) => {
                const Icon = TYPE_ICONS[type];
                return (
                  <button
                    key={type}
                    type="button"
                    data-testid={`add-standalone-${type}`}
                    onClick={() => addStandalone(type)}
                    className="group flex min-w-0 flex-col items-center gap-1.5 px-1 py-3 transition-colors hover:bg-muted/60"
                    title={`Add standalone ${type}`}
                  >
                    <span className={`relative flex h-7 w-7 items-center justify-center text-[hsl(var(--ppr-${type}))]`}>
                      <Icon className="h-4 w-4" />
                      <Plus className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 bg-background" />
                    </span>
                    <span className="truncate font-mono text-[9px] uppercase tracking-wider">{type}</span>
                  </button>
                );
              })}
            </div>
            <p className="mt-1.5 text-[9px] leading-relaxed text-muted-foreground">
              {perspective === 'ppr'
                ? 'New usages are immediately visible in the PPR diagram.'
                : perspective === 'levels'
                  ? 'Use the PPR surface to create and connect model elements.'
                : `New ${perspective}s stay in this view until you include them in PPR.`}
            </p>
          </section>

          <section className="border-t border-border pt-4">
            <div className="flex items-center gap-2">
              <BookOpen className="h-3.5 w-3.5 text-accent" />
              <span className="aml-kicker">From Library</span>
              <span className="ml-auto font-mono text-[10px] text-muted-foreground">{scopedDefinitions.length}</span>
            </div>
            <Button
              variant="outline"
              data-testid="button-browse-library-assets"
              onClick={() => setBrowserOpen(true)}
              className="mt-2 h-9 w-full justify-start gap-2 rounded-sm px-3 text-xs font-normal text-muted-foreground"
            >
              <Search className="h-3.5 w-3.5" /> Search {perspective === 'ppr' ? 'all' : perspective} definitions…
            </Button>

            {suggested.length > 0 ? (
              <div className="mt-3">
                <div className="mb-1.5 flex items-center justify-between px-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
                  <span>Suggested</span><span>max {SUGGESTED_LIMIT}</span>
                </div>
                <div className="space-y-1.5">
                  {suggested.map((definition) => {
                    const Icon = TYPE_ICONS[definition.type];
                    return (
                      <button
                        key={definition.id}
                        type="button"
                        data-testid={`library-asset-${definition.id}`}
                        onClick={() => addFromLibrary(definition)}
                        className="flex w-full items-center gap-2.5 border border-border bg-background/60 px-2.5 py-2 text-left transition-colors hover:border-foreground/35 hover:bg-muted/40"
                      >
                        <Icon className={`h-3.5 w-3.5 shrink-0 text-[hsl(var(--ppr-${definition.type}))]`} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs font-medium">{definition.name}</span>
                          <span className="block truncate font-mono text-[8px] uppercase tracking-wider text-muted-foreground">
                            {definition.parent_definition_id
                              ? `Specializes ${definitionById.get(definition.parent_definition_id)?.name ?? 'definition'}`
                              : definitionCollection(definition)}
                          </span>
                        </span>
                        <Plus className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="mt-3 border border-dashed border-border p-3 text-center text-[10px] text-muted-foreground">No reusable definitions yet.</div>
            )}
            {onOpenLibrary && (
              <Button
                variant="ghost"
                size="sm"
                data-testid="button-open-library"
                className="mt-2 min-h-9 w-full justify-start gap-2 rounded-sm px-2 text-[10px] text-muted-foreground transition-[background-color,color,transform] duration-150 hover:bg-muted/60 hover:text-foreground active:scale-[0.99] focus-visible:ring-2"
                onClick={onOpenLibrary}
              >
                <BookOpen className="h-3 w-3" /> Open {perspective === 'ppr' ? '' : `${perspective} `}Library
              </Button>
            )}
          </section>
        </div>
      </ScrollArea>

      <Dialog open={browserOpen} onOpenChange={setBrowserOpen}>
        <DialogContent data-testid="library-assets-dialog" className="flex max-h-[78vh] flex-col rounded-sm sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="font-display text-xl uppercase tracking-tight">Place from {perspective === 'ppr' ? '' : `${perspective} `}Library</DialogTitle>
            <DialogDescription>
              Find a definition by name or engineering collection. The new usage stays linked to it.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_12rem]">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Search reusable definitions" placeholder="Search name, type, collection…" className="h-9 rounded-sm pl-8 text-xs" />
            </div>
            <Select value={collectionFilter} onValueChange={setCollectionFilter}>
              <SelectTrigger className="h-9 rounded-sm text-xs" aria-label="Filter by collection">
                <Folder className="mr-1 h-3.5 w-3.5" /><SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_COLLECTIONS}>All collections</SelectItem>
                {collections.map((collection) => <SelectItem key={collection} value={collection}>{collection}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-wrap gap-1 border-b border-border pb-3">
            {(perspective === 'ppr' ? [ALL_TYPES, ...DEFINITION_TYPES] : availableTypes).map((type) => (
              <button
                key={type}
                type="button"
                aria-pressed={typeFilter === type}
                onClick={() => setTypeFilter(type)}
                className={`h-7 border px-2.5 font-mono text-[9px] uppercase tracking-wider ${typeFilter === type ? 'border-primary bg-primary text-primary-foreground' : 'border-border hover:bg-muted'}`}
              >
                {type === ALL_TYPES ? 'All types' : type}
              </button>
            ))}
            <span className="ml-auto self-center font-mono text-[9px] uppercase tracking-wider text-muted-foreground">{visibleDefinitions.length} matches</span>
          </div>
          <ScrollArea className="min-h-0 flex-1 pr-3">
            <div className="space-y-4 py-1">
              {collections.map((collection) => {
                const inCollection = visibleDefinitions.filter((definition) => definitionCollection(definition) === collection);
                if (!inCollection.length) return null;
                return (
                  <section key={collection}>
                    <div className="mb-1.5 flex items-center gap-2">
                      <Folder className="h-3.5 w-3.5 text-muted-foreground" /><h3 className="aml-kicker">{collection}</h3>
                      <span className="ml-auto font-mono text-[9px] text-muted-foreground">{inCollection.length}</span>
                    </div>
                    <div className="grid gap-1.5 sm:grid-cols-2">
                      {inCollection.map((definition) => {
                        const Icon = TYPE_ICONS[definition.type];
                        const count = usageCounts.get(definition.id) ?? 0;
                        return (
                          <button
                            key={definition.id}
                            type="button"
                            data-testid={`library-browser-asset-${definition.id}`}
                            onClick={() => addFromLibrary(definition, true)}
                            className="flex items-center gap-2.5 border border-border bg-card p-2.5 text-left transition-colors hover:border-primary hover:bg-primary/[0.04]"
                          >
                            <span className={`flex h-7 w-7 shrink-0 items-center justify-center border text-[hsl(var(--ppr-${definition.type}))]`}><Icon className="h-3.5 w-3.5" /></span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-xs font-semibold">{definition.name}</span>
                              <span className="block truncate font-mono text-[8px] uppercase tracking-wider text-muted-foreground">
                                {definition.type} · {count} {count === 1 ? 'usage' : 'usages'}
                                {definition.parent_definition_id ? ` · child of ${definitionById.get(definition.parent_definition_id)?.name ?? 'definition'}` : ''}
                              </span>
                            </span>
                            <Plus className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          </button>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
              {!visibleDefinitions.length && (
                <div className="flex min-h-40 flex-col items-center justify-center border border-dashed border-border p-6 text-center">
                  <Search className="h-6 w-6 text-muted-foreground" />
                  <div className="mt-2 text-xs font-semibold">No matching definitions</div>
                  <div className="mt-1 text-[10px] text-muted-foreground">Clear a filter or try a broader search.</div>
                </div>
              )}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  );
}
