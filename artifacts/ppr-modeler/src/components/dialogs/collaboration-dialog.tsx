import { useEffect, useState } from 'react';
import { Check, Copy, Link2, Radio, Users } from 'lucide-react';
import { toast } from 'sonner';
import { COLLABORATION_SURFACE_LABELS, type CollaborationController } from '@/hooks/use-collaboration';
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

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  collaboration: CollaborationController;
  onStartModeling: () => void;
};

export function CollaborationDialog({ open, onOpenChange, collaboration, onStartModeling }: Props) {
  const inviteFromUrl = new URLSearchParams(window.location.search);
  const [mode, setMode] = useState<'create' | 'join'>(inviteFromUrl.has('session') ? 'join' : 'create');
  const [displayName, setDisplayName] = useState(sessionStorage.getItem('ppr-collaboration-name') || '');
  const [sessionId, setSessionId] = useState(inviteFromUrl.get('session') || '');
  const [code, setCode] = useState(inviteFromUrl.get('code') || '');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<'link' | 'code' | null>(null);

  useEffect(() => {
    if (inviteFromUrl.has('session') && !collaboration.session) onOpenChange(true);
  }, []);

  const run = async () => {
    const name = displayName.trim();
    if (!name) {
      toast.error('Enter your display name');
      return;
    }
    setBusy(true);
    sessionStorage.setItem('ppr-collaboration-name', name);
    try {
      if (mode === 'create') await collaboration.create(name);
      else await collaboration.join(sessionId.trim(), code.trim(), name);
      toast.success(mode === 'create' ? 'Collaboration session opened' : 'Joined collaboration session');
    } catch (error) {
      toast.error(mode === 'create' ? 'Could not create the session' : 'Could not join the session', {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setBusy(false);
    }
  };

  const copy = async (value: string, target: 'link' | 'code') => {
    await navigator.clipboard.writeText(value);
    setCopied(target);
    setTimeout(() => setCopied(null), 1500);
  };

  const leave = async (closeForEveryone: boolean) => {
    setBusy(true);
    try {
      await collaboration.leave(closeForEveryone);
      onOpenChange(false);
      toast.success(closeForEveryone ? 'Collaboration session closed' : 'Left collaboration session');
    } catch (error) {
      toast.error('Could not close the collaboration session', {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-sm sm:max-w-[520px]" data-testid="collaboration-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide">
            <Users className="h-4 w-4 text-primary" /> Live collaboration
          </DialogTitle>
          <DialogDescription>
            {collaboration.session
              ? 'Share this temporary session with the people who should edit the model.'
              : 'Open a temporary modeling session or join one using its link or access code.'}
          </DialogDescription>
          <div className="mt-2 border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground" data-testid="collaboration-identity">
            {collaboration.identity
              ? `Authenticated browser identity: ${collaboration.identity.display_name}`
              : 'Establishing an authenticated browser identity…'}
          </div>
        </DialogHeader>

        {collaboration.session && collaboration.invite ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between border border-border bg-muted/30 p-3">
              <div>
                <div className="aml-kicker">Connection</div>
                <div className="mt-1 flex items-center gap-2 text-sm font-medium">
                  <Radio className={`h-3.5 w-3.5 ${collaboration.status === 'connected' ? 'text-emerald-500' : 'text-amber-500'}`} />
                   {collaboration.status === 'connected'
                    ? 'Live'
                    : collaboration.status === 'connecting'
                      ? 'Connecting…'
                       : collaboration.status === 'error'
                         ? 'Authorization required'
                         : 'Reconnecting…'}
                </div>
              </div>
              <div className="text-right">
                <div className="aml-kicker">People online</div>
                <div className="mt-1 font-mono text-sm">{collaboration.participants.length}</div>
              </div>
            </div>

            {collaboration.error && (
              <div role="alert" className="border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive" data-testid="collaboration-error">
                {collaboration.error}
              </div>
            )}

            <div className="space-y-2">
              <Label>Invitation link</Label>
              <div className="flex gap-2">
                <Input readOnly value={collaboration.invite.url} className="font-mono text-xs" />
                <Button variant="outline" size="icon" onClick={() => void copy(collaboration.invite!.url, 'link')} aria-label="Copy invitation link">
                  {copied === 'link' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Session ID</Label>
                <Input
                  readOnly
                  value={collaboration.invite.sessionId}
                  className="font-mono"
                  data-testid="collaboration-session-id"
                />
              </div>
              <div className="space-y-2">
                <Label>Access code</Label>
                <div className="flex gap-2">
                  <Input
                    readOnly
                    value={collaboration.invite.code}
                    className="font-mono tracking-[0.25em]"
                    data-testid="collaboration-access-code"
                  />
                  <Button variant="outline" size="icon" onClick={() => void copy(collaboration.invite!.code, 'code')} aria-label="Copy access code">
                    {copied === 'code' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
            </div>

            {collaboration.participants.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {collaboration.participants.map((participant) => (
                  <div
                    key={participant.id}
                    data-testid={`collaboration-participant-${participant.id}`}
                    className="flex items-center gap-2 border border-border bg-card px-2 py-1 font-mono text-xs"
                  >
                    <span
                      aria-label={`${participant.name}'s selection color`}
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: participant.color }}
                    />
                    <span>{participant.name}</span>
                    <span
                      data-testid={`collaboration-participant-surface-${participant.id}`}
                      className="border border-primary/20 bg-primary/5 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground"
                    >
                      {participant.surface ? COLLABORATION_SURFACE_LABELS[participant.surface] : 'Surface not shared'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 border border-border p-0.5">
              <Button variant={mode === 'create' ? 'default' : 'ghost'} size="sm" onClick={() => setMode('create')}>Create session</Button>
              <Button variant={mode === 'join' ? 'default' : 'ghost'} size="sm" onClick={() => setMode('join')}>Join session</Button>
            </div>
            <div className="space-y-2">
              <Label htmlFor="collaboration-name">Your display name</Label>
              <Input id="collaboration-name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Alex" maxLength={80} />
            </div>
            {mode === 'join' && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="collaboration-session">Session ID</Label>
                  <Input id="collaboration-session" value={sessionId} onChange={(event) => setSessionId(event.target.value)} className="font-mono" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="collaboration-code">Access code</Label>
                  <Input id="collaboration-code" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} className="font-mono tracking-[0.25em]" inputMode="numeric" />
                </div>
              </div>
            )}
          </div>
        )}

        <DialogFooter className="gap-2 sm:justify-between">
          {collaboration.session ? (
            <>
              <Button variant="outline" disabled={busy} onClick={() => void leave(false)}>Leave</Button>
              <div className="flex gap-2">
                {collaboration.session.role === 'owner' && (
                  <Button variant="destructive" disabled={busy} onClick={() => void leave(true)}>Close for everyone</Button>
                )}
                <Button
                  data-testid="button-start-modeling"
                  disabled={busy}
                  onClick={() => {
                    onOpenChange(false);
                    onStartModeling();
                  }}
                >
                   {collaboration.session.role === 'owner' ? 'Start modeling' : 'Join modeling'}
                </Button>
              </div>
            </>
          ) : (
            <Button data-testid="button-collaboration-submit" className="ml-auto gap-2" disabled={busy || !displayName.trim() || (mode === 'join' && (!sessionId.trim() || code.length !== 6))} onClick={() => void run()}>
              <Link2 className="h-4 w-4" /> {mode === 'create' ? 'Open session' : 'Join session'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
