import { useMemo, useState } from 'react';
import type { PprModel } from '@workspace/api-client-react';
import {
  ArrowLeft,
  Check,
  Clock3,
  Eye,
  FileClock,
  GitCommitHorizontal,
  History,
  Loader2,
  RotateCcw,
  TriangleAlert,
} from 'lucide-react';
import { toast } from 'sonner';
import { useRevisionHistory, type ModelRevision } from '@/hooks/use-revision-history';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

const REVISION_HISTORY_RETENTION_LIMIT = 50;

interface RevisionHistoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentModel?: PprModel;
  onRestored?: (model: PprModel) => void;
}

function revisionNumber(revision: ModelRevision) {
  return revision.revision;
}

function revisionLabel(revision: ModelRevision) {
  return revision.summary.trim() || `Model revision ${revisionNumber(revision)}`;
}

function formatRevisionDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Date unavailable';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function initials(value?: string | null) {
  if (!value) return 'TE';
  return value
    .split(/\s+/)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

export function RevisionHistoryDialog({ open, onOpenChange, currentModel, onRestored }: RevisionHistoryDialogProps) {
  const [selectedRevisionId, setSelectedRevisionId] = useState<string | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<ModelRevision | null>(null);
  const history = useRevisionHistory(selectedRevisionId, open);

  const selectedSummary = useMemo(() => {
    if (!history.selectedRevision) return null;
    const model = history.selectedRevision.model;
    return {
      elements: model?.diagram.usages.length ?? history.selectedRevision.element_count ?? 0,
      relationships: model?.diagram.relationships.length ?? history.selectedRevision.relationship_count ?? 0,
      name: model?.name ?? history.selectedRevision.model_name ?? currentModel?.name ?? 'Unnamed model',
    };
  }, [currentModel?.name, history.selectedRevision]);

  const closeDialog = (nextOpen: boolean) => {
    if (!nextOpen) {
      setSelectedRevisionId(null);
      setRestoreTarget(null);
    }
    onOpenChange(nextOpen);
  };

  const handleRestore = () => {
    if (!restoreTarget) return;
    history.restore(
      restoreTarget.id,
      (restoredModel) => {
        onRestored?.(restoredModel);
        toast.success('Revision restored', {
          description: `Revision ${revisionNumber(restoreTarget)} is now the active model.`,
        });
        setRestoreTarget(null);
        setSelectedRevisionId(null);
        onOpenChange(false);
      },
      () => toast.error('Could not restore revision', {
        description: 'The current model was kept unchanged. Try again.',
      }),
    );
  };

  return (
    <>
      <Dialog open={open} onOpenChange={closeDialog}>
        <DialogContent
          data-testid="dialog-revision-history"
          className="max-w-4xl gap-0 overflow-hidden border-primary/20 bg-background p-0"
        >
          <DialogHeader className="border-b border-border bg-card px-5 py-4 pr-12">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center border border-accent/30 bg-accent/10 text-accent">
                <History className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <div className="aml-kicker">Model provenance</div>
                <DialogTitle className="mt-1 font-display text-2xl uppercase tracking-tight">
                  Revision history
                </DialogTitle>
                <DialogDescription className="mt-1 max-w-2xl text-xs">
                  Inspect a saved model state before making it active. Restoring creates a new current state; the {REVISION_HISTORY_RETENTION_LIMIT} most recent states are retained.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          {selectedRevisionId ? (
            <RevisionDetail
              revision={history.selectedRevision}
              isLoading={history.isDetailLoading}
              error={history.detailError}
              selectedSummary={selectedSummary}
              currentModel={currentModel}
              isRestoring={history.isRestoring}
              onBack={() => setSelectedRevisionId(null)}
              onRestore={(revision) => setRestoreTarget(revision)}
              onRetry={() => void history.refetch()}
            />
          ) : (
            <RevisionList
              revisions={history.revisions}
              isLoading={history.isLoading}
              isError={history.isError}
              onInspect={(revision) => setSelectedRevisionId(revision.id)}
              onRetry={() => void history.refetch()}
            />
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(restoreTarget)} onOpenChange={(nextOpen) => !nextOpen && setRestoreTarget(null)}>
        <AlertDialogContent data-testid="alert-dialog-restore-revision">
          <AlertDialogHeader>
            <div className="mb-1 flex h-9 w-9 items-center justify-center border border-accent/30 bg-accent/10 text-accent">
              <RotateCcw className="h-4 w-4" />
            </div>
            <AlertDialogTitle>Restore revision {restoreTarget ? revisionNumber(restoreTarget) : ''}?</AlertDialogTitle>
            <AlertDialogDescription>
              The selected snapshot will replace the active model. Your current model will remain available as a separate revision.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={history.isRestoring}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              data-testid="button-confirm-restore-revision"
              disabled={history.isRestoring}
              onClick={(event) => {
                event.preventDefault();
                handleRestore();
              }}
              className="gap-2 bg-accent text-accent-foreground hover:bg-accent/90"
            >
              {history.isRestoring && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Restore revision
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function RevisionList({
  revisions,
  isLoading,
  isError,
  onInspect,
  onRetry,
}: {
  revisions: ModelRevision[];
  isLoading: boolean;
  isError: boolean;
  onInspect: (revision: ModelRevision) => void;
  onRetry: () => void;
}) {
  const oldestRetainedRevision = revisions[revisions.length - 1];
  const hasPrunedRevisions = Boolean(oldestRetainedRevision && oldestRetainedRevision.revision > 0);

  return (
    <div className="grid min-h-[25rem] grid-cols-1 md:grid-cols-[minmax(0,1fr)_15rem]">
      <section className="min-w-0 px-5 py-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <p className="aml-kicker">Saved states</p>
            <p className="mt-1 text-xs text-muted-foreground">Newest first · inspect before restore</p>
          </div>
          <Badge variant="outline" className="rounded-sm border-border font-mono text-[10px] uppercase tracking-wider">
            {isLoading ? 'Loading' : `${revisions.length} ${revisions.length === 1 ? 'revision' : 'revisions'}`}
          </Badge>
        </div>

        {isLoading ? (
          <div className="space-y-2" data-testid="revision-history-loading">
            {[1, 2, 3].map((item) => (
              <div key={item} className="flex animate-pulse items-center gap-3 border border-border/70 px-3 py-3">
                <div className="h-8 w-8 bg-muted" />
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="h-3 w-2/5 bg-muted" />
                  <div className="h-2.5 w-3/5 bg-muted" />
                </div>
              </div>
            ))}
          </div>
        ) : isError ? (
          <div className="border border-destructive/30 bg-destructive/5 p-5" data-testid="revision-history-error">
            <TriangleAlert className="h-4 w-4 text-destructive" />
            <p className="mt-2 text-sm font-semibold">History could not be loaded</p>
            <p className="mt-1 text-xs text-muted-foreground">The active model is safe. Retry the history request.</p>
            <Button variant="outline" size="sm" onClick={onRetry} className="mt-4 rounded-sm">
              Retry
            </Button>
          </div>
        ) : revisions.length === 0 ? (
          <div className="flex min-h-[15rem] flex-col items-center justify-center border border-dashed border-border bg-muted/20 px-6 text-center" data-testid="revision-history-empty">
            <FileClock className="h-7 w-7 text-muted-foreground/50" />
            <p className="mt-3 text-sm font-semibold">No saved revisions yet</p>
            <p className="mt-1 max-w-xs text-xs leading-relaxed text-muted-foreground">
              Revisions will appear here after the model is saved through the workspace.
            </p>
          </div>
        ) : (
          <>
            {hasPrunedRevisions && (
              <div
                className="mb-3 flex items-start gap-2 border border-accent/30 bg-accent/5 px-3 py-3 text-xs"
                data-testid="revision-history-retention-notice"
                role="status"
              >
                <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
                <div>
                  <p className="font-semibold">Showing the {REVISION_HISTORY_RETENTION_LIMIT} most recent revisions.</p>
                  <p className="mt-1 leading-relaxed text-muted-foreground">
                    Older revisions are no longer available because history is retained to a fixed limit.
                  </p>
                </div>
              </div>
            )}
            <div className="relative space-y-2" data-testid="revision-history-list">
              <div className="absolute bottom-5 left-[1.15rem] top-5 w-px bg-border" aria-hidden="true" />
              {revisions.map((revision) => (
                <RevisionRow key={revision.id} revision={revision} onInspect={onInspect} />
              ))}
            </div>
          </>
        )}
      </section>

      <aside className="border-t border-border bg-muted/25 px-5 py-4 md:border-l md:border-t-0">
        <p className="aml-kicker">Safe restore</p>
        <div className="mt-3 border-l-2 border-accent/50 pl-3">
          <p className="text-sm font-semibold leading-snug">Review first. Restore second.</p>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            Opening a revision loads its snapshot details only. The workspace changes after you confirm restore.
          </p>
        </div>
        <div className="mt-6 space-y-3 border-t border-border pt-4 text-xs text-muted-foreground">
          <div className="flex items-start gap-2">
            <Eye className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
            <span>Inspect model name, counts, and saved timestamp.</span>
          </div>
          <div className="flex items-start gap-2">
            <RotateCcw className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
            <span>Restore adds a new timeline entry; the oldest entry may be pruned at the retention limit.</span>
          </div>
        </div>
      </aside>
    </div>
  );
}

function RevisionRow({
  revision,
  onInspect,
}: {
  revision: ModelRevision;
  onInspect: (revision: ModelRevision) => void;
}) {
  const isCurrent = revision.is_current;
  return (
    <div
      className={cn(
        'relative flex items-center gap-3 border border-border/80 bg-card px-3 py-3 transition-colors hover:border-primary/40 hover:bg-card',
        isCurrent && 'border-accent/40',
      )}
      data-testid={`revision-row-${revision.id}`}
    >
      <div className={cn(
        'relative z-[1] flex h-8 w-8 shrink-0 items-center justify-center border bg-background font-mono text-[10px] font-semibold',
        isCurrent ? 'border-accent text-accent' : 'border-border text-muted-foreground',
      )}>
        {isCurrent ? <Check className="h-3.5 w-3.5" /> : `r${revisionNumber(revision)}`}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate text-sm font-semibold">{revisionLabel(revision)}</p>
          {isCurrent && (
            <Badge className="rounded-sm bg-accent/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-accent hover:bg-accent/10">
              Current
            </Badge>
          )}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Clock3 className="h-3 w-3" /> {formatRevisionDate(revision.created_at)}
          </span>
          {revision.created_by && <span className="font-mono uppercase tracking-wide">{initials(revision.created_by)} · {revision.created_by}</span>}
        </div>
      </div>
      <Button
        variant="outline"
        size="sm"
        className="h-8 shrink-0 gap-1.5 rounded-sm px-2.5 text-xs"
        data-testid={`button-inspect-revision-${revision.id}`}
        onClick={() => onInspect(revision)}
      >
        <Eye className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Inspect</span>
      </Button>
    </div>
  );
}

function RevisionDetail({
  revision,
  isLoading,
  error,
  selectedSummary,
  currentModel,
  isRestoring,
  onBack,
  onRestore,
  onRetry,
}: {
  revision: ModelRevision | null;
  isLoading: boolean;
  error?: unknown;
  selectedSummary: { elements: number; relationships: number; name: string } | null;
  currentModel?: PprModel;
  isRestoring: boolean;
  onBack: () => void;
  onRestore: (revision: ModelRevision) => void;
  onRetry: () => void;
}) {
  if (isLoading) {
    return (
      <div className="min-h-[25rem] space-y-5 p-5" data-testid="revision-detail-loading">
        <div className="h-4 w-24 animate-pulse bg-muted" />
        <div className="h-8 w-3/5 animate-pulse bg-muted" />
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="h-20 animate-pulse bg-muted" />
          <div className="h-20 animate-pulse bg-muted" />
          <div className="h-20 animate-pulse bg-muted" />
        </div>
      </div>
    );
  }

  if (error || !revision) {
    return (
      <div className="min-h-[25rem] p-5" data-testid="revision-detail-error">
        <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2 gap-2 rounded-sm">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to history
        </Button>
        <div className="mt-12 border border-destructive/30 bg-destructive/5 p-5">
          <TriangleAlert className="h-4 w-4 text-destructive" />
          <p className="mt-2 text-sm font-semibold">Snapshot details unavailable</p>
          <p className="mt-1 text-xs text-muted-foreground">Retry the request without changing the active model.</p>
          <Button variant="outline" size="sm" onClick={onRetry} className="mt-4 rounded-sm">Retry</Button>
        </div>
      </div>
    );
  }

  const isCurrent = revision.is_current;
  const currentElements = currentModel?.diagram.usages.length ?? 0;
  const currentRelationships = currentModel?.diagram.relationships.length ?? 0;
  return (
    <div className="min-h-[25rem]" data-testid="revision-detail">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
        <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2 gap-2 rounded-sm text-xs">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to history
        </Button>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="rounded-sm font-mono text-[10px] uppercase tracking-wider">
            Revision {revisionNumber(revision)}
          </Badge>
          {isCurrent && <Badge className="rounded-sm bg-accent/10 font-mono text-[10px] uppercase tracking-wider text-accent hover:bg-accent/10">Current</Badge>}
        </div>
      </div>
      <div className="grid gap-6 p-5 md:grid-cols-[minmax(0,1fr)_15rem]">
        <section>
          <div className="aml-kicker">Snapshot inspection</div>
          <h3 className="mt-1 font-display text-3xl uppercase tracking-tight">{revisionLabel(revision)}</h3>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1"><Clock3 className="h-3 w-3" /> {formatRevisionDate(revision.created_at)}</span>
            {revision.created_by && <span>Saved by {revision.created_by}</span>}
          </div>
          <div className="mt-6 grid gap-2 sm:grid-cols-3">
            <Stat label="Model" value={selectedSummary?.name ?? 'Unavailable'} />
            <Stat label="Usages" value={String(selectedSummary?.elements ?? 0)} />
            <Stat label="Relationships" value={String(selectedSummary?.relationships ?? 0)} />
          </div>
          <div className="mt-6 border-t border-border pt-4">
            <p className="aml-kicker">What restore changes</p>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              The workspace will reopen this saved state with {selectedSummary?.elements ?? 0} usages and {selectedSummary?.relationships ?? 0} relationships. Your current state has {currentElements} usages and {currentRelationships} relationships.
            </p>
          </div>
        </section>
        <aside className="border-t border-border pt-4 md:border-l md:border-t-0 md:pl-5 md:pt-0">
          <p className="aml-kicker">Revision actions</p>
          <Button
            variant="outline"
            className="mt-3 w-full gap-2 rounded-sm border-accent/40 text-accent hover:bg-accent/10 hover:text-accent"
            disabled={isCurrent || isRestoring}
            data-testid={`button-restore-revision-${revision.id}`}
            onClick={() => onRestore(revision)}
          >
            {isRestoring ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
            {isCurrent ? 'Already current' : 'Restore this revision'}
          </Button>
          <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
            Restore is reversible through this history. The current snapshot remains recorded.
          </p>
          <div className="mt-6 border-t border-border pt-4">
            <div className="flex items-center gap-2 text-xs font-semibold">
              <GitCommitHorizontal className="h-3.5 w-3.5 text-accent" />
              Immutable snapshot
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              This inspection is read-only until you confirm the restore action.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 border border-border bg-muted/25 px-3 py-3">
      <p className="aml-kicker truncate">{label}</p>
      <p className="mt-1 truncate text-sm font-semibold" title={value}>{value}</p>
    </div>
  );
}