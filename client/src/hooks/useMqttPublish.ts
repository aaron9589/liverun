import { useCallback, useEffect, useRef, useState } from 'react';
import mqtt from 'mqtt';

export type PublishStatus = 'disabled' | 'connecting' | 'connected' | 'error';
const QUEUE_CAP = 50;

type Client = ReturnType<typeof mqtt.connect>;
const send = (c: Client, m: { topic: string; payload: string }) =>
  c.publish(m.topic, m.payload, { qos: 0, retain: false });

/**
 * One MQTT connection for publishing stats (spec §9). QoS 0, not retained. While
 * disconnected, messages wait in a small in-memory queue (oldest dropped) and are
 * flushed on reconnect. Does nothing unless `enabled` and a broker URL is set.
 */
export function useMqttPublish(brokerUrl: string, enabled: boolean) {
  const [status, setStatus] = useState<PublishStatus>('disabled');
  const clientRef = useRef<Client | null>(null);
  const queue = useRef<{ topic: string; payload: string }[]>([]);

  useEffect(() => {
    if (!enabled || !brokerUrl) { setStatus('disabled'); return; }
    setStatus('connecting');
    let client: Client;
    try {
      client = mqtt.connect(brokerUrl, {
        reconnectPeriod: 5000,
        protocolVersion: 4,
        clientId: `liverun_pub_${Math.random().toString(16).slice(2, 10)}`,
        clean: true,
      });
    } catch {
      setStatus('error');
      return;
    }
    clientRef.current = client;
    client.on('connect', () => {
      setStatus('connected');
      const pending = queue.current;
      queue.current = [];
      for (const m of pending) send(client, m);
    });
    client.on('error', () => setStatus('error'));
    client.on('close', () => setStatus((p) => (p === 'error' ? p : 'connecting')));
    return () => {
      client.end(true);
      clientRef.current = null;
    };
  }, [enabled, brokerUrl]);

  const publish = useCallback((topic: string, payload: string) => {
    const c = clientRef.current;
    if (c && c.connected) { send(c, { topic, payload }); return; }
    queue.current.push({ topic, payload });
    if (queue.current.length > QUEUE_CAP) queue.current.splice(0, queue.current.length - QUEUE_CAP);
  }, []);

  return { publish, status };
}
