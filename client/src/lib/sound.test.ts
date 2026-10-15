import { beforeEach, describe, expect, it, vi } from 'vitest';

const ctxHolder = vi.hoisted(() => ({ ctx: null as unknown }));
vi.mock('./audio', () => ({ getAudioContext: () => ctxHolder.ctx }));
vi.mock('../api', () => ({ soundUrl: (f: string) => `/api/sounds/${f}` }));

import { clearSoundCache, playSound } from './sound';

interface FakeSource { buffer: unknown; onended: (() => void) | null; connect: () => void; start: () => void; stop: () => void }

function fakeCtx() {
  const starts: number[] = [];
  const ctx = {
    destination: {},
    decodeAudioData: vi.fn(async () => ({ duration: 1 })),
    createBufferSource: (): FakeSource => {
      const src: FakeSource = {
        buffer: null, onended: null, connect: () => {},
        start: () => { starts.push(1); setTimeout(() => src.onended?.(), 0); },
        stop: () => {},
      };
      return src;
    },
  };
  return { ctx, starts };
}

const okFetch = () => vi.fn(async () => ({ ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(8) }));

describe('playSound', () => {
  beforeEach(() => {
    clearSoundCache();
    ctxHolder.ctx = null;
    vi.restoreAllMocks();
  });

  it('is silent and resolves immediately for an empty file', async () => {
    await expect(playSound('').ended).resolves.toBeUndefined();
  });

  it('resolves when there is no audio context', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(playSound('x.mp3').ended).resolves.toBeUndefined();
  });

  it('resolves (and logs) on a fetch error', async () => {
    const { ctx, starts } = fakeCtx();
    ctxHolder.ctx = ctx;
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 })));
    await expect(playSound('missing.mp3').ended).resolves.toBeUndefined();
    expect(starts).toHaveLength(0);
    expect(err).toHaveBeenCalled();
  });

  it('plays, resolves on end, and caches the decoded buffer', async () => {
    const { ctx, starts } = fakeCtx();
    ctxHolder.ctx = ctx;
    const fetchMock = okFetch();
    vi.stubGlobal('fetch', fetchMock);
    await playSound('a.mp3').ended;
    await playSound('a.mp3').ended;
    expect(starts).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(ctx.decodeAudioData).toHaveBeenCalledTimes(1);
  });

  it('stop() resolves ended and prevents a late start', async () => {
    const { ctx, starts } = fakeCtx();
    ctxHolder.ctx = ctx;
    vi.stubGlobal('fetch', okFetch());
    const h = playSound('b.mp3');
    h.stop();
    await h.ended;
    await new Promise((r) => setTimeout(r, 5));
    expect(starts).toHaveLength(0);
  });
});
