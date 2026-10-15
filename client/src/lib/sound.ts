import { soundUrl } from '../api';
import { getAudioContext } from './audio';

// Sound-library playback through the shared Web Audio context (unlocked by
// "Tap to start"). More reliable on iOS than <audio> once the context is running.

export interface SoundHandle {
  /** Resolves when playback finishes, is stopped, fails to load/decode, or the file is '' (silent). */
  ended: Promise<void>;
  stop: () => void;
}

const buffers = new Map<string, Promise<AudioBuffer>>();

function load(ctx: BaseAudioContext, file: string): Promise<AudioBuffer> {
  let p = buffers.get(file);
  if (!p) {
    const fresh: Promise<AudioBuffer> = fetch(soundUrl(file))
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.arrayBuffer();
      })
      .then((data) => ctx.decodeAudioData(data));
    // Don't cache failures — a later press can retry.
    fresh.catch(() => { if (buffers.get(file) === fresh) buffers.delete(file); });
    buffers.set(file, fresh);
    p = fresh;
  }
  return p;
}

/** Test hook: forget decoded buffers. */
export function clearSoundCache(): void {
  buffers.clear();
}

export function playSound(file: string): SoundHandle {
  if (!file) return { ended: Promise.resolve(), stop: () => {} };
  let stopped = false;
  let source: AudioBufferSourceNode | null = null;
  let finish: () => void = () => {};
  const ended = new Promise<void>((resolve) => { finish = resolve; });

  const ctx = getAudioContext();
  if (!ctx) {
    console.warn(`[sound] no audio context; skipping ${file}`);
    finish();
    return { ended, stop: () => {} };
  }

  load(ctx, file)
    .then((buffer) => {
      if (stopped) return finish();
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(ctx.destination);
      src.onended = () => finish();
      source = src;
      src.start(0);
    })
    .catch((err: unknown) => {
      console.error(`[sound] could not play ${file}`, err);
      finish();
    });

  return {
    ended,
    stop: () => {
      stopped = true;
      try { source?.stop(); } catch { /* not started / already stopped */ }
      finish();
    },
  };
}
