import type { PprElement, RelationshipInput } from '@workspace/api-client-react';
import type { PprCanvasPerspective, PprProductViewMode } from './ppr-perspective';

export type PprQuickConnectionSpec = {
  type: PprElement['type'];
  kind?: RelationshipInput['kind'];
};

export function getQuickConnectionSpec(
  source: PprElement,
  handleId: string | null,
  perspective: PprCanvasPerspective,
  productViewMode: PprProductViewMode,
): PprQuickConnectionSpec | null {
  if (perspective === 'product' && source.type === 'product' && handleId === 'source-bottom') {
    return { type: 'product', kind: productViewMode === 'bom' ? 'contains' : 'becomes' };
  }
  if (
    perspective === 'process'
    && source.type === 'process'
    && handleId === 'source-bottom'
  ) {
    return { type: 'process', kind: 'succeeds' };
  }
  if (perspective === 'resource' && source.type === 'resource' && handleId === 'source-bottom') {
    return { type: 'resource', kind: 'contains' };
  }
  if (perspective !== 'ppr') return null;
  if (source.type === 'product' && handleId === 'source-bottom') return { type: 'process' };
  if (source.type === 'process' && handleId === 'source-bottom') return { type: 'product' };
  if (source.type === 'process' && handleId === 'source-right') return { type: 'resource' };
  return null;
}

export function getIndividualViewRelationshipKind(
  perspective: PprCanvasPerspective,
  productViewMode: PprProductViewMode,
): RelationshipInput['kind'] | null {
  if (perspective === 'product') return productViewMode === 'bom' ? 'contains' : 'becomes';
  if (perspective === 'process') return 'succeeds';
  if (perspective === 'resource') return 'contains';
  return null;
}
