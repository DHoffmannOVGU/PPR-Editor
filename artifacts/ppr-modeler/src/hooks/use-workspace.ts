import { useCallback } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import {
  useGetModel,
  getGetModelQueryKey,
  getGetModelRevisionsQueryKey,
  useSaveModel,
  useLoadExampleModel,
  useResetModel,
  useValidateModel,
  useCreateElement,
  useUpdateElement,
  useDeleteElement,
  useCreateDefinition,
  useUpdateDefinition,
  useDeleteDefinition,
  useCreateRelationship,
  useUpdateRelationship,
  useDeleteRelationship,
  useImportSysmlModel,
  useImportAutomationmlModel,
  useMergeModelUsages,
} from '@workspace/api-client-react';
import type {
  PprModel,
  PprElement,
  ElementUpdate,
  ElementInput,
  DefinitionInput,
  DefinitionUpdate,
  RelationshipInput,
  RelationshipUpdate,
  PprRelationship,
  MergeUsagesRequest,
} from '@workspace/api-client-react';
import { toast } from 'sonner';

export function getMutationErrorDetail(error: unknown) {
  const formatIssue = (issue: unknown) => {
    if (typeof issue !== 'object' || issue === null) return undefined;
    const issueRecord = issue as Record<string, unknown>;
    const message = typeof issueRecord.message === 'string' ? issueRecord.message : undefined;
    const elementId = typeof issueRecord.element_id === 'string' ? issueRecord.element_id : undefined;
    const relationshipId = typeof issueRecord.relationship_id === 'string' ? issueRecord.relationship_id : undefined;
    if (!message) return undefined;
    const target = relationshipId
      ? `relationship '${relationshipId}'`
      : elementId
        ? `element '${elementId}'`
        : undefined;
    return target ? `${target}: ${message}` : message;
  };

  const findDetail = (value: unknown): string | undefined => {
    if (typeof value === 'string' && value.trim()) return value;
    if (typeof value !== 'object' || value === null) return undefined;
    const record = value as Record<string, unknown>;
    const issues = Array.isArray(record.issues)
      ? record.issues.map(formatIssue).filter((issue): issue is string => Boolean(issue))
      : [];
    if (issues.length) return issues.join('; ');
    for (const key of ['message', 'detail', 'error']) {
      const detail = findDetail(record[key]);
      if (detail) return detail;
    }
    return undefined;
  };

  if (typeof error === 'object' && error !== null) {
    const structuredDetail = findDetail((error as Record<string, unknown>).data);
    if (structuredDetail) return structuredDetail;
  }
  if (error instanceof Error && error.message) return error.message;
  return findDetail(error);
}

function notifyMutationFailure(action: string, error: unknown) {
  const detail = getMutationErrorDetail(error);
  toast.error(`Could not ${action}`, {
    description: `${detail ? `${detail} ` : ''}The model was refreshed. Try again.`,
  });
}

function updateCachedModel(
  queryClient: QueryClient,
  queryKey: ReturnType<typeof getGetModelQueryKey>,
  update: (model: PprModel) => PprModel,
) {
  queryClient.setQueryData<PprModel>(queryKey, (current) => current ? update(current) : current);
}

function replaceById<T extends { id: string }>(items: T[], id: string, replacement: Partial<T>): T[] {
  return items.map((item) => item.id === id ? { ...item, ...replacement } : item);
}

function reportMutationFailure(
  queryClient: QueryClient,
  queryKey: ReturnType<typeof getGetModelQueryKey>,
  action: string,
  error: unknown,
) {
  notifyMutationFailure(action, error);
  queryClient.invalidateQueries({ queryKey });
}

function invalidateRevisionHistory(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ queryKey: getGetModelRevisionsQueryKey() });
}

export function useWorkspace() {
  const queryClient = useQueryClient();
  const queryKey = getGetModelQueryKey();
  
  const { data: model, isLoading, isError, error, refetch: refetchModel } = useGetModel({
    query: {
      queryKey,
      staleTime: Infinity, // Keep it fresh manually
      retry: false,
    }
  });

  const saveModel = useSaveModel();
  const loadExample = useLoadExampleModel();
  const resetModel = useResetModel();
  const validateModel = useValidateModel();
  const createElement = useCreateElement();
  const updateElement = useUpdateElement();
  const deleteElement = useDeleteElement();
  const createDefinition = useCreateDefinition();
  const updateDefinitionMutation = useUpdateDefinition();
  const deleteDefinition = useDeleteDefinition();
  const createRelationship = useCreateRelationship();
  const updateRelationshipMutation = useUpdateRelationship();
  const deleteRelationship = useDeleteRelationship();
  const importSysmlModel = useImportSysmlModel();
  const importAutomationmlModel = useImportAutomationmlModel();
  const mergeModelUsages = useMergeModelUsages();

  const handleUpdateElement = useCallback((id: string, updates: ElementUpdate) => {
    updateCachedModel(queryClient, queryKey, (current) => ({
      ...current,
      diagram: {
        ...current.diagram,
        usages: replaceById(current.diagram.usages, id, updates as Partial<PprElement>),
      },
    }));
    
    updateElement.mutate({ elementId: id, data: updates }, {
      onError: (mutationError) => {
        reportMutationFailure(queryClient, queryKey, 'save this element', mutationError);
      },
      onSuccess: (updated) => {
        void invalidateRevisionHistory(queryClient);
        updateCachedModel(queryClient, queryKey, (current) => ({
          ...current,
          diagram: {
            ...current.diagram,
            usages: replaceById(current.diagram.usages, id, updated),
          },
        }));
      }
    });
  }, [updateElement, queryClient, queryKey]);

  const handleCreateElement = useCallback((data: ElementInput, onSuccess?: (el: PprElement) => void) => {
    createElement.mutate({ data }, {
      onError: (mutationError) => {
        reportMutationFailure(queryClient, queryKey, 'create this element', mutationError);
      },
      onSuccess: (newElement) => {
        void invalidateRevisionHistory(queryClient);
        updateCachedModel(queryClient, queryKey, (current) => ({
          ...current,
          diagram: {
            ...current.diagram,
            usages: [...current.diagram.usages, newElement],
          },
        }));
        onSuccess?.(newElement);
      }
    });
  }, [createElement, queryClient, queryKey]);

  const handleDeleteElement = useCallback((id: string) => {
    updateCachedModel(queryClient, queryKey, (current) => ({
      ...current,
      diagram: {
        ...current.diagram,
        usages: current.diagram.usages.filter((element) => element.id !== id),
        relationships: current.diagram.relationships.filter((relationship) => relationship.source_id !== id && relationship.target_id !== id),
      },
    }));

    deleteElement.mutate({ elementId: id }, {
      onError: (mutationError) => {
        reportMutationFailure(queryClient, queryKey, 'delete this element', mutationError);
      },
      onSuccess: () => {
        void invalidateRevisionHistory(queryClient);
      },
    });
  }, [deleteElement, queryClient, queryKey]);

  const handleCreateRelationship = useCallback((data: RelationshipInput) => {
    createRelationship.mutate({ data }, {
      onError: (mutationError) => {
        reportMutationFailure(queryClient, queryKey, 'create this relationship', mutationError);
      },
      onSuccess: (newRel) => {
        void invalidateRevisionHistory(queryClient);
        updateCachedModel(queryClient, queryKey, (current) => ({
          ...current,
          diagram: {
            ...current.diagram,
            relationships: [...current.diagram.relationships, newRel],
          },
        }));
      }
    });
  }, [createRelationship, queryClient, queryKey]);

  const handleUpdateRelationship = useCallback((id: string, updates: RelationshipUpdate) => {
    updateCachedModel(queryClient, queryKey, (current) => ({
      ...current,
      diagram: {
        ...current.diagram,
        relationships: replaceById(current.diagram.relationships, id, updates as Partial<PprRelationship>),
      },
    }));

    updateRelationshipMutation.mutate({ relationshipId: id, data: updates }, {
      onError: (mutationError) => {
        reportMutationFailure(queryClient, queryKey, 'save this relationship', mutationError);
      },
      onSuccess: (updatedRelationship) => {
        void invalidateRevisionHistory(queryClient);
        updateCachedModel(queryClient, queryKey, (current) => ({
          ...current,
          diagram: {
            ...current.diagram,
            relationships: replaceById(current.diagram.relationships, id, updatedRelationship),
          },
        }));
      },
    });
  }, [updateRelationshipMutation, queryClient, queryKey]);

  const handleDeleteRelationship = useCallback((id: string) => {
    updateCachedModel(queryClient, queryKey, (current) => ({
      ...current,
      diagram: {
        ...current.diagram,
        relationships: current.diagram.relationships.filter((relationship) => relationship.id !== id),
      },
    }));

    deleteRelationship.mutate({ relationshipId: id }, {
      onError: (mutationError) => {
        reportMutationFailure(queryClient, queryKey, 'delete this relationship', mutationError);
      },
      onSuccess: () => {
        void invalidateRevisionHistory(queryClient);
      },
    });
  }, [deleteRelationship, queryClient, queryKey]);

  const handleMergeUsages = useCallback((
    data: MergeUsagesRequest,
    onSuccess?: (mergedModel: PprModel) => void,
  ) => {
    mergeModelUsages.mutate({ data }, {
      onError: (mutationError) => {
        reportMutationFailure(queryClient, queryKey, 'merge these usages', mutationError);
      },
      onSuccess: (mergedModel) => {
        void invalidateRevisionHistory(queryClient);
        queryClient.setQueryData(queryKey, mergedModel);
        onSuccess?.(mergedModel);
      },
    });
  }, [mergeModelUsages, queryClient, queryKey]);

  const handleCreateDefinition = useCallback((data: DefinitionInput, onSuccess?: (definition: PprElement) => void) => {
    createDefinition.mutate({ data }, {
      onError: (mutationError) => {
        reportMutationFailure(queryClient, queryKey, 'create this definition', mutationError);
      },
      onSuccess: (newDefinition) => {
        void invalidateRevisionHistory(queryClient);
        updateCachedModel(queryClient, queryKey, (current) => ({
          ...current,
          library: {
            ...current.library,
            definitions: [...current.library.definitions, newDefinition],
          },
        }));
        onSuccess?.(newDefinition);
      },
    });
  }, [createDefinition, queryClient, queryKey]);

  const handleUpdateDefinition = useCallback((id: string, updates: DefinitionUpdate) => {
    updateCachedModel(queryClient, queryKey, (current) => ({
      ...current,
      library: {
        ...current.library,
        definitions: replaceById(current.library.definitions, id, updates as Partial<PprElement>),
      },
    }));

    updateDefinitionMutation.mutate({ definitionId: id, data: updates }, {
      onError: (mutationError) => {
        reportMutationFailure(queryClient, queryKey, 'save this definition', mutationError);
      },
      onSuccess: (updatedDefinition) => {
        void invalidateRevisionHistory(queryClient);
        updateCachedModel(queryClient, queryKey, (current) => ({
          ...current,
          library: {
            ...current.library,
            definitions: replaceById(current.library.definitions, id, updatedDefinition),
          },
        }));
      },
    });
  }, [queryClient, queryKey, updateDefinitionMutation]);

  const handleDeleteDefinition = useCallback((id: string) => {
    deleteDefinition.mutate({ definitionId: id }, {
      onError: (mutationError) => {
        reportMutationFailure(queryClient, queryKey, 'delete this definition', mutationError);
      },
      onSuccess: () => {
        void invalidateRevisionHistory(queryClient);
        updateCachedModel(queryClient, queryKey, (current) => ({
          ...current,
          library: {
            ...current.library,
            definitions: current.library.definitions.filter((definition) => definition.id !== id),
          },
        }));
      },
    });
  }, [deleteDefinition, queryClient, queryKey]);

  const handleSaveModel = useCallback((onSuccess?: () => void) => {
    if (!model) return;
    saveModel.mutate({ data: model, params: { checkpoint: true } }, {
      onSuccess: (newModel) => {
        queryClient.setQueryData(queryKey, newModel);
        void invalidateRevisionHistory(queryClient);
        onSuccess?.();
      },
      onError: (mutationError) => {
        reportMutationFailure(queryClient, queryKey, 'save the model', mutationError);
      },
    });
  }, [model, saveModel, queryClient, queryKey]);

  const handleRenameModel = useCallback((name: string) => {
    if (!model || name === model.name) return;
    const renamedModel = { ...model, name };
    queryClient.setQueryData(queryKey, renamedModel);
    saveModel.mutate({ data: renamedModel, params: { checkpoint: false } }, {
      onSuccess: (newModel) => {
        queryClient.setQueryData(queryKey, newModel);
        void invalidateRevisionHistory(queryClient);
      },
      onError: (mutationError) => {
        queryClient.setQueryData(queryKey, model);
        reportMutationFailure(queryClient, queryKey, 'rename this model', mutationError);
      },
    });
  }, [model, saveModel, queryClient, queryKey]);

  const handleImportModel = useCallback((importedModel: PprModel, onSuccess?: () => void, onError?: (error: unknown) => void) => {
    saveModel.mutate({ data: importedModel, params: { checkpoint: true } }, {
      onSuccess: (newModel) => {
        queryClient.setQueryData(queryKey, newModel);
        void invalidateRevisionHistory(queryClient);
        onSuccess?.();
      },
      onError,
    });
  }, [saveModel, queryClient, queryKey]);

  const handleImportSysml = useCallback((content: string, onSuccess?: () => void, onError?: (error: unknown) => void) => {
    importSysmlModel.mutate({ data: content }, {
      onSuccess: (imported) => {
        queryClient.setQueryData(queryKey, imported);
        void invalidateRevisionHistory(queryClient);
        onSuccess?.();
      },
      onError,
    });
  }, [importSysmlModel, queryClient, queryKey]);

  const handleImportAutomationml = useCallback((content: string, onSuccess?: () => void, onError?: (error: unknown) => void) => {
    importAutomationmlModel.mutate({ data: content }, {
      onSuccess: (imported) => {
        queryClient.setQueryData(queryKey, imported);
        void invalidateRevisionHistory(queryClient);
        onSuccess?.();
      },
      onError,
    });
  }, [importAutomationmlModel, queryClient, queryKey]);

  const handleLoadScenario = useCallback((scenarioModel: PprModel, onSuccess?: () => void) => {
    saveModel.mutate({ data: scenarioModel, params: { checkpoint: true } }, {
      onSuccess: (newModel) => {
        queryClient.setQueryData(queryKey, newModel);
        void invalidateRevisionHistory(queryClient);
        onSuccess?.();
      },
      onError: (mutationError) => {
        reportMutationFailure(queryClient, queryKey, 'load this scenario', mutationError);
      },
    });
  }, [saveModel, queryClient, queryKey]);

  const handleLoadExample = useCallback(() => {
    loadExample.mutate(undefined, {
      onSuccess: (newModel) => {
        queryClient.setQueryData(queryKey, newModel);
        void invalidateRevisionHistory(queryClient);
      }
    });
  }, [loadExample, queryClient, queryKey]);

  const handleResetModel = useCallback(() => {
    resetModel.mutate(undefined, {
      onSuccess: (newModel) => {
        queryClient.setQueryData(queryKey, newModel);
        void invalidateRevisionHistory(queryClient);
      }
    });
  }, [resetModel, queryClient, queryKey]);

  return {
    model,
    isLoading,
    isError,
    error,
    refetchModel,
    
    // Actions
    updateElement: handleUpdateElement,
    createElement: handleCreateElement,
    deleteElement: handleDeleteElement,
    createRelationship: handleCreateRelationship,
    updateRelationship: handleUpdateRelationship,
    deleteRelationship: handleDeleteRelationship,
    mergeUsages: handleMergeUsages,
    saveModel: handleSaveModel,
    renameModel: handleRenameModel,
    importModel: handleImportModel,
    importSysml: handleImportSysml,
    importAutomationml: handleImportAutomationml,
    loadScenario: handleLoadScenario,
    createDefinition: handleCreateDefinition,
    updateDefinition: handleUpdateDefinition,
    deleteDefinition: handleDeleteDefinition,
    loadExample: handleLoadExample,
    resetModel: handleResetModel,
    
    // Direct mutations
    validateModel,
    saveModelMutation: saveModel,
    loadExampleMutation: loadExample,
    resetModelMutation: resetModel,
    mergeUsagesMutation: mergeModelUsages,
  };
}
