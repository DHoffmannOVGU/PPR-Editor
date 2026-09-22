import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getCollaborationReconnectDelay,
  shouldForgetCollaborationSession,
} from './use-collaboration';

test('reconnect backoff increases after failures and caps the delay', () => {
  assert.equal(getCollaborationReconnectDelay(0), 750);
  assert.equal(getCollaborationReconnectDelay(1), 1500);
  assert.equal(getCollaborationReconnectDelay(4), 12000);
  assert.equal(getCollaborationReconnectDelay(5), 15000);
  assert.equal(getCollaborationReconnectDelay(99), 15000);
});

test('reconnect backoff normalizes invalid retry counts', () => {
  assert.equal(getCollaborationReconnectDelay(-2), 750);
  assert.equal(getCollaborationReconnectDelay(1.9), 1500);
});

test('stale or expired hosted sessions are removed instead of retried forever', () => {
  assert.equal(
    shouldForgetCollaborationSession(
      1008,
      'Your collaboration membership is invalid or has expired',
    ),
    true,
  );
  assert.equal(
    shouldForgetCollaborationSession(
      1008,
      'The collaboration session or access code is invalid',
    ),
    true,
  );
  assert.equal(
    shouldForgetCollaborationSession(1008, 'Origin is not allowed'),
    false,
  );
  assert.equal(shouldForgetCollaborationSession(1006, ''), false);
});
