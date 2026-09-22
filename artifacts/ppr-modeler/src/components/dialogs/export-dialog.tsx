import React, { useEffect, useState } from 'react';
import { 
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { getExportModelQueryKey, useExportModel } from '@workspace/api-client-react';
import { Download, Loader2 } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { PprModel } from '@workspace/api-client-react';
import {
  getProcessSpecificationFilename,
  getProcessSpecificationSvg,
} from '../review/process-specification-export';

export type ExportFormat = 'json' | 'sysml' | 'sysml-ppr' | 'automationml';

interface ExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  model?: PprModel;
  mode?: 'model' | 'process-specification';
  initialFormat?: ExportFormat;
}

function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function ExportDialog({
  open,
  onOpenChange,
  model,
  mode = 'model',
  initialFormat = 'automationml',
}: ExportDialogProps) {
  const [format, setFormat] = useState<ExportFormat>(initialFormat);
  const isProcessSpecification = mode === 'process-specification';

  useEffect(() => {
    if (open) setFormat(initialFormat);
  }, [initialFormat, open]);
  
  const { data, isLoading } = useExportModel(format, {
    query: {
      enabled: open && !isProcessSpecification,
      queryKey: getExportModelQueryKey(format),
    }
  });

  const handleDownload = () => {
    if (isProcessSpecification) {
      if (!model) return;
      downloadFile(getProcessSpecificationSvg(model), getProcessSpecificationFilename(model), 'image/svg+xml');
      return;
    }
    if (!data) return;
    const content = typeof data === 'string' ? data : JSON.stringify(data.content, null, 2);
    const filename = typeof data === 'object' && 'filename' in data ? data.filename : `export.${format}`;
    downloadFile(content, filename, 'text/plain');
  };

  const contentPreview = React.useMemo(() => {
    if (isProcessSpecification) return model ? getProcessSpecificationSvg(model) : '';
    if (!data) return '';
    if (typeof data === 'string') return data;
    return typeof data.content === 'string' ? data.content : JSON.stringify(data.content, null, 2);
  }, [data, isProcessSpecification, model]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid={isProcessSpecification ? 'process-specification-export' : 'model-export'}
        className="sm:max-w-[980px] rounded-sm flex flex-col h-[80vh]"
      >
        <DialogHeader className="shrink-0">
          <DialogTitle className="uppercase tracking-wide text-sm font-semibold">
            {isProcessSpecification ? 'Export Process Specification' : 'Export Model'}
          </DialogTitle>
          <DialogDescription>
            {isProcessSpecification
              ? 'Preview and download a deterministic engineering drawing of the current production flow.'
              : 'Preview the engineering model and download an AutomationML-oriented exchange file or another supported representation.'}
          </DialogDescription>
        </DialogHeader>

        {isProcessSpecification ? (
          <div className="flex-1 min-h-0 mt-4 border border-border rounded-sm bg-muted/30 relative">
            {model ? (
              <ScrollArea className="h-full">
                <div
                  data-testid="process-specification-svg-preview"
                  className="min-w-[760px] bg-white p-4 [&>svg]:h-auto [&>svg]:w-full"
                  dangerouslySetInnerHTML={{ __html: contentPreview }}
                />
              </ScrollArea>
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-xs font-mono text-muted-foreground">
                No model is loaded.
              </div>
            )}
          </div>
        ) : (
          <Tabs value={format} onValueChange={(v) => setFormat(v as ExportFormat)} className="flex-1 flex flex-col min-h-0">
            <TabsList className="grid w-full grid-cols-2 rounded-sm sm:grid-cols-4">
              <TabsTrigger value="automationml" className="rounded-sm font-mono text-xs">AutomationML</TabsTrigger>
              <TabsTrigger value="sysml-ppr" className="rounded-sm font-mono text-xs">PPR / SysML v2</TabsTrigger>
              <TabsTrigger value="sysml" className="rounded-sm font-mono text-xs">Portable SysML v2</TabsTrigger>
              <TabsTrigger value="json" className="rounded-sm font-mono text-xs">JSON</TabsTrigger>
            </TabsList>

            <div className="flex-1 min-h-0 mt-4 border border-border rounded-sm bg-muted/30 relative">
              {isLoading ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <Loader2 className="w-8 h-8 animate-spin text-muted-foreground mb-4" />
                  <p className="text-xs font-mono text-muted-foreground">Generating {format}...</p>
                </div>
              ) : (
                <ScrollArea className="h-full">
                  <pre className="p-4 text-xs font-mono text-foreground whitespace-pre-wrap break-all">
                    {contentPreview}
                  </pre>
                </ScrollArea>
              )}
            </div>
          </Tabs>
        )}

        <div className="shrink-0 pt-4 flex justify-end">
            <Button
            onClick={handleDownload}
            disabled={isProcessSpecification ? !model : isLoading || !data}
            className="rounded-sm gap-2"
            data-testid={isProcessSpecification ? 'button-download-process-specification' : 'button-download-model'}
            >
              <Download className="w-4 h-4" /> {isProcessSpecification ? 'Download SVG' : format === 'automationml' ? 'Download AutomationML' : 'Download File'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
