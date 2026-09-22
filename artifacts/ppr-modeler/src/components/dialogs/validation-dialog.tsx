import React from 'react';
import { 
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription
} from '@/components/ui/dialog';
import type { ValidationResult } from '@workspace/api-client-react';
import { CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';

interface ValidationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  result: ValidationResult | undefined;
}

export function ValidationDialog({ open, onOpenChange, result }: ValidationDialogProps) {
  if (!result) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] rounded-sm max-h-[80vh] flex flex-col">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2 uppercase tracking-wide text-sm font-semibold">
            {result.valid ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-500" />
            ) : (
              <XCircle className="w-5 h-5 text-destructive" />
            )}
            Model Validation
          </DialogTitle>
          <DialogDescription>
            {result.valid
              ? "The model passes all structural and domain rules. It is ready for review before export."
              : "Resolve these structural or domain rule violations before exporting the model."}
          </DialogDescription>
        </DialogHeader>

        {result.issues.length > 0 ? (
          <ScrollArea className="flex-1 mt-4 border border-border rounded-sm">
            <div className="divide-y divide-border">
              {result.issues.map((issue, idx) => (
                <div key={idx} className="p-4 flex gap-3 bg-muted/20">
                  {issue.severity === 'error' ? (
                    <XCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                  )}
                  <div className="flex-1 space-y-1">
                    <p className="text-sm font-medium leading-snug">{issue.message}</p>
                    {(issue.element_id || issue.relationship_id) && (
                      <p className="text-xs font-mono text-muted-foreground">
                        {issue.element_id && `Element: ${issue.element_id.substring(0,8)}... `}
                        {issue.relationship_id && `Relationship: ${issue.relationship_id.substring(0,8)}...`}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        ) : (
          <div className="flex-1 flex items-center justify-center py-12 text-muted-foreground">
            <p className="text-sm">No issues found.</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}