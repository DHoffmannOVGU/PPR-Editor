import { PprRelationshipKind } from './generated/types/pprRelationshipKind';
import relationshipRules from './relationship-rules.json';

export type RelationshipElementType = 'product' | 'process' | 'resource';

export type RelationshipRule = {
  readonly source: RelationshipElementType;
  readonly target: RelationshipElementType;
};

export const RELATIONSHIP_RULES = relationshipRules as Record<
  PprRelationshipKind,
  readonly RelationshipRule[]
>;

export const RELATIONSHIP_KINDS = Object.values(PprRelationshipKind);

const contractKinds = Object.keys(RELATIONSHIP_RULES).sort();
const generatedKinds = [...RELATIONSHIP_KINDS].sort();
if (contractKinds.join('|') !== generatedKinds.join('|')) {
  throw new Error(
    'Relationship rules contract does not match the generated relationship input kinds.',
  );
}

export function getRelationshipKindsForTypes(
  source: RelationshipElementType,
  target: RelationshipElementType,
): PprRelationshipKind[] {
  return RELATIONSHIP_KINDS.filter((kind) =>
    RELATIONSHIP_RULES[kind].some(
      (rule) => rule.source === source && rule.target === target,
    ),
  );
}

export function isAllowedRelationshipType(
  kind: PprRelationshipKind,
  source: RelationshipElementType,
  target: RelationshipElementType,
): boolean {
  return RELATIONSHIP_RULES[kind].some(
    (rule) => rule.source === source && rule.target === target,
  );
}
