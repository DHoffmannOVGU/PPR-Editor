import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Save, Play, FileDown, RefreshCw, FileWarning, FileUp, Network, ListTree, Boxes, Users, MoreHorizontal, FlaskConical, BookOpen, History, AlertCircle, RotateCw, FolderArchive, Upload, Download
} from 'lucide-react';
import type { ElementInput, MergeUsagesRequest, PprElement, PprModel } from '@workspace/api-client-react';
import type { Viewport } from '@xyflow/react';
import { Button } from '@/components/ui/button';
import { ElementsPalette } from '../inspector/elements-palette';
import { ValidationDialog } from '../dialogs/validation-dialog';
import { MergeUsagesDialog } from '../dialogs/merge-usages-dialog';
import { CreateRelationshipDialog } from '../dialogs/create-relationship-dialog';
import { CollaborationDialog } from '../dialogs/collaboration-dialog';
import { ExportDialog, type ExportFormat } from '../dialogs/export-dialog';
import { getMutationErrorDetail, useWorkspace } from '@/hooks/use-workspace';
import { useCollaboration, type CollaborationSurface } from '@/hooks/use-collaboration';
import { PprCanvas } from '../canvas/ppr-canvas';
import { getAnalysisContext } from '../review/analysis-utils';
import {
  getPprCanvasLayoutKey,
  type PprCanvasLayouts,
  type PprCanvasLayoutPositions,
  type PprCanvasPerspective,
  type PprProductViewMode,
  type PprResourceViewMode,
} from '../canvas/ppr-perspective';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';
import { WorkspaceInspector } from './workspace-inspector';
import { LibraryView } from '../library/library-view';
import { ItemLifecycleView } from '../items/item-lifecycle-view';
import { RevisionHistoryDialog } from '../dialogs/revision-history-dialog';
import { clonePprScenarioModel, getLoadablePprScenarios } from '../../testing/ppr-scenarios';
import {
  createPprProjectFile,
  getPprProjectFilename,
  getProjectModel,
  getSavedProjectLayouts,
  getSavedProjectViewports,
  isPprProjectFile,
  parsePprProjectFile,
  type PprProjectFile,
} from '@/lib/project-file';

type WorkspaceSurface = CollaborationSurface;

const DEVELOPMENT_SCENARIOS = getLoadablePprScenarios();

function downloadJsonFile(value: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

function WorkspaceErrorState({ detail, onRetry }: { detail: string; onRetry: () => void }) {
  return (
    <div
      data-testid="workspace-error-state"
      className="flex h-full min-h-[18rem] w-full flex-col items-center justify-center bg-background px-6 text-center"
    >
      <AlertCircle className="mb-4 h-8 w-8 text-destructive" aria-hidden="true" />
      <div className="aml-kicker text-destructive">Workspace unavailable</div>
      <h2 className="mt-1 font-display text-xl uppercase tracking-wide text-foreground">Could not load the model</h2>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">{detail}</p>
      <Button className="mt-5 gap-2 rounded-sm" variant="outline" onClick={onRetry} data-testid="button-retry-model">
        <RotateCw className="h-3.5 w-3.5" /> Try again
      </Button>
    </div>
  );
}

export function WorkspaceLayout() {
  const ws = useWorkspace();
  const collaboration = useCollaboration(ws.model);
  
  const [selectedElementIds, setSelectedElementIds] = useState<Set<string>>(new Set());
  const [selectedRelationshipIds, setSelectedRelationshipIds] = useState<Set<string>>(new Set());
  
  const [validationOpen, setValidationOpen] = useState(false);
  const [collaborationOpen, setCollaborationOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportMode, setExportMode] = useState<'model' | 'process-specification'>('model');
  const [exportFormat, setExportFormat] = useState<ExportFormat>('automationml');
  const [revisionHistoryOpen, setRevisionHistoryOpen] = useState(false);
  const [surface, setSurface] = useState<WorkspaceSurface>('graph');
  const [productViewMode, setProductViewMode] = useState<PprProductViewMode>('ppr');
  const [resourceViewMode, setResourceViewMode] = useState<PprResourceViewMode>('contains');
  const [pprLevel, setPprLevel] = useState(0);
  const [collapseItemStates, setCollapseItemStates] = useState(false);
  const [libraryTypeFilter, setLibraryTypeFilter] = useState<PprElement['type'] | null>(null);
  const [modelNameDraft, setModelNameDraft] = useState('');
  const [mergePair, setMergePair] = useState<{ firstId: string; secondId: string } | null>(null);
  const [relationshipPair, setRelationshipPair] = useState<{ sourceId: string; targetId: string } | null>(null);
  const [importingFormat, setImportingFormat] = useState<'json' | 'sysml' | 'automationml' | null>(null);
  const [flowViewports, setFlowViewports] = useState<Partial<Record<PprCanvasPerspective, Viewport>>>({});
  const [flowLayouts, setFlowLayouts] = useState<PprCanvasLayouts>({});
  const importInputRef = useRef<HTMLInputElement>(null);
  const projectInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setModelNameDraft(ws.model?.name ?? '');
  }, [ws.model?.id, ws.model?.name]);

  useEffect(() => {
    collaboration.updateSurface(surface);
  }, [collaboration.updateSurface, surface]);

  const handleCreateElement = useCallback((data: ElementInput, onSuccess?: (element: PprElement) => void) => {
    ws.createElement(data, (element) => {
      setSelectedElementIds(new Set([element.id]));
      setSelectedRelationshipIds(new Set());
      onSuccess?.(element);
    });
  }, [ws.createElement]);

  const handleRequestMerge = useCallback((firstId: string, secondId: string) => {
    if (firstId === secondId) return;
    setMergePair({ firstId, secondId });
  }, []);

  const handleRequestRelationship = useCallback((sourceId: string, targetId: string) => {
    if (sourceId === targetId || !ws.model) return;
    const source = ws.model.diagram.usages.find((element) => element.id === sourceId);
    const target = ws.model.diagram.usages.find((element) => element.id === targetId);
    if (!source || !target || source.type !== target.type) return;
    setRelationshipPair({ sourceId, targetId });
  }, [ws.model]);

  const handleMerge = useCallback((request: MergeUsagesRequest) => {
    ws.mergeUsages(request, (mergedModel) => {
      setMergePair(null);
      setSelectedElementIds(new Set([request.survivor_id]));
      setSelectedRelationshipIds(new Set());
      toast.success('Usages merged', {
        description: `${mergedModel.diagram.usages.find((element) => element.id === request.survivor_id)?.name ?? 'The survivor'} is now selected.`,
      });
    });
  }, [ws.mergeUsages]);

  const selectElements = (ids: Set<string>) => {
    setSelectedElementIds((current) => {
      if (current.size === ids.size && [...current].every((id) => ids.has(id))) return current;
      return ids;
    });
  };

  const selectRelationships = (ids: Set<string>) => {
    setSelectedRelationshipIds((current) => {
      if (current.size === ids.size && [...current].every((id) => ids.has(id))) return current;
      return ids;
    });
  };

  const handleViewportChange = useCallback((perspective: PprCanvasPerspective, viewport: Viewport) => {
    setFlowViewports((current) => {
      const previous = current[perspective];
      if (
        previous
        && Math.abs(previous.x - viewport.x) < 0.01
        && Math.abs(previous.y - viewport.y) < 0.01
        && Math.abs(previous.zoom - viewport.zoom) < 0.0001
      ) return current;
      return { ...current, [perspective]: viewport };
    });
  }, []);

  const handleLayoutPositionsChange = useCallback((
    layoutKey: keyof PprCanvasLayouts,
    positions: PprCanvasLayoutPositions,
  ) => {
    setFlowLayouts((current) => ({
      ...current,
      [layoutKey]: {
        ...(current[layoutKey] ?? {}),
        ...positions,
      },
    }));
  }, []);

  useEffect(() => {
    if (!ws.model) return;
    const elementIds = new Set(ws.model.diagram.usages.map((element) => element.id));
    const relationshipIds = new Set(ws.model.diagram.relationships.map((relationship) => relationship.id));
    setSelectedElementIds((current) => {
      const next = new Set([...current].filter((id) => elementIds.has(id)));
      return next.size === current.size ? current : next;
    });
    setSelectedRelationshipIds((current) => {
      const next = new Set([...current].filter((id) => relationshipIds.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [ws.model]);

  useEffect(() => {
    collaboration.updateSelection([...selectedElementIds]);
  }, [collaboration.updateSelection, selectedElementIds]);

  // Derive selection
  const selectedElements = [...selectedElementIds]
    .map((id) => ws.model?.diagram.usages.find((element) => element.id === id))
    .filter((element): element is PprElement => Boolean(element));
  const selectedRelationships = ws.model?.diagram.relationships.filter(r => selectedRelationshipIds.has(r.id)) || [];
  const analysisContext = useMemo(
    () => ws.model
      ? getAnalysisContext(ws.model, selectedElementIds, selectedRelationshipIds)
      : { elementIds: new Set<string>(), relationshipIds: new Set<string>() },
    [selectedElementIds, selectedRelationshipIds, ws.model],
  );
  const canvasPerspective: PprCanvasPerspective = surface === 'graph' || surface === 'library' || surface === 'item' ? 'ppr' : surface;
  const canvasLayoutKey = getPprCanvasLayoutKey(
    canvasPerspective,
    productViewMode,
    pprLevel,
    resourceViewMode,
  );

  const handleValidate = () => {
    if (!ws.model) return;
    ws.validateModel.mutate({ data: ws.model }, {
      onSuccess: () => setValidationOpen(true),
      onError: (err) => toast.error("Validation failed to run")
    });
  };

  const handleSave = () => {
    if (!ws.model || ws.saveModelMutation.isPending) return;
    ws.saveModel(() => toast.success("Model saved successfully"));
  };

  const commitModelName = () => {
    const nextName = modelNameDraft.trim();
    if (!ws.model || !nextName) {
      setModelNameDraft(ws.model?.name ?? '');
      return;
    }
    ws.renameModel(nextName);
  };

  const openExport = (mode: 'model' | 'process-specification', format: ExportFormat = 'automationml') => {
    setExportMode(mode);
    setExportFormat(format);
    setExportOpen(true);
  };

  const restoreProjectFile = (projectFile: PprProjectFile) => {
    setImportingFormat('json');
    ws.importModel(
      getProjectModel(projectFile),
      () => {
        setSelectedElementIds(new Set());
        setSelectedRelationshipIds(new Set());
        setProductViewMode(projectFile.workspace.product_view_mode);
        setResourceViewMode(projectFile.workspace.resource_view_mode ?? 'contains');
        setFlowLayouts(getSavedProjectLayouts(projectFile));
        setFlowViewports(getSavedProjectViewports(projectFile));
        setLibraryTypeFilter(null);
        setSurface(projectFile.workspace.surface);
        setImportingFormat(null);
        toast.success('Project opened', {
          description: `${projectFile.project.name} restored with its Library and five workspace flows.`,
        });
      },
      (error) => {
        setImportingFormat(null);
        toast.error('Could not open this project', {
          description: getMutationErrorDetail(error) ?? 'The project model is not semantically valid.',
        });
      },
    );
  };

  const handleDownloadProject = () => {
    if (!ws.model) return;
    const projectFile = createPprProjectFile(ws.model, {
      surface,
      product_view_mode: productViewMode,
      resource_view_mode: resourceViewMode,
      layouts: flowLayouts,
      viewports: flowViewports,
    });
    downloadJsonFile(projectFile, getPprProjectFilename(ws.model));
    toast.success('Project downloaded', {
      description: 'The JSON file contains the Library, semantic diagram, and all five React Flow snapshots.',
    });
  };

  const handleOpenProject = async (file: File | undefined) => {
    if (!file) return;
    try {
      const projectFile = parsePprProjectFile(JSON.parse(await file.text()) as unknown);
      restoreProjectFile(projectFile);
    } catch (error) {
      setImportingFormat(null);
      toast.error('Could not open this project', {
        description: error instanceof Error ? error.message : 'The project JSON could not be parsed.',
      });
    } finally {
      if (projectInputRef.current) projectInputRef.current.value = '';
    }
  };

  const handleReset = () => {
    if (confirm("Are you sure? This will delete the current model.")) {
      ws.resetModel();
      setSelectedElementIds(new Set());
      setSelectedRelationshipIds(new Set());
      setFlowLayouts({});
      setFlowViewports({});
    }
  };

  const handleLoadScenario = (scenarioId: string) => {
    const scenario = DEVELOPMENT_SCENARIOS.find((candidate) => candidate.id === scenarioId);
    if (!scenario) return;
    ws.loadScenario(clonePprScenarioModel(scenario), () => {
      setSelectedElementIds(new Set());
      setSelectedRelationshipIds(new Set());
      setFlowLayouts({});
      setFlowViewports({});
      setSurface('graph');
      toast.success(`Loaded ${scenario.label}`, {
        description: 'Development scenario loaded through the normal model API.',
      });
    });
  };

  const handleImport = async (file: File | undefined) => {
    if (!file) return;
    const extension = file.name.split('.').pop()?.toLowerCase();
    const isSysml = extension === 'sysml';
    const isAutomationml = extension === 'aml' || extension === 'xml' || /xml/.test(file.type);
    try {
      const content = await file.text();
      if (isSysml) {
        setImportingFormat('sysml');
        ws.importSysml(
          content,
          () => {
            setSelectedElementIds(new Set());
            setSelectedRelationshipIds(new Set());
            setFlowLayouts({});
            setFlowViewports({});
            setImportingFormat(null);
            toast.success("SysML v2 model imported");
          },
          (error) => {
            setImportingFormat(null);
            toast.error("Could not import this SysML v2 model", {
              description: getMutationErrorDetail(error) ?? "The document is not a valid PPR SysML model",
            });
          },
        );
        return;
      }
      if (isAutomationml) {
        setImportingFormat('automationml');
        ws.importAutomationml(
          content,
          () => {
            setSelectedElementIds(new Set());
            setSelectedRelationshipIds(new Set());
            setFlowLayouts({});
            setFlowViewports({});
            setImportingFormat(null);
            toast.success("AutomationML model imported");
          },
          (error) => {
            setImportingFormat(null);
            toast.error("Could not import this AutomationML model", {
              description: getMutationErrorDetail(error) ?? "The document is not a valid PPR AutomationML model",
            });
          },
        );
        return;
      }
      if (extension !== 'json' && !/json/.test(file.type)) {
        toast.error("Unsupported exchange file", {
          description: "Choose a .sysml, .aml, .xml, or .json model file.",
        });
        return;
      }
      const parsed = JSON.parse(content) as unknown;
      if (isPprProjectFile(parsed)) {
        restoreProjectFile(parsePprProjectFile(parsed));
        return;
      }
      const imported = parsed as PprModel;
      setImportingFormat('json');
      ws.importModel(
        imported,
        () => {
          setSelectedElementIds(new Set());
          setSelectedRelationshipIds(new Set());
          setFlowLayouts({});
          setFlowViewports({});
          setImportingFormat(null);
          toast.success("JSON model imported");
        },
        (error) => {
          setImportingFormat(null);
          toast.error("Could not import this JSON model", {
            description: getMutationErrorDetail(error) ?? "The imported model is not semantically valid",
          });
        },
      );
    } catch (error) {
      setImportingFormat(null);
      toast.error(`Could not read this ${isSysml ? "SysML v2" : isAutomationml ? "AutomationML" : "JSON"} model`, {
        description: error instanceof Error ? error.message : "The file could not be parsed.",
      });
    } finally {
      if (importInputRef.current) importInputRef.current.value = "";
    }
  };

  const handleBackgroundClick = () => {
    setSelectedElementIds(new Set());
    setSelectedRelationshipIds(new Set());
  };

  const handleSurfaceChange = (nextSurface: WorkspaceSurface) => {
    if (nextSurface === 'library') setLibraryTypeFilter(null);
    if (nextSurface === 'levels') setPprLevel(0);
    setSurface(nextSurface);
  };

  const openPerspectiveLibrary = (perspective: PprCanvasPerspective) => {
    setLibraryTypeFilter(perspective === 'ppr' || perspective === 'levels' ? null : perspective);
    setSurface('library');
  };

  return (
    <div className="flex flex-col min-h-[100dvh] h-[100dvh] w-full overflow-hidden bg-background">
      {/* AutomationML workspace header */}
      <header className="relative z-20 shrink-0 border-b-2 border-accent bg-card px-4 py-2 md:px-6">
        <div className="flex min-h-[3.5rem] flex-wrap items-center justify-between gap-x-6 gap-y-2">
          <div className="flex min-w-0 items-center gap-3">
            <div data-testid="aml-identity" className="shrink-0">
              <div
                aria-label="AutomationML"
                className="aml-wordmark"
              >
                <span className="aml-wordmark-bracket">&lt;</span>
                AutomationML
                <span className="aml-wordmark-bracket">/&gt;</span>
              </div>
              <div className="aml-kicker mt-1">Engineering data solutions</div>
            </div>
            <div className="hidden h-9 w-px bg-border sm:block" />
            <div className="min-w-0">
              <div className="aml-kicker">PPR modeling workspace · IEC 62714 context</div>
              <input
                value={modelNameDraft}
                onChange={(event) => setModelNameDraft(event.target.value)}
                onBlur={commitModelName}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.currentTarget.blur();
                  } else if (event.key === 'Escape') {
                    setModelNameDraft(ws.model?.name ?? '');
                    event.currentTarget.blur();
                  }
                }}
                aria-label="Model name"
                data-testid="model-name-input"
                placeholder="Loading..."
                maxLength={200}
                className="block w-full max-w-[22rem] border border-transparent bg-transparent px-0 text-sm font-semibold tracking-tight text-foreground outline-none transition-colors hover:border-border focus:border-primary focus:px-1"
              />
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            <Button
              variant={collaboration.session ? 'outline' : 'ghost'}
              size="sm"
              className="h-8 gap-2 text-xs"
              data-testid="button-collaboration"
              onClick={() => setCollaborationOpen(true)}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${collaboration.status === 'connected' ? 'bg-emerald-500' : collaboration.session ? 'bg-amber-500' : 'bg-muted-foreground/40'}`} />
              <Users className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{collaboration.session ? `${collaboration.participants.length} online` : 'Collaborate'}</span>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 gap-2 rounded-sm border-primary/30 text-xs"
                  data-testid="button-project-file"
                >
                  <FolderArchive className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Project</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuLabel>
                  <span className="aml-kicker">Complete project file</span>
                  <span className="mt-1 block text-[10px] font-normal leading-relaxed text-muted-foreground">
                    Library + PPR, Process, Product, and Resource flows
                  </span>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  data-testid="menu-download-project"
                  disabled={!ws.model}
                  onSelect={handleDownloadProject}
                >
                  <Download className="h-3.5 w-3.5" /> Download project JSON
                </DropdownMenuItem>
                <DropdownMenuItem
                  data-testid="menu-open-project"
                  disabled={Boolean(importingFormat)}
                  onSelect={() => projectInputRef.current?.click()}
                >
                  <Upload className="h-3.5 w-3.5" /> Open project JSON
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-2 text-xs text-accent hover:bg-accent/10 hover:text-accent"
              data-testid="button-aml-export"
              onClick={() => openExport('model')}
            >
              <FileDown className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">AutomationML export</span>
              <span className="sm:hidden">Export</span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-2 text-xs text-sysml-blue hover:bg-sysml-blue/10 hover:text-sysml-blue"
              data-testid="button-sysml-export"
              onClick={() => openExport('model', 'sysml-ppr')}
            >
              <FileDown className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">SysML v2 export</span>
              <span className="sm:hidden">SysML</span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-2 text-xs hover:bg-primary hover:text-primary-foreground"
              onClick={handleSave}
               disabled={!ws.model || ws.saveModelMutation.isPending}
               aria-busy={ws.saveModelMutation.isPending}
               data-testid="button-save-model"
            >
               <Save className="h-3.5 w-3.5" /> {ws.saveModelMutation.isPending ? 'Saving…' : 'Save'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-2 text-xs"
              data-testid="button-revision-history"
              onClick={() => setRevisionHistoryOpen(true)}
            >
              <History className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">History</span>
            </Button>
            <input
              ref={projectInputRef}
              type="file"
              accept="application/json,.json,.ppr-project.json"
              className="hidden"
              data-testid="input-open-project"
              onChange={(event) => void handleOpenProject(event.target.files?.[0])}
            />
            <input
              ref={importInputRef}
              type="file"
              accept="application/json,.json,text/plain,.sysml,application/xml,text/xml,.aml,.xml"
              className="hidden"
              onChange={(event) => void handleImport(event.target.files?.[0])}
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 gap-2 rounded-sm border-primary/30 text-xs"
                  data-testid="button-header-actions"
                >
                  <MoreHorizontal className="h-3.5 w-3.5" /> Actions
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="aml-kicker px-2 py-1.5">
                  AutomationML workflow
                </DropdownMenuLabel>
                <DropdownMenuItem onSelect={handleValidate}>
                  <FileWarning className="h-3.5 w-3.5" /> Validate
                </DropdownMenuItem>
                 <DropdownMenuItem
                   data-testid="menu-revision-history"
                   onSelect={() => setRevisionHistoryOpen(true)}
                 >
                   <History className="h-3.5 w-3.5" /> Revision history
                 </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => openExport('model')}>
                  <FileDown className="h-3.5 w-3.5" /> Export
                </DropdownMenuItem>
                {surface === 'process' && (
                  <DropdownMenuItem
                    data-testid="menu-export-process-specification"
                    onSelect={() => openExport('process-specification')}
                  >
                    <FileDown className="h-3.5 w-3.5" /> Export Process Specification
                  </DropdownMenuItem>
                )}
                 <DropdownMenuItem
                   disabled={Boolean(importingFormat)}
                   data-testid="menu-import-exchange-file"
                   onSelect={() => importInputRef.current?.click()}
                 >
                   <FileUp className="h-3.5 w-3.5" />
                   {importingFormat ? `Importing ${importingFormat}…` : 'Import JSON / SysML v2 / AutomationML'}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => {
                  setFlowLayouts({});
                  setFlowViewports({});
                  ws.loadExample();
                }}>
                  <Play className="h-3.5 w-3.5" /> Load Example
                </DropdownMenuItem>
                {import.meta.env.DEV && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel className="flex items-center gap-2 aml-kicker px-2 py-1.5">
                      <FlaskConical className="h-3.5 w-3.5" /> Development scenarios
                    </DropdownMenuLabel>
                    {DEVELOPMENT_SCENARIOS.map((scenario) => (
                      <DropdownMenuItem
                        key={scenario.id}
                        data-testid={`menu-load-scenario-${scenario.id}`}
                        onSelect={() => handleLoadScenario(scenario.id)}
                      >
                        {scenario.label}
                      </DropdownMenuItem>
                    ))}
                  </>
                )}
                <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={handleReset}>
                  <RefreshCw className="h-3.5 w-3.5" /> Reset model
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <div className="mt-2 flex min-w-0 flex-wrap items-center justify-between gap-2 border-t border-border/70 pt-2">
          <div className="aml-kicker hidden shrink-0 sm:block">Workspace surfaces</div>
          <div data-testid="view-switcher" className="flex max-w-full flex-wrap items-center border border-border bg-muted/40 p-0.5">
            <button
              type="button"
              data-testid="button-view-library"
              aria-pressed={surface === 'library'}
              onClick={() => handleSurfaceChange('library')}
              className={`flex h-7 shrink-0 items-center gap-1.5 px-2.5 font-mono text-[10px] uppercase tracking-[0.1em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${surface === 'library' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
            >
              <BookOpen className="h-3.5 w-3.5" /> Library
            </button>
            <button
              type="button"
              data-testid="button-view-graph"
              aria-pressed={surface === 'graph'}
              onClick={() => handleSurfaceChange('graph')}
              className={`flex h-7 shrink-0 items-center gap-1.5 px-2.5 font-mono text-[10px] uppercase tracking-[0.1em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${surface === 'graph' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
            >
              <Network className="h-3.5 w-3.5" /> PPR
            </button>
            <button
              type="button"
              data-testid="button-view-ppr-levels"
              aria-pressed={surface === 'levels'}
              onClick={() => handleSurfaceChange('levels')}
              className={`flex h-7 shrink-0 items-center gap-1.5 px-2.5 font-mono text-[10px] uppercase tracking-[0.1em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${surface === 'levels' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
            >
              <ListTree className="h-3.5 w-3.5" /> Levels
            </button>
            <button
              type="button"
              data-testid="button-view-product"
              aria-pressed={surface === 'product'}
              onClick={() => handleSurfaceChange('product')}
              className={`flex h-7 shrink-0 items-center gap-1.5 px-2.5 font-mono text-[10px] uppercase tracking-[0.1em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${surface === 'product' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
            >
              <Boxes className="h-3.5 w-3.5" /> Product
            </button>
            <button
              type="button"
              data-testid="button-view-process-specification"
              aria-pressed={surface === 'process'}
              onClick={() => handleSurfaceChange('process')}
              className={`flex h-7 shrink-0 items-center gap-1.5 px-2.5 font-mono text-[10px] uppercase tracking-[0.1em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${surface === 'process' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
            >
              <ListTree className="h-3.5 w-3.5" /> Process
            </button>
            <button
              type="button"
              data-testid="button-view-resource"
              aria-pressed={surface === 'resource'}
              onClick={() => handleSurfaceChange('resource')}
              className={`flex h-7 shrink-0 items-center gap-1.5 px-2.5 font-mono text-[10px] uppercase tracking-[0.1em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${surface === 'resource' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
            >
              <Users className="h-3.5 w-3.5" /> Resource
            </button>
          </div>
        </div>
      </header>

      {collaboration.session && collaboration.syncState !== 'synced' && (
        <div
          role="status"
          data-testid="collaboration-sync-status"
          className={`flex shrink-0 items-center justify-between gap-3 border-b px-4 py-2 text-xs md:px-6 ${
            collaboration.syncState === 'conflict'
              ? 'border-destructive/30 bg-destructive/5 text-destructive'
              : 'border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-300'
          }`}
        >
          <div className="min-w-0">
            <div className="font-medium">
              {collaboration.syncState === 'conflict'
                ? 'Collaboration conflict — your local edit is still open'
                : 'Local collaboration edit queued'}
            </div>
            <div className="mt-0.5 truncate opacity-80">
              {collaboration.syncState === 'conflict'
                ? 'Choose which version to keep. Nothing from your edit has been discarded.'
                : 'It will be sent when the collaboration connection is available.'}
            </div>
          </div>
          {collaboration.syncState === 'conflict' && collaboration.recovery && (
            <div className="flex shrink-0 gap-2">
              <Button
                size="sm"
                variant="outline"
                className="h-7 border-current/30 text-xs"
                onClick={collaboration.retryPendingUpdate}
              >
                Keep my edits
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                onClick={collaboration.discardPendingUpdate}
              >
                Use server version
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Main Workspace Area */}
      <div className="flex flex-1 overflow-hidden relative">
        
        {/* Left Sidebar - Palette */}
        {surface !== 'library' && surface !== 'levels' && surface !== 'item' && (
          <aside className="hidden w-64 shrink-0 border-r border-border bg-card/70 flex-col z-10 backdrop-blur-sm shadow-sm lg:flex">
            <ElementsPalette
              definitions={ws.model?.library.definitions ?? []}
              usages={ws.model?.diagram.usages ?? []}
              perspective={canvasPerspective}
              onCreateElement={handleCreateElement}
              onOpenLibrary={() => openPerspectiveLibrary(canvasPerspective)}
            />
          </aside>
        )}

        {/* Center - Canvas */}
        <main className="flex-1 relative">
          {ws.isError && !ws.model ? (
            <WorkspaceErrorState
              detail={getMutationErrorDetail(ws.error) ?? 'The model service did not return a usable model.'}
              onRetry={() => void ws.refetchModel()}
            />
          ) : surface === 'library' && ws.model ? (
            <LibraryView
              definitions={ws.model.library.definitions}
              usages={ws.model.diagram.usages}
              typeFilter={libraryTypeFilter}
              onTypeFilterChange={setLibraryTypeFilter}
              onCreateDefinition={ws.createDefinition}
              onUpdateDefinition={ws.updateDefinition}
              onDeleteDefinition={ws.deleteDefinition}
            />
          ) : surface === 'item' && ws.model ? (
            <ItemLifecycleView
              model={ws.model}
              onSelectElement={(elementId) => {
                setSelectedElementIds(new Set([elementId]));
                setSelectedRelationshipIds(new Set());
                setSurface('graph');
              }}
            />
          ) : (
            <PprCanvas
              model={ws.model}
              isLoading={ws.isLoading}
              perspective={canvasPerspective}
              productViewMode={productViewMode}
              onProductViewModeChange={setProductViewMode}
              resourceViewMode={resourceViewMode}
              onResourceViewModeChange={setResourceViewMode}
              pprLevel={pprLevel}
              onPprLevelChange={setPprLevel}
              collapseItemStates={collapseItemStates}
              onCollapseItemStatesChange={setCollapseItemStates}
              onUpdateElement={ws.updateElement}
              onDeleteElement={ws.deleteElement}
              onCreateElement={handleCreateElement}
              onCreateRelationship={ws.createRelationship}
              onRequestMerge={handleRequestMerge}
              onDeleteRelationship={ws.deleteRelationship}
              selectedElementIds={selectedElementIds}
              selectedRelationshipIds={selectedRelationshipIds}
              contextElementIds={analysisContext.elementIds}
              contextRelationshipIds={analysisContext.relationshipIds}
              onSelectElements={selectElements}
              onSelectRelationships={selectRelationships}
              onBackgroundClick={handleBackgroundClick}
              remoteParticipants={collaboration.participants.filter(
                  (participant) => participant.id !== collaboration.participantId,
                )}
               onCursorMove={collaboration.updateCursor}
              savedViewport={flowViewports[canvasPerspective]}
              onViewportChange={handleViewportChange}
              layoutPositions={flowLayouts[canvasLayoutKey]}
              onLayoutPositionsChange={handleLayoutPositionsChange}
            />
          )}
        </main>

        {surface !== 'library' && surface !== 'item' && (
          <WorkspaceInspector
            model={ws.model}
            selectedElements={selectedElements}
            selectedRelationships={selectedRelationships}
            perspective={canvasPerspective}
            onCreateElement={ws.createElement}
            onUpdateElement={ws.updateElement}
            onDeleteElement={ws.deleteElement}
            onDeleteRelationship={ws.deleteRelationship}
            onUpdateRelationship={ws.updateRelationship}
            onCreateRelationship={ws.createRelationship}
            onRequestMerge={handleRequestMerge}
            onRequestRelationship={handleRequestRelationship}
               readOnly={surface === 'levels'}
          />
        )}
      </div>

      {/* Dialogs */}
      <CollaborationDialog
        open={collaborationOpen}
        onOpenChange={setCollaborationOpen}
        collaboration={collaboration}
        onStartModeling={() => setSurface('graph')}
      />

      {validationOpen && (
        <ValidationDialog 
          open={validationOpen} 
          onOpenChange={setValidationOpen} 
          result={ws.validateModel.data} 
        />
      )}
      
      {exportOpen && (
        <ExportDialog 
          open={exportOpen} 
          onOpenChange={setExportOpen} 
          model={ws.model ?? undefined}
          mode={exportMode}
          initialFormat={exportFormat}
        />
      )}

      <RevisionHistoryDialog
        open={revisionHistoryOpen}
        onOpenChange={setRevisionHistoryOpen}
        currentModel={ws.model}
        onRestored={() => {
          setSelectedElementIds(new Set());
          setSelectedRelationshipIds(new Set());
        }}
      />

      {mergePair && ws.model && (() => {
        const first = ws.model.diagram.usages.find((element) => element.id === mergePair.firstId);
        const second = ws.model.diagram.usages.find((element) => element.id === mergePair.secondId);
        if (!first || !second) return null;
        return (
          <MergeUsagesDialog
            open
            onOpenChange={(open) => {
              if (!open) setMergePair(null);
            }}
            first={first}
            second={second}
            model={ws.model}
            onMerge={handleMerge}
            isPending={ws.mergeUsagesMutation.isPending}
          />
        );
      })()}

      {relationshipPair && ws.model && (
        <CreateRelationshipDialog
          open
          onOpenChange={(open) => {
            if (!open) setRelationshipPair(null);
          }}
          sourceId={relationshipPair.sourceId}
          targetId={relationshipPair.targetId}
          model={ws.model}
          onCreateRelationship={ws.createRelationship}
        />
      )}
    </div>
  );
}
