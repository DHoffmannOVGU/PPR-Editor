import assert from 'node:assert/strict';
import test from 'node:test';
import type { PprElement } from '@workspace/api-client-react';
import { getIndividualViewRelationshipKind, getQuickConnectionSpec } from './ppr-editing';

function usage(type: PprElement['type']): PprElement {
  return {
    id: type,
    name: type,
    type,
    kind: 'usage',
    definition_id: null,
    description: '',
    attributes: [],
    x: 0,
    y: 0,
    visible_in_ppr: true,
  };
}

test('maps PPR handles to their fitting next element type', () => {
  assert.deepEqual(getQuickConnectionSpec(usage('product'), 'source-bottom', 'ppr', 'ppr'), {
    type: 'process',
  });
  assert.deepEqual(getQuickConnectionSpec(usage('process'), 'source-bottom', 'ppr', 'ppr'), {
    type: 'product',
  });
  assert.deepEqual(getQuickConnectionSpec(usage('process'), 'source-right', 'ppr', 'ppr'), {
    type: 'resource',
  });
  assert.equal(getQuickConnectionSpec(usage('resource'), 'source-bottom', 'ppr', 'ppr'), null);
});

test('maps individual-view handles to a same-type node and tree relationship', () => {
  assert.deepEqual(getQuickConnectionSpec(usage('product'), 'source-bottom', 'product', 'ppr'), {
    type: 'product',
    kind: 'becomes',
  });
  assert.deepEqual(getQuickConnectionSpec(usage('product'), 'source-bottom', 'product', 'bom'), {
    type: 'product',
    kind: 'contains',
  });
  assert.deepEqual(getQuickConnectionSpec(usage('process'), 'source-bottom', 'process', 'ppr'), {
    type: 'process',
    kind: 'succeeds',
  });
  assert.equal(getQuickConnectionSpec(usage('process'), 'source-right', 'process', 'ppr'), null);
  assert.deepEqual(getQuickConnectionSpec(usage('resource'), 'source-bottom', 'resource', 'ppr'), {
    type: 'resource',
    kind: 'contains',
  });
});

test('uses the same relationship semantics when connecting existing lens nodes', () => {
  assert.equal(getIndividualViewRelationshipKind('ppr', 'ppr'), null);
  assert.equal(getIndividualViewRelationshipKind('product', 'ppr'), 'becomes');
  assert.equal(getIndividualViewRelationshipKind('product', 'bom'), 'contains');
  assert.equal(getIndividualViewRelationshipKind('process', 'ppr'), 'succeeds');
  assert.equal(getIndividualViewRelationshipKind('resource', 'ppr'), 'contains');
});
