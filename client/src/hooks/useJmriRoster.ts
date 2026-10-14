import { useCallback, useEffect, useState } from 'react';
import type { JmriRosterEntry } from '../types';
import { fetchRoster, jmriHttpBase } from '../lib/jmri';

export type RosterStatus = 'unconfigured' | 'loading' | 'ready' | 'error';

export interface JmriRoster {
  entries: JmriRosterEntry[];
  status: RosterStatus;
  refresh: () => void;
}

// Module-level cache so repeated editor opens don't refetch.
const cache = new Map<string, JmriRosterEntry[]>();

export function useJmriRoster(wsUrl: string | undefined): JmriRoster {
  const configured = !!wsUrl && jmriHttpBase(wsUrl) !== null;
  const [entries, setEntries] = useState<JmriRosterEntry[]>(() => (wsUrl ? cache.get(wsUrl) ?? [] : []));
  const [status, setStatus] = useState<RosterStatus>(() =>
    !configured ? 'unconfigured' : wsUrl && cache.has(wsUrl) ? 'ready' : 'loading');
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!wsUrl || !configured) { setEntries([]); setStatus('unconfigured'); return; }
    const cached = nonce === 0 ? cache.get(wsUrl) : undefined;
    if (cached) { setEntries(cached); setStatus('ready'); return; }
    const ctrl = new AbortController();
    setStatus('loading');
    fetchRoster(wsUrl, ctrl.signal)
      .then((r) => { cache.set(wsUrl, r); setEntries(r); setStatus('ready'); })
      .catch(() => { if (!ctrl.signal.aborted) { setEntries([]); setStatus('error'); } });
    return () => ctrl.abort();
  }, [wsUrl, configured, nonce]);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);
  return { entries, status, refresh };
}
