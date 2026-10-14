// Shared audio + wake-lock helpers for the guard panel. Browsers only allow audio
// after a user gesture, so the panel calls unlockAudio() from its "Tap to start" overlay
// and later phases (sounds, bell) reuse the same AudioContext.

let ctx: AudioContext | null = null;

type AudioCtor = typeof AudioContext;

/** The shared AudioContext (created lazily), or null if unsupported. */
export function getAudioContext(): AudioContext | null {
  if (ctx) return ctx;
  const w = window as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor };
  const Ctor = w.AudioContext ?? w.webkitAudioContext;
  if (!Ctor) return null;
  try { ctx = new Ctor(); } catch { ctx = null; }
  return ctx;
}

/** Create/resume the shared context and play a silent buffer. Call from a user gesture. */
export async function unlockAudio(): Promise<void> {
  const c = getAudioContext();
  if (!c) return;
  try {
    if (c.state === 'suspended') await c.resume();
    const src = c.createBufferSource();
    src.buffer = c.createBuffer(1, 1, 22050);
    src.connect(c.destination);
    src.start(0);
  } catch { /* fail silently */ }
}

interface WakeLockSentinelLike { release: () => Promise<void> }
interface WakeLockNavigator { wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinelLike> } }

let visibilityHooked = false;
let wakeLockWanted = false;

async function acquire(): Promise<void> {
  const wl = (navigator as unknown as WakeLockNavigator).wakeLock;
  if (!wl || !wakeLockWanted) return;
  try { await wl.request('screen'); } catch { /* fail silently */ }
}

/** Request a screen wake lock and keep re-requesting it when the page becomes visible again. */
export function requestWakeLock(): void {
  wakeLockWanted = true;
  void acquire();
  if (visibilityHooked) return;
  visibilityHooked = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void acquire();
  });
}
