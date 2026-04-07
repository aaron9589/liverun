import { useEffect, useRef, useState } from 'react';
import mqtt from 'mqtt';

function parseClockTime(raw: string): number | null {
  let s = raw.trim();
  // Try JSON with a .value field (e.g. JMRI memory messages)
  try {
    const obj = JSON.parse(s);
    s = String(obj.value ?? obj.time ?? obj.Value ?? s).trim();
  } catch { /* not JSON */ }
  // Match HH:MM or H:MM (ignoring seconds / AM/PM suffix)
  const m = s.match(/(\d{1,2}):(\d{2})/);
  if (m) return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  return null;
}

export type ClockStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export function useFastClock(
  brokerUrl: string,
  topic: string,
  enabled: boolean
): { clockTime: number | null; status: ClockStatus; errorMessage: string | null } {
  const [clockTime, setClockTime] = useState<number | null>(null);
  const [status, setStatus] = useState<ClockStatus>('disconnected');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const clientRef = useRef<ReturnType<typeof mqtt.connect> | null>(null);

  useEffect(() => {
    if (!enabled || !brokerUrl) {
      setClockTime(null);
      setStatus('disconnected');
      setErrorMessage(null);
      return;
    }

    setStatus('connecting');
    setErrorMessage(null);

    let client: ReturnType<typeof mqtt.connect>;
    try {
      client = mqtt.connect(brokerUrl, {
        reconnectPeriod: 5000,
        protocolVersion: 4,
        clientId: `liverun_${Math.random().toString(16).slice(2, 10)}`,
        clean: true,
      });
    } catch (e) {
      setStatus('error');
      setErrorMessage(e instanceof Error ? e.message : String(e));
      return;
    }
    clientRef.current = client;

    client.on('connect', () => {
      setStatus('connected');
      setErrorMessage(null);
      client.subscribe(topic, { qos: 0 }, (err) => {
        if (err) {
          setStatus('error');
          setErrorMessage(`Subscribe failed: ${err.message}`);
        }
      });
    });

    client.on('message', (t, message) => {
      const raw = message.toString();
      const parsed = parseClockTime(raw);
      if (parsed !== null) {
        setClockTime(parsed);
      }
    });

    client.on('error', (err) => {
      setStatus('error');
      setErrorMessage(err.message);
      console.error('[useFastClock] MQTT error:', err);
    });

    client.on('close', () => {
      setStatus((prev) => prev !== 'error' ? 'disconnected' : prev);
    });

    return () => {
      client.end(true);
      clientRef.current = null;
      setClockTime(null);
      setStatus('disconnected');
      setErrorMessage(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, brokerUrl, topic]);

  return { clockTime, status, errorMessage };
}
