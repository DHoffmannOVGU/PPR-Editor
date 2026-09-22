import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetModelQueryKey,
  setCollaborationCredentials,
  type PprModel,
} from '@workspace/api-client-react';

export type CollaborationCursor = { x: number; y: number };
export type CollaborationSurface = 'library' | 'graph' | 'levels' | 'item' | 'process' | 'product' | 'resource';
export const COLLABORATION_SURFACE_LABELS: Record<CollaborationSurface, string> = {
  library: 'Library',
  graph: 'Graph',
  levels: 'PPR Levels',
  item: 'Item lifecycles',
  process: 'Process',
  product: 'Product',
  resource: 'Resource',
};
export type CollaborationParticipant = {
  id: string;
  name: string;
  color: string;
  cursor?: CollaborationCursor | null;
  surface?: CollaborationSurface | null;
  selection?: string[];
};
export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'error';
export type CollaborationSyncState = 'synced' | 'pending' | 'conflict';

type ActiveSession = {
  sessionId: string;
  code: string;
  memberToken?: string;
  ownerToken?: string;
  role?: 'owner' | 'editor' | 'viewer';
  expiresAt: string;
  displayName: string;
};

export type CollaborationIdentity = {
  id: string;
  display_name: string;
};

type CreateResponse = {
  session_id: string;
  code: string;
  owner_token: string;
  member_token?: string;
  role?: 'owner' | 'editor' | 'viewer';
  expires_at: string;
};

type JoinResponse = {
  session_id: string;
  expires_at: string;
  revision: number;
  participant_count: number;
  model: PprModel;
  member_token?: string;
  role?: 'owner' | 'editor' | 'viewer';
};

type PendingModelUpdate = {
  model: PprModel;
  baseRevision: number;
  clientUpdateId: string;
};

export type CollaborationRecovery = {
  localModel: PprModel;
  serverModel: PprModel;
  message: string;
};

const STORAGE_KEY = 'ppr-collaboration-session';
const MAX_RECONNECT_DELAY_MS = 15000;
const MODEL_QUERY_KEY = getGetModelQueryKey();

export function getCollaborationReconnectDelay(attempt: number) {
  const normalizedAttempt = Math.max(0, Math.floor(attempt));
  return Math.min(MAX_RECONNECT_DELAY_MS, 750 * 2 ** normalizedAttempt);
}

export function shouldForgetCollaborationSession(code: number, reason: string) {
  const normalizedReason = reason.trim().toLowerCase();
  return code === 4001
    || normalizedReason.includes('has expired')
    || normalizedReason.includes('invalid or has expired')
    || normalizedReason.includes('session or access code is invalid');
}

function restoredSession(): ActiveSession | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    const session = raw ? JSON.parse(raw) as ActiveSession : null;
    if (!session || new Date(session.expiresAt).getTime() <= Date.now()) {
      sessionStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

function modelFingerprint(model: PprModel): string {
  return JSON.stringify(model);
}

function newClientUpdateId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `update-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function responseError(response: Response): Promise<Error> {
  const payload = await response.json().catch(() => undefined) as { detail?: { error?: string } | string } | undefined;
  const detail = typeof payload?.detail === 'string' ? payload.detail : payload?.detail?.error;
  return new Error(detail || `Collaboration request failed (${response.status})`);
}

export function useCollaboration(model: PprModel | undefined) {
  const queryClient = useQueryClient();
  const queryKey = MODEL_QUERY_KEY;
  const [session, setSession] = useState<ActiveSession | null>(restoredSession);
  const [identity, setIdentity] = useState<CollaborationIdentity | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>(session ? 'connecting' : 'idle');
  const [participants, setParticipants] = useState<CollaborationParticipant[]>([]);
  const [participantId, setParticipantId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncState, setSyncState] = useState<CollaborationSyncState>('synced');
  const [recovery, setRecovery] = useState<CollaborationRecovery | null>(null);
  const recoveryRef = useRef<CollaborationRecovery | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const suppressNextBroadcast = useRef<string | null>(null);
  const revisionRef = useRef(0);
  const sessionReadyRef = useRef(false);
  const lastSyncedFingerprintRef = useRef<string | null>(null);
  const pendingUpdateRef = useRef<PendingModelUpdate | null>(null);
  const inFlightUpdateRef = useRef<PendingModelUpdate | null>(null);
  const lastSentUpdateRef = useRef<PendingModelUpdate | null>(null);
  const cursorTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pendingCursorRef = useRef<CollaborationCursor | null | undefined>(undefined);
  const latestCursorRef = useRef<CollaborationCursor | null | undefined>(undefined);
  const surfaceTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pendingSurfaceRef = useRef<CollaborationSurface | null | undefined>(undefined);
  const activeSurfaceRef = useRef<CollaborationSurface | null>(null);
  const selectionTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pendingSelectionRef = useRef<string[] | undefined>(undefined);
  const activeSelectionRef = useRef<string[] | undefined>(undefined);
  const participantIdRef = useRef<string | null>(null);
  const terminalFailureRef = useRef(false);

  const sendPendingUpdate = useCallback(() => {
    const socket = socketRef.current;
    const pending = pendingUpdateRef.current;
    if (
      !pending
      || inFlightUpdateRef.current
      || !socket
      || socket.readyState !== WebSocket.OPEN
    ) {
      return;
    }
    inFlightUpdateRef.current = pending;
    lastSentUpdateRef.current = pending;
    try {
      socket.send(JSON.stringify({
        type: 'model.update',
        baseRevision: pending.baseRevision,
        clientUpdateId: pending.clientUpdateId,
        model: pending.model,
      }));
    } catch {
      inFlightUpdateRef.current = null;
      socket.close();
    }
  }, []);

  const deactivateLocal = useCallback(async () => {
    socketRef.current?.close();
    socketRef.current = null;
    if (cursorTimerRef.current) clearTimeout(cursorTimerRef.current);
    if (surfaceTimerRef.current) clearTimeout(surfaceTimerRef.current);
    if (selectionTimerRef.current) clearTimeout(selectionTimerRef.current);
    pendingCursorRef.current = undefined;
    latestCursorRef.current = undefined;
    pendingSurfaceRef.current = undefined;
    activeSurfaceRef.current = null;
    pendingSelectionRef.current = undefined;
    activeSelectionRef.current = undefined;
    participantIdRef.current = null;
    setParticipantId(null);
    sessionStorage.removeItem(STORAGE_KEY);
    setCollaborationCredentials(null);
    setSession(null);
    setParticipants([]);
    setStatus('idle');
    setSyncState('synced');
    setRecovery(null);
    recoveryRef.current = null;
    pendingUpdateRef.current = null;
    inFlightUpdateRef.current = null;
    lastSentUpdateRef.current = null;
    sessionReadyRef.current = false;
    lastSyncedFingerprintRef.current = null;
    suppressNextBroadcast.current = null;
    terminalFailureRef.current = false;
    const url = new URL(window.location.href);
    url.searchParams.delete('session');
    url.searchParams.delete('code');
    window.history.replaceState({}, '', url);
    await queryClient.invalidateQueries({ queryKey });
  }, [queryClient, queryKey]);

  const activate = useCallback((next: ActiveSession, initialModel?: PprModel, initialRevision = 0) => {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setCollaborationCredentials({
      sessionId: next.sessionId,
      code: next.code,
      token: next.memberToken,
    });
    setSession(next);
    setStatus('connecting');
    setError(null);
    setSyncState('synced');
    setRecovery(null);
    recoveryRef.current = null;
    pendingUpdateRef.current = null;
    inFlightUpdateRef.current = null;
    lastSentUpdateRef.current = null;
    revisionRef.current = initialRevision;
    sessionReadyRef.current = Boolean(initialModel);
    lastSyncedFingerprintRef.current = initialModel ? modelFingerprint(initialModel) : null;
    suppressNextBroadcast.current = initialModel ? modelFingerprint(initialModel) : null;
    if (initialModel) {
      queryClient.setQueryData(queryKey, initialModel);
    } else {
      queryClient.invalidateQueries({ queryKey });
    }
  }, [queryClient, queryKey]);

  useEffect(() => {
    if (session) {
      setCollaborationCredentials({
        sessionId: session.sessionId,
        code: session.code,
        token: session.memberToken,
      });
    }
  }, [session]);

  const ensureIdentity = useCallback(async () => {
    const response = await fetch('/api/auth/session', { credentials: 'include' });
    if (!response.ok) throw await responseError(response);
    const nextIdentity = await response.json() as CollaborationIdentity;
    setIdentity(nextIdentity);
    return nextIdentity;
  }, []);

  useEffect(() => {
    void ensureIdentity().catch((identityError) => {
      setError(identityError instanceof Error ? identityError.message : 'Could not establish an authenticated identity');
    });
  }, [ensureIdentity]);

  useEffect(() => {
    if (!session || !identity) return;
    let stopped = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let reconnectAttempt = 0;
    let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
    let heartbeatTimeout: ReturnType<typeof setTimeout> | undefined;

    const clearHeartbeat = () => {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      if (heartbeatTimeout) clearTimeout(heartbeatTimeout);
      heartbeatTimer = undefined;
      heartbeatTimeout = undefined;
    };

    const startHeartbeat = (socket: WebSocket) => {
      clearHeartbeat();
      heartbeatTimer = setInterval(() => {
        if (socket.readyState !== WebSocket.OPEN) return;
        socket.send(JSON.stringify({ type: 'ping' }));
        if (heartbeatTimeout) clearTimeout(heartbeatTimeout);
        heartbeatTimeout = setTimeout(() => {
          if (socket === socketRef.current && socket.readyState === WebSocket.OPEN) socket.close();
        }, 10000);
      }, 15000);
    };

    const sendPendingSurface = () => {
      const socket = socketRef.current;
      const surface = pendingSurfaceRef.current;
      if (surface === undefined || !socket || socket.readyState !== WebSocket.OPEN) return;
      pendingSurfaceRef.current = undefined;
      try {
        socket.send(JSON.stringify({ type: 'surface.update', surface }));
      } catch {
        pendingSurfaceRef.current = surface;
        socket.close();
      }
    };

    const scheduleReconnect = () => {
      if (stopped || reconnectTimer) return;
      const delay = getCollaborationReconnectDelay(reconnectAttempt);
      reconnectAttempt += 1;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = undefined;
        connect();
      }, delay);
    };

    const connect = () => {
      if (stopped) return;
      terminalFailureRef.current = false;
      const currentSocket = socketRef.current;
      if (currentSocket && (currentSocket.readyState === WebSocket.OPEN || currentSocket.readyState === WebSocket.CONNECTING)) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
       const query = new URLSearchParams({ name: session.displayName });
       const socketUrl = `${protocol}//${window.location.host}/api/collaboration/ws/${session.sessionId}?${query}`;
       const socket = session.memberToken
         ? new WebSocket(socketUrl, ['ppr-collaboration-v1', session.memberToken])
         : new WebSocket(`${socketUrl}&code=${encodeURIComponent(session.code)}`);
      socketRef.current = socket;
      socket.onopen = () => {
        if (stopped || socket !== socketRef.current) return;
        reconnectAttempt = 0;
        setStatus('connected');
        if (!recoveryRef.current) setError(null);
        startHeartbeat(socket);
        if (latestCursorRef.current) {
          socket.send(JSON.stringify({
            type: 'cursor.move',
            cursor: latestCursorRef.current,
          }));
        }
        pendingSurfaceRef.current = activeSurfaceRef.current;
        sendPendingSurface();
        if (activeSelectionRef.current !== undefined) {
          socket.send(JSON.stringify({
            type: 'selection.update',
            selection: activeSelectionRef.current,
          }));
        }
      };
      socket.onmessage = (event) => {
        const message = JSON.parse(event.data) as {
          type: string;
          model?: PprModel;
          participants?: CollaborationParticipant[];
          participantId?: string;
          cursor?: CollaborationCursor | null;
          surface?: CollaborationSurface | null;
          selection?: string[];
          message?: string;
          revision?: number;
          clientUpdateId?: string;
        };
        if (socket !== socketRef.current) return;
        if (message.type === 'session.ready') {
          participantIdRef.current = message.participantId ?? null;
          setParticipantId(message.participantId ?? null);
          revisionRef.current = message.revision ?? 0;
          sessionReadyRef.current = true;
          setStatus('connected');
          setParticipants((message.participants ?? []).map((participant) =>
            participant.id === participantIdRef.current && activeSurfaceRef.current
              ? { ...participant, surface: activeSurfaceRef.current }
              : participant,
          ));
          setParticipants((current) => current.map((participant) =>
            participant.id === participantIdRef.current && activeSelectionRef.current !== undefined
              ? { ...participant, selection: activeSelectionRef.current }
              : participant,
          ));
          if (latestCursorRef.current) {
            socket.send(JSON.stringify({
              type: 'cursor.move',
              cursor: latestCursorRef.current,
            }));
          }
          if (!recoveryRef.current) setError(null);
          const pending = pendingUpdateRef.current;
          const lastSent = lastSentUpdateRef.current;
          if (message.model && pending) {
            const readyFingerprint = modelFingerprint(message.model);
            if (readyFingerprint === modelFingerprint(pending.model)) {
              pendingUpdateRef.current = null;
              inFlightUpdateRef.current = null;
              lastSentUpdateRef.current = null;
              setSyncState('synced');
              setRecovery(null);
              recoveryRef.current = null;
              setError(null);
              suppressNextBroadcast.current = readyFingerprint;
              lastSyncedFingerprintRef.current = readyFingerprint;
              queryClient.setQueryData(queryKey, message.model);
            } else {
              if (
                lastSent
                && readyFingerprint === modelFingerprint(lastSent.model)
                && pending.clientUpdateId !== lastSent.clientUpdateId
              ) {
                pendingUpdateRef.current = {
                  ...pending,
                  baseRevision: revisionRef.current,
                };
              }
              setSyncState('pending');
              sendPendingUpdate();
            }
          } else if (message.model) {
            suppressNextBroadcast.current = modelFingerprint(message.model);
            queryClient.setQueryData(queryKey, message.model);
          }
        } else if (message.type === 'model.updated' && message.model) {
          revisionRef.current = message.revision ?? revisionRef.current;
          const pending = pendingUpdateRef.current;
          if (pending && modelFingerprint(pending.model) !== modelFingerprint(message.model)) {
            return;
          }
          pendingUpdateRef.current = null;
          inFlightUpdateRef.current = null;
          lastSentUpdateRef.current = null;
          setSyncState('synced');
          setRecovery(null);
          recoveryRef.current = null;
          suppressNextBroadcast.current = modelFingerprint(message.model);
          lastSyncedFingerprintRef.current = modelFingerprint(message.model);
          queryClient.setQueryData(queryKey, message.model);
        } else if (message.type === 'model.ack') {
          revisionRef.current = message.revision ?? revisionRef.current;
          const inFlight = inFlightUpdateRef.current;
          if (
            inFlight
            && (!message.clientUpdateId || message.clientUpdateId === inFlight.clientUpdateId)
          ) {
            const pending = pendingUpdateRef.current;
            inFlightUpdateRef.current = null;
            if (!pending || pending.clientUpdateId === inFlight.clientUpdateId) {
              pendingUpdateRef.current = null;
              lastSentUpdateRef.current = null;
              setSyncState('synced');
              setRecovery(null);
              recoveryRef.current = null;
            } else {
              pendingUpdateRef.current = {
                ...pending,
                baseRevision: revisionRef.current,
              };
              setSyncState('pending');
              sendPendingUpdate();
            }
          }
        } else if (message.type === 'model.conflict' && message.model) {
          revisionRef.current = message.revision ?? revisionRef.current;
          const pending = pendingUpdateRef.current;
          inFlightUpdateRef.current = null;
          if (pending) {
            const nextRecovery = {
              localModel: pending.model,
              serverModel: message.model,
              message: message.message || 'A newer collaboration revision replaced this edit',
            };
            setSyncState('conflict');
            setRecovery(nextRecovery);
            recoveryRef.current = nextRecovery;
          }
          setError(message.message || 'A newer collaboration revision is available');
        } else if (message.type === 'presence.updated') {
          setParticipants(message.participants ?? []);
        } else if (message.type === 'cursor.updated' && message.participantId) {
          setParticipants((current) => current.map((participant) =>
            participant.id === message.participantId
              ? { ...participant, cursor: message.cursor ?? null }
              : participant,
          ));
        } else if (message.type === 'surface.updated' && message.participantId) {
          setParticipants((current) => current.map((participant) =>
            participant.id === message.participantId
              ? { ...participant, surface: message.surface ?? null }
              : participant,
          ));
        } else if (message.type === 'selection.updated' && message.participantId) {
          setParticipants((current) => current.map((participant) =>
            participant.id === message.participantId
              ? { ...participant, selection: message.selection ?? [] }
              : participant,
          ));
        } else if (message.type === 'ping') {
          socket.send(JSON.stringify({ type: 'pong' }));
        } else if (message.type === 'pong') {
          if (heartbeatTimeout) clearTimeout(heartbeatTimeout);
          heartbeatTimeout = undefined;
        } else if (message.type === 'session.closed') {
          setError('The session owner closed this collaboration session');
          void deactivateLocal();
         } else if (message.type === 'session.expired') {
           terminalFailureRef.current = true;
           setStatus('error');
           setError(message.message || 'Your collaboration membership has expired. Rejoin to continue.');
           socket.close();
        } else if (message.type === 'error') {
          setError(message.message || 'Collaboration update was rejected');
        }
      };
      socket.onerror = (event) => {
        // The close event carries the actionable status code and reason. Avoid
        // racing it with the browser's generic, detail-free error event.
        event.preventDefault();
        if (socket === socketRef.current) setStatus('reconnecting');
      };
       socket.onclose = (event) => {
        if (socket !== socketRef.current) return;
        clearHeartbeat();
        socketRef.current = null;
        if (stopped) return;
         if (shouldForgetCollaborationSession(event.code, event.reason)) {
           terminalFailureRef.current = true;
           void deactivateLocal();
           return;
         }
         if (terminalFailureRef.current || event.code === 1008 || event.code === 4001) {
           setStatus('error');
           setError(event.code === 4001
             ? 'Your collaboration membership has expired. Rejoin to continue.'
             : 'You are not authorized for this collaboration session.');
           return;
         }
        if (inFlightUpdateRef.current) {
          if (
            !pendingUpdateRef.current
            || pendingUpdateRef.current.clientUpdateId === inFlightUpdateRef.current.clientUpdateId
          ) {
            pendingUpdateRef.current = inFlightUpdateRef.current;
          }
          inFlightUpdateRef.current = null;
        }
        if (pendingUpdateRef.current && !recoveryRef.current) setSyncState('pending');
        setStatus('reconnecting');
        scheduleReconnect();
      };
    };

    connect();
    return () => {
      stopped = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      clearHeartbeat();
      if (socketRef.current) socketRef.current.close();
      socketRef.current = null;
    };
  }, [deactivateLocal, identity, queryClient, queryKey, sendPendingUpdate, session]);

  useEffect(() => {
    if (!session || !model || !sessionReadyRef.current) return;
    const fingerprint = modelFingerprint(model);
    if (suppressNextBroadcast.current === fingerprint) {
      suppressNextBroadcast.current = null;
      return;
    }
    if (!pendingUpdateRef.current && lastSyncedFingerprintRef.current === fingerprint) return;
    const pending = pendingUpdateRef.current;
    const inFlight = inFlightUpdateRef.current;
    const isSameInFlight = Boolean(
      pending && inFlight && pending.clientUpdateId === inFlight.clientUpdateId
    );
    pendingUpdateRef.current = {
      model,
      baseRevision: pending && !isSameInFlight ? pending.baseRevision : revisionRef.current,
      clientUpdateId: pending && !isSameInFlight
        ? pending.clientUpdateId
        : newClientUpdateId(),
    };
    setSyncState('pending');
    setRecovery(null);
    recoveryRef.current = null;
    const timer = setTimeout(() => {
      sendPendingUpdate();
    }, 120);
    return () => clearTimeout(timer);
  }, [model, sendPendingUpdate, session]);

  const updateCursor = useCallback((cursor: CollaborationCursor | null) => {
    latestCursorRef.current = cursor;
    pendingCursorRef.current = cursor;
    if (cursorTimerRef.current) return;
    cursorTimerRef.current = setTimeout(() => {
      cursorTimerRef.current = undefined;
      const nextCursor = pendingCursorRef.current;
      pendingCursorRef.current = undefined;
      const socket = socketRef.current;
      if (!socket || socket.readyState !== WebSocket.OPEN || nextCursor === undefined) return;
      socket.send(JSON.stringify({
        type: nextCursor ? 'cursor.move' : 'cursor.clear',
        ...(nextCursor ? { cursor: nextCursor } : {}),
      }));
    }, 50);
  }, []);

  const updateSurface = useCallback((surface: CollaborationSurface | null) => {
    activeSurfaceRef.current = surface;
    pendingSurfaceRef.current = surface;
    if (participantIdRef.current) {
      setParticipants((current) => current.map((participant) =>
        participant.id === participantIdRef.current
          ? { ...participant, surface }
          : participant,
      ));
    }
    if (surfaceTimerRef.current) return;
    surfaceTimerRef.current = setTimeout(() => {
      surfaceTimerRef.current = undefined;
      const nextSurface = pendingSurfaceRef.current;
      if (nextSurface === undefined) return;
      const socket = socketRef.current;
      if (!socket || socket.readyState !== WebSocket.OPEN) return;
      pendingSurfaceRef.current = undefined;
      try {
        socket.send(JSON.stringify({ type: 'surface.update', surface: nextSurface }));
      } catch {
        pendingSurfaceRef.current = nextSurface;
        socket.close();
      }
    }, 120);
  }, []);

  const updateSelection = useCallback((selection: string[]) => {
    const nextSelection = [...new Set(selection)];
    activeSelectionRef.current = nextSelection;
    pendingSelectionRef.current = nextSelection;
    if (participantIdRef.current) {
      setParticipants((current) => current.map((participant) =>
        participant.id === participantIdRef.current
          ? { ...participant, selection: nextSelection }
          : participant,
      ));
    }
    if (selectionTimerRef.current) return;
    selectionTimerRef.current = setTimeout(() => {
      selectionTimerRef.current = undefined;
      const next = pendingSelectionRef.current;
      if (next === undefined) return;
      const socket = socketRef.current;
      if (!socket || socket.readyState !== WebSocket.OPEN) return;
      pendingSelectionRef.current = undefined;
      try {
        socket.send(JSON.stringify({ type: 'selection.update', selection: next }));
      } catch {
        pendingSelectionRef.current = next;
        socket.close();
      }
    }, 80);
  }, []);

  const retryPendingUpdate = useCallback(() => {
    const pending = pendingUpdateRef.current;
    if (!pending) return;
    pendingUpdateRef.current = {
      ...pending,
      baseRevision: revisionRef.current,
      clientUpdateId: newClientUpdateId(),
    };
    inFlightUpdateRef.current = null;
    lastSentUpdateRef.current = null;
    setSyncState('pending');
    setRecovery(null);
    recoveryRef.current = null;
    setError(null);
    sendPendingUpdate();
  }, [sendPendingUpdate]);

  const discardPendingUpdate = useCallback(() => {
    const currentRecovery = recoveryRef.current;
    if (!currentRecovery) return;
    pendingUpdateRef.current = null;
    inFlightUpdateRef.current = null;
    lastSentUpdateRef.current = null;
    setSyncState('synced');
    setRecovery(null);
    recoveryRef.current = null;
    setError(null);
    suppressNextBroadcast.current = modelFingerprint(currentRecovery.serverModel);
    lastSyncedFingerprintRef.current = modelFingerprint(currentRecovery.serverModel);
    queryClient.setQueryData(queryKey, currentRecovery.serverModel);
  }, [queryClient, queryKey]);

  const create = useCallback(async (displayName: string) => {
    await ensureIdentity();
    const response = await fetch('/api/collaboration/sessions', {
      method: 'POST',
      credentials: 'include',
    });
    if (!response.ok) throw await responseError(response);
    const created = await response.json() as CreateResponse;
    activate({
      sessionId: created.session_id,
      code: created.code,
      memberToken: created.member_token || created.owner_token,
      ownerToken: created.owner_token,
      role: created.role || 'owner',
      expiresAt: created.expires_at,
      displayName,
    });
  }, [activate, ensureIdentity]);

  const join = useCallback(async (sessionId: string, code: string, displayName: string) => {
    await ensureIdentity();
    const response = await fetch('/api/collaboration/join', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId, code }),
    });
    if (!response.ok) throw await responseError(response);
    const joined = await response.json() as JoinResponse;
    activate({
      sessionId: joined.session_id,
      code,
      memberToken: joined.member_token,
      role: joined.role || 'editor',
      expiresAt: joined.expires_at,
      displayName,
    }, joined.model, joined.revision);
  }, [activate, ensureIdentity]);

  const leave = useCallback(async (closeForEveryone = false) => {
    if (closeForEveryone && session?.ownerToken) {
      const response = await fetch(`/api/collaboration/sessions/${session.sessionId}/close`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-Collaboration-Session': session.sessionId,
          ...(session.memberToken ? { 'X-Collaboration-Token': session.memberToken } : {}),
        },
        body: JSON.stringify({}),
      });
      if (!response.ok) throw await responseError(response);
    }
    await deactivateLocal();
  }, [deactivateLocal, session]);

  const invite = useMemo(() => {
    if (!session) return null;
    const url = new URL(window.location.href);
    url.searchParams.set('session', session.sessionId);
    return { url: url.toString(), sessionId: session.sessionId, code: session.code };
  }, [session]);

  return {
    session,
    identity,
    status,
    participants,
    participantId,
    error,
    invite,
    updateCursor,
    updateSurface,
    updateSelection,
    syncState,
    recovery,
    retryPendingUpdate,
    discardPendingUpdate,
    create,
    join,
    leave,
  };
}

export type CollaborationController = ReturnType<typeof useCollaboration>;
