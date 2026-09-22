import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PprElement, PprModel } from '@workspace/api-client-react';
import {
  getProcessSpecificationFilename,
  getProcessSpecificationSvg,
} from './process-specification-export';

function element(
  id: string,
  type: PprElement['type'],
  name: string,
  description?: string,
): PprElement {
  return {
    id,
    type,
    name,
    kind: type,
    description,
    attributes: [],
    x: 0,
    y: 0,
    visible_in_ppr: true,
  };
}

test('exports the process projection as deterministic SVG drawing', () => {
  const model: PprModel = {
    id: 'model',
    name: 'Assembly / Alpha',
    description: '',
    elements: [
      element('raw', 'product', 'Raw & input'),
      element('handoff', 'product', 'Intermediate bridge'),
      element('finish', 'product', 'Finished output'),
      element('orphan', 'product', 'Orphan product'),
      element('cut', 'process', 'Cut'),
      element('weld', 'process', 'Weld', 'Join the prepared parts'),
      element('sub', 'process', 'Contained weld'),
      element('cycle-a', 'process', 'Cycle A'),
      element('cycle-b', 'process', 'Cycle B'),
    ],
    relationships: [
      { id: 'raw-cut', source_id: 'raw', target_id: 'cut', kind: 'consumed_by' },
      { id: 'cut-handoff', source_id: 'cut', target_id: 'handoff', kind: 'produces' },
      { id: 'handoff-weld', source_id: 'handoff', target_id: 'weld', kind: 'consumed_by' },
      { id: 'weld-finish', source_id: 'weld', target_id: 'finish', kind: 'produces' },
      { id: 'weld-sub', source_id: 'weld', target_id: 'sub', kind: 'contains' },
      { id: 'cycle-a-b', source_id: 'cycle-a', target_id: 'cycle-b', kind: 'contains' },
      { id: 'cycle-b-a', source_id: 'cycle-b', target_id: 'cycle-a', kind: 'contains' },
    ],
  };

  const first = getProcessSpecificationSvg(model);
  const second = getProcessSpecificationSvg(model);

  assert.equal(first, second);
  assert.match(first, /Raw &amp; input/);
  assert.match(first, /MATERIAL BRIDGE · Intermediate bridge/);
  assert.match(first, /EXTERNAL INPUTS/);
  assert.match(first, /TERMINAL OUTPUTS/);
  assert.match(first, /STANDALONE PRODUCTS/);
  assert.match(first, /CONTAINED SUBPROCESSES/);
  assert.match(first, /CYCLE BOUNDARY/);
  assert.equal(getProcessSpecificationFilename(model), 'assembly-alpha-process-specification.svg');
});
