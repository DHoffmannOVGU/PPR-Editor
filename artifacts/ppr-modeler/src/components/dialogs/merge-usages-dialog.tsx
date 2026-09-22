import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import type {
  Attribute,
  MergeUsagesRequest,
  PprElement,
  PprModel,
  PprRelationship,
} from '@workspace/api-client-react';
import { AlertTriangle, ArrowDown, ArrowRight, Check, GitMerge } from 'lucide-react';

interface MergeUsagesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  first: PprElement;
  second: PprElement;
  model: PprModel;
  onMerge: (request: MergeUsagesRequest) => void;
  isPending?: boolean;
}

type AttributeGroup = {
  name: string;
  first: Attribute[];
  second: Attribute[];
  conflict: boolean;
};

function attributeValue(attribute: Attribute) {
  return `${String(attribute.value)}${attribute.unit ? ` ${attribute.unit}` : ''}`;
}

function attributesMatch(first: Attribute, second: Attribute) {
  return (
    first.name === second.name &&
    first.value === second.value &&
    (first.datatype ?? null) === (second.datatype ?? null) &&
    (first.unit ?? null) === (second.unit ?? null)
  );
}

function getAttributeGroups(first: PprElement, second: PprElement): AttributeGroup[] {
  const groups = new Map<string, AttributeGroup>();
  for (const [source, attributes] of [
    ['first', first.attributes],
    ['second', second.attributes],
  ] as const) {
    for (const attribute of attributes) {
      const key = attribute.name.toLocaleLowerCase();
      const group = groups.get(key) ?? {
        name: attribute.name,
        first: [],
        second: [],
        conflict: false,
      };
      group[source].push(attribute);
      groups.set(key, group);
    }
  }
  return [...groups.values()].map((group) => ({
    ...group,
    conflict: Boolean(
      group.first.length &&
      group.second.length &&
      group.first.some((firstAttribute) =>
        group.second.some((secondAttribute) => !attributesMatch(firstAttribute, secondAttribute)),
      ),
    ),
  }));
}

function getSelfLoopRelationships(
  relationships: PprRelationship[],
  firstId: string,
  secondId: string,
) {
  return relationships.filter(
    (relationship) =>
      (relationship.source_id === firstId && relationship.target_id === secondId) ||
      (relationship.source_id === secondId && relationship.target_id === firstId),
  );
}

function definitionLabel(element: PprElement, model: PprModel) {
  if (!element.definition_id) return 'Standalone usage';
  return model.library.definitions.find((definition) => definition.id === element.definition_id)?.name
    ?? 'Missing definition';
}

export function MergeUsagesDialog({
  open,
  onOpenChange,
  first,
  second,
  model,
  onMerge,
  isPending = false,
}: MergeUsagesDialogProps) {
  const attributeGroups = React.useMemo(
    () => getAttributeGroups(first, second),
    [first, second],
  );
  const conflictingAttributes = attributeGroups.filter((group) => group.conflict);
  const selfLoopRelationships = React.useMemo(
    () => getSelfLoopRelationships(model.diagram.relationships, first.id, second.id),
    [first.id, model.diagram.relationships, second.id],
  );
  const [survivorId, setSurvivorId] = React.useState(first.id);
  const [nameSource, setNameSource] = React.useState<'first' | 'second'>('first');
  const [descriptionSource, setDescriptionSource] = React.useState<'first' | 'second'>('first');
  const [definitionSource, setDefinitionSource] = React.useState<'first' | 'second' | 'none'>('first');
  const [attributeSources, setAttributeSources] = React.useState<Record<string, 'first' | 'second' | 'both'>>({});
  const [selfLoopPolicy, setSelfLoopPolicy] = React.useState<'reject' | 'drop'>('reject');

  React.useEffect(() => {
    if (!open) return;
    setSurvivorId(first.id);
    setNameSource('first');
    setDescriptionSource('first');
    setDefinitionSource(first.definition_id ? 'first' : second.definition_id ? 'second' : 'none');
    setAttributeSources(
      Object.fromEntries(conflictingAttributes.map((group) => [group.name.toLocaleLowerCase(), 'first'])),
    );
    setSelfLoopPolicy('reject');
  }, [conflictingAttributes, first.definition_id, first.id, open, second.definition_id, second.id]);

  const buildRequest = (): MergeUsagesRequest => ({
    first_id: first.id,
    second_id: second.id,
    survivor_id: survivorId,
    name_source: nameSource,
    description_source: descriptionSource,
    definition_source: definitionSource,
    attribute_decisions: conflictingAttributes.map((group) => ({
      name: group.name,
      source: attributeSources[group.name.toLocaleLowerCase()] ?? 'first',
    })),
    self_loop_policy: selfLoopPolicy,
  });

  const handleSubmit = () => {
    onMerge(buildRequest());
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl rounded-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 uppercase tracking-wide text-sm font-semibold">
            <GitMerge className="h-4 w-4 text-accent" />
            Merge {first.type} usages
          </DialogTitle>
          <DialogDescription>
            Consolidate these diagram usages into one identity. The choices below are applied atomically.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          <section className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Surviving identity
            </Label>
            <RadioGroup
              value={survivorId}
              onValueChange={setSurvivorId}
              className="grid gap-2 sm:grid-cols-2"
              data-testid="merge-survivor-choice"
            >
              {[first, second].map((element, index) => (
                <label
                  key={element.id}
                  className="flex cursor-pointer items-start gap-3 rounded-sm border border-border bg-muted/20 p-3 hover:bg-muted/50"
                >
                  <RadioGroupItem value={element.id} className="mt-0.5" />
                  <span className="min-w-0">
                    <span className="block text-[10px] font-mono uppercase text-muted-foreground">
                      {index === 0 ? 'First usage' : 'Second usage'}
                    </span>
                    <span className="block truncate text-sm font-semibold">{element.name}</span>
                    <span className="block text-[10px] font-mono text-muted-foreground">{element.id}</span>
                  </span>
                </label>
              ))}
            </RadioGroup>
          </section>

          <div className="grid gap-4 border-y border-border py-4 md:grid-cols-2">
            <section className="space-y-2">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Name
              </Label>
              <RadioGroup value={nameSource} onValueChange={(value) => setNameSource(value as 'first' | 'second')}>
                {[
                  ['first', first.name],
                  ['second', second.name],
                ].map(([value, label]) => (
                  <label key={value} className="flex cursor-pointer items-center gap-2 text-sm">
                    <RadioGroupItem value={value} />
                    <span>{label}</span>
                  </label>
                ))}
              </RadioGroup>
            </section>
            <section className="space-y-2">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Description
              </Label>
              <RadioGroup
                value={descriptionSource}
                onValueChange={(value) => setDescriptionSource(value as 'first' | 'second')}
              >
                {[
                  ['first', first.description || 'No description'],
                  ['second', second.description || 'No description'],
                ].map(([value, label]) => (
                  <label key={value} className="flex cursor-pointer items-start gap-2 text-sm">
                    <RadioGroupItem value={value} className="mt-0.5" />
                    <span className="line-clamp-2">{label}</span>
                  </label>
                ))}
              </RadioGroup>
            </section>
          </div>

          <section className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Library definition binding
            </Label>
            <RadioGroup
              value={definitionSource}
              onValueChange={(value) => setDefinitionSource(value as 'first' | 'second' | 'none')}
              className="grid gap-2 sm:grid-cols-3"
            >
              {[
                ['first', `First · ${definitionLabel(first, model)}`],
                ['second', `Second · ${definitionLabel(second, model)}`],
                ['none', 'No definition · standalone'],
              ].map(([value, label]) => (
                <label key={value} className="flex cursor-pointer items-start gap-2 rounded-sm border border-border p-2 text-xs">
                  <RadioGroupItem value={value} className="mt-0.5" />
                  <span>{label}</span>
                </label>
              ))}
            </RadioGroup>
          </section>

          <section className="space-y-3">
            <div>
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Attributes
              </Label>
              <p className="mt-1 text-xs text-muted-foreground">
                Non-conflicting values are carried forward. Conflicting names require a choice.
              </p>
            </div>
            {conflictingAttributes.length === 0 ? (
              <div className="flex items-center gap-2 rounded-sm border border-dashed border-border p-3 text-xs text-muted-foreground">
                <Check className="h-3.5 w-3.5 text-accent" />
                No conflicting attributes.
              </div>
            ) : (
              conflictingAttributes.map((group) => {
                const key = group.name.toLocaleLowerCase();
                return (
                  <div key={key} className="rounded-sm border border-border bg-muted/20 p-3" data-testid={`merge-attribute-${key}`}>
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className="font-mono text-xs font-semibold">{group.name}</span>
                      <span className="text-[10px] uppercase tracking-wider text-destructive">Conflict</span>
                    </div>
                    <div className="mb-3 grid gap-2 text-xs sm:grid-cols-2">
                      <div>
                        <span className="mb-1 block text-[10px] uppercase text-muted-foreground">First</span>
                        {group.first.map((attribute) => <div key={attribute.id} className="font-mono">{attributeValue(attribute)}</div>)}
                      </div>
                      <div>
                        <span className="mb-1 block text-[10px] uppercase text-muted-foreground">Second</span>
                        {group.second.map((attribute) => <div key={attribute.id} className="font-mono">{attributeValue(attribute)}</div>)}
                      </div>
                    </div>
                    <RadioGroup
                      value={attributeSources[key] ?? 'first'}
                      onValueChange={(value) => setAttributeSources((current) => ({ ...current, [key]: value as 'first' | 'second' | 'both' }))}
                      className="grid gap-2 sm:grid-cols-3"
                    >
                      {[
                        ['first', 'Keep first'],
                        ['second', 'Keep second'],
                        ['both', 'Keep both'],
                      ].map(([value, label]) => (
                        <label key={value} className="flex cursor-pointer items-center gap-2 text-xs">
                          <RadioGroupItem value={value} />
                          <span>{label}</span>
                        </label>
                      ))}
                    </RadioGroup>
                  </div>
                );
              })
            )}
          </section>

          <section className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Connections after merge
            </Label>
            <div className="rounded-sm border border-border bg-muted/20 p-3 text-xs text-muted-foreground">
              <div className="flex items-center gap-2">
                <ArrowRight className="h-3.5 w-3.5 text-accent" />
                Existing connections will be retargeted to the survivor.
              </div>
              <div className="mt-2 flex items-center gap-2">
                <ArrowDown className="h-3.5 w-3.5 text-accent" />
                Duplicate semantic connections will keep the first connection’s metadata.
              </div>
            </div>
            {selfLoopRelationships.length > 0 && (
              <div className="rounded-sm border border-destructive/50 bg-destructive/5 p-3">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-destructive">
                      {selfLoopRelationships.length} connection{selfLoopRelationships.length === 1 ? '' : 's'} would become self-referential.
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Containment and composition self-loops are invalid. Choose whether to reject this merge or explicitly drop those connections.
                    </p>
                  </div>
                </div>
                <RadioGroup
                  value={selfLoopPolicy}
                  onValueChange={(value) => setSelfLoopPolicy(value as 'reject' | 'drop')}
                  className="mt-3 grid gap-2 sm:grid-cols-2"
                >
                  <label className="flex cursor-pointer items-center gap-2 text-xs">
                    <RadioGroupItem value="reject" />
                    <span>Reject merge</span>
                  </label>
                  <label className="flex cursor-pointer items-center gap-2 text-xs">
                    <RadioGroupItem value="drop" />
                    <span>Drop self-loops explicitly</span>
                  </label>
                </RadioGroup>
              </div>
            )}
          </section>
        </div>

        <DialogFooter>
          <Button variant="outline" className="rounded-sm" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isPending}
            className="gap-2 rounded-sm bg-primary text-primary-foreground"
            data-testid="button-confirm-merge"
          >
            <GitMerge className="h-3.5 w-3.5" />
            {isPending ? 'Merging…' : 'Confirm merge'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}