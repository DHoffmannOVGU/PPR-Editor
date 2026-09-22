import { useQueryClient } from '@tanstack/react-query';
import {
  getGetModelQueryKey,
  getGetModelRevisionQueryKey,
  getGetModelRevisionsQueryKey,
  useGetModelRevision,
  useGetModelRevisions,
  useRestoreModelRevision,
  type ModelRevisionSummary,
  type PprModel,
  type PprRevision,
} from '@workspace/api-client-react';

export type ModelRevision = ModelRevisionSummary;
export type ModelRevisionDetail = PprRevision;

export function useRevisionHistory(selectedRevisionId: string | null, enabled = true) {
  const queryClient = useQueryClient();
  const revisionListKey = getGetModelRevisionsQueryKey();
  const listQuery = useGetModelRevisions({
    query: {
      queryKey: revisionListKey,
      staleTime: 15_000,
      refetchOnMount: 'always',
      enabled,
    },
  });
  const detailQuery = useGetModelRevision(selectedRevisionId ?? '', {
    query: {
      queryKey: selectedRevisionId
        ? getGetModelRevisionQueryKey(selectedRevisionId)
        : ['/api/model/revisions/empty'],
      enabled: enabled && Boolean(selectedRevisionId),
    },
  });
  const restoreMutation = useRestoreModelRevision();

  const restore = (revisionId: string, onSuccess?: (model: PprModel) => void, onError?: (error: unknown) => void) => {
    restoreMutation.mutate({ revisionId }, {
      onSuccess: (model) => {
        queryClient.setQueryData(getGetModelQueryKey(), model);
        queryClient.invalidateQueries({ queryKey: revisionListKey });
        onSuccess?.(model);
      },
      onError,
    });
  };

  return {
    revisions: listQuery.data ?? [],
    isLoading: listQuery.isLoading,
    isError: listQuery.isError,
    error: listQuery.error,
    refetch: listQuery.refetch,
    selectedRevision: selectedRevisionId ? detailQuery.data ?? null : null,
    isInspecting: Boolean(selectedRevisionId),
    isDetailLoading: detailQuery.isLoading,
    detailError: detailQuery.error,
    restore,
    isRestoring: restoreMutation.isPending,
  };
}