import React from 'react';
import { 
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import type { PprModel, PprRelationshipKind, RelationshipInput } from '@workspace/api-client-react';
import { ArrowRight } from 'lucide-react';
import { getSupportedRelationshipKinds } from '@/components/review/analysis-utils';

interface CreateRelationshipDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sourceId: string;
  targetId: string;
  model: PprModel;
  onCreateRelationship: (data: RelationshipInput) => void;
}

export function CreateRelationshipDialog({ 
  open, onOpenChange, sourceId, targetId, model, onCreateRelationship
}: CreateRelationshipDialogProps) {
  const [selectedKind, setSelectedKind] = React.useState<PprRelationshipKind | null>(null);
  const [modality, setModality] = React.useState<'assigned' | 'capable' | 'supports'>('assigned');

  const source = model.diagram.usages.find(e => e.id === sourceId);
  const target = model.diagram.usages.find(e => e.id === targetId);

  const supportedKinds = React.useMemo(() => {
    if (!source || !target) return [];
    return getSupportedRelationshipKinds(source.type, target.type);
  }, [source, target]);

  const existingKinds = React.useMemo(
    () =>
      new Set(
       model.diagram.relationships
          .filter((relationship) => relationship.source_id === sourceId && relationship.target_id === targetId)
          .map((relationship) => relationship.kind),
      ),
    [model.diagram.relationships, sourceId, targetId],
  );
  const allowedKinds = supportedKinds.filter((kind) => !existingKinds.has(kind));

  // Reset selection when options change
  React.useEffect(() => {
    if (open && allowedKinds.length > 0) {
      setSelectedKind(allowedKinds[0]);
      setModality('assigned');
    } else if (open) {
      setSelectedKind(null);
    }
  }, [open, allowedKinds.join('|')]);

  const handleSubmit = () => {
    if (!selectedKind) return;
    onCreateRelationship({
      source_id: sourceId,
      target_id: targetId,
      kind: selectedKind,
      ...(selectedKind === 'performs' ? { modality } : {}),
    });
    onOpenChange(false);
  };

  if (!source || !target) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px] rounded-sm" data-testid="create-relationship-dialog">
        <DialogHeader>
          <DialogTitle className="uppercase tracking-wide text-sm font-semibold">Create Relationship</DialogTitle>
          <DialogDescription>
            Define how these elements interact in the model.
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          <div className="flex items-center justify-between bg-muted/50 p-3 rounded-sm border border-border mb-6">
            <div className="flex flex-col items-center">
              <span className="text-[10px] font-mono uppercase text-muted-foreground">{source.type}</span>
              <span className="font-semibold text-sm truncate max-w-[120px]">{source.name}</span>
            </div>
            <ArrowRight className="w-4 h-4 text-muted-foreground" />
            <div className="flex flex-col items-center">
              <span className="text-[10px] font-mono uppercase text-muted-foreground">{target.type}</span>
              <span className="font-semibold text-sm truncate max-w-[120px]">{target.name}</span>
            </div>
          </div>

          <RadioGroup 
            value={selectedKind || ''} 
            onValueChange={(val) => setSelectedKind(val as PprRelationshipKind)}
            className="grid grid-cols-1 gap-2"
          >
            {allowedKinds.map((kind) => (
              <div key={kind} className="flex items-center space-x-2 border border-border p-3 rounded-sm hover:bg-muted/50 transition-colors cursor-pointer" onClick={() => setSelectedKind(kind)}>
                <RadioGroupItem value={kind} id={`kind-${kind}`} />
                <Label htmlFor={`kind-${kind}`} className="flex-1 cursor-pointer font-mono font-medium text-sm">
                  {kind}
                </Label>
              </div>
            ))}
          </RadioGroup>
          {selectedKind === 'performs' && (
            <div className="mt-4 space-y-1.5">
              <Label htmlFor="relationship-modality" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Modality</Label>
              <select
                id="relationship-modality"
                aria-label="modality"
                value={modality}
                onChange={(event) => setModality(event.target.value as typeof modality)}
                className="h-9 w-full rounded-sm border border-border bg-background px-2 text-sm"
              >
                <option value="assigned">Assigned</option>
                <option value="capable">Capable</option>
                <option value="supports">Supports</option>
              </select>
            </div>
          )}
          
          {allowedKinds.length === 0 && (
            <p className="text-sm text-destructive text-center py-4">
              {supportedKinds.length === 0
                ? `No valid relationships between ${source.type} and ${target.type}.`
                : 'All supported relationships between these elements already exist.'}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" className="rounded-sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={!selectedKind} className="rounded-sm bg-primary text-primary-foreground">
            Create Connection
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
