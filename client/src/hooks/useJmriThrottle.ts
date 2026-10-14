export type JmriStatus = 'unconfigured' | 'connecting' | 'connected' | 'error';

export interface JmriThrottle {
  /** State of the browser → JMRI JSON WebSocket. */
  status: JmriStatus;
  /** True once JMRI has confirmed a throttle for the current roster entry. */
  acquired: boolean;
  /** Function states as last reported by JMRI for this throttle (fn number → on). */
  functions: Record<number, boolean>;
  /** Sends F<fn>=on. Returns false and sends nothing unless acquired — commands are never queued. */
  setFunction: (fn: number, on: boolean) => boolean;
  error: string | null;
}

/**
 * Browser-side JMRI throttle (docs/guard-panel-spec.md §7.1).
 *
 * CONTRACT STUB — never connects. Phase 3A replaces the internals: open
 * `wsUrl` (JMRI JSON server), heartbeat per JMRI's hello, reconnect with
 * backoff, acquire `{type:'throttle', data:{name: throttleName, rosterEntry}}`
 * when rosterEntryName is set, release on change/unmount/pagehide, re-acquire
 * after reconnect, track reported F states. The signature must not change.
 */
export function useJmriThrottle(
  wsUrl: string | undefined,
  rosterEntryName: string | null,
  throttleName: string,
): JmriThrottle {
  void wsUrl; void rosterEntryName; void throttleName;
  return { status: 'unconfigured', acquired: false, functions: {}, setFunction: () => false, error: null };
}
