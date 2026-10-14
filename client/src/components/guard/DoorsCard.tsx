import { useEffect, useRef, useState } from 'react';
import type { ActionRunner } from '../../hooks/useProfileActions';
import type { JmriThrottle } from '../../hooks/useJmriThrottle';
import { describeSkip, type ResolvedAction } from '../../lib/profiles';
import { playSound, type SoundHandle } from '../../lib/sound';
import type { BoardingConfig, TrainProfile } from '../../types';

interface Props {
  profile: TrainProfile | null;
  throttle: JmriThrottle;
  actions: ActionRunner;
  boarding: Pick<BoardingConfig, 'start_delay_s' | 'doil_off_delay_s'>;
  hasTrainId: boolean;
  /** Hook point for the boarding phase: the open sound has finished (or its fallback delay elapsed). */
  onBoardingStart: () => void;
  /** Hook point for the boarding phase: Doors Close was pressed. */
  onDoorsClosed: () => void;
}

const NO_SOUNDS = { door_open: '', door_close: '', bell: '' };

/** Why an unresolved action isn't driving JMRI, or null if it resolves. */
function skipChip(r: ResolvedAction, hasTrainId: boolean): string | null {
  if (r.ok) return null;
  if (!hasTrainId) return 'no roster ID';
  return describeSkip(r.reason);
}

/**
 * Doors / DOIL / Bell (spec §7.2). Rendered with key={train.id}, so unmount =
 * train change and pending timers/sounds are dropped with it.
 */
export function DoorsCard({ profile, throttle, actions, boarding, hasTrainId, onBoardingStart, onDoorsClosed }: Props) {
  const sounds = profile?.sounds ?? NO_SOUNDS;
  const open = actions.resolve('door_open');
  const close = actions.resolve('door_close');
  const bell = actions.resolve('bell');

  // DOIL follows JMRI when open/close are on/off of the same function (a handheld toggle shows up).
  const sharedFn = open.ok && close.ok && open.fn === close.fn
    && open.spec.mode === 'on' && close.spec.mode === 'off' ? open.fn : null;
  const [localDoil, setLocalDoil] = useState(false);
  const doil = sharedFn !== null ? throttle.functions[sharedFn] === true : localDoil;

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const doorSound = useRef<SoundHandle | null>(null);
  const bellSound = useRef<SoundHandle | null>(null);
  /** Bumped by every door press and on unmount so stale sound/timer callbacks do nothing. */
  const gen = useRef(0);

  const cancelPending = () => {
    gen.current++;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    doorSound.current?.stop();
    doorSound.current = null;
  };
  useEffect(() => () => { cancelPending(); bellSound.current?.stop(); }, []);

  /** Runs `then` when the sound ends, or after `fallbackS` if the action has no sound. */
  const afterSound = (file: string, fallbackS: number, then: () => void) => {
    const g = gen.current;
    const run = () => { if (g === gen.current) then(); };
    if (file) {
      const h = playSound(file);
      doorSound.current = h;
      void h.ended.then(run);
    } else {
      timer.current = setTimeout(run, fallbackS * 1000);
    }
  };

  const pressOpen = () => {
    cancelPending();
    actions.press('door_open');
    setLocalDoil(true);
    afterSound(sounds.door_open, boarding.start_delay_s, onBoardingStart);
  };
  const pressClose = () => {
    cancelPending();
    actions.press('door_close');
    onDoorsClosed();
    afterSound(sounds.door_close, boarding.doil_off_delay_s, () => setLocalDoil(false));
  };

  const bellHold = bell.ok && bell.spec.mode === 'hold';
  const bellPress = () => {
    actions.press('bell');
    bellSound.current?.stop();
    bellSound.current = playSound(sounds.bell);
  };
  const bellRelease = () => actions.release('bell');

  const gate = (r: ResolvedAction): string | null => {
    if (!r.ok || throttle.acquired) return null;
    return throttle.status === 'connected' ? 'Acquiring…' : 'JMRI disconnected';
  };
  const whyOpen = gate(open);
  const whyClose = gate(close);
  const whyBell = gate(bell);

  const chip = (text: string | null, warn = false) => text && (
    <span className={`text-xs ${warn ? 'text-amber-400' : 'text-slate-500'}`}>{text}</span>
  );

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <button
            onClick={pressOpen}
            disabled={whyOpen !== null}
            className="min-h-[96px] rounded-xl bg-emerald-600 enabled:hover:bg-emerald-500 enabled:active:bg-emerald-400 disabled:opacity-40 text-xl font-bold"
          >DOORS OPEN</button>
          {chip(whyOpen, true)}
          {chip(skipChip(open, hasTrainId))}
        </div>
        <div className="flex flex-col gap-1">
          <button
            onClick={pressClose}
            disabled={whyClose !== null}
            className="min-h-[96px] rounded-xl bg-red-600 enabled:hover:bg-red-500 enabled:active:bg-red-400 disabled:opacity-40 text-xl font-bold"
          >DOORS CLOSE</button>
          {chip(whyClose, true)}
          {chip(skipChip(close, hasTrainId))}
        </div>
      </div>
      <div className="flex items-start gap-4">
        <div className="flex items-center gap-2 min-h-[56px]" title="Door indicator light">
          <span
            data-testid="doil"
            data-on={doil}
            className={`w-5 h-5 rounded-full border ${doil ? 'bg-amber-300 border-amber-200 shadow-[0_0_12px_2px_rgba(252,211,77,0.7)]' : 'bg-slate-800 border-slate-600'}`}
          />
          <span className="text-sm font-semibold text-slate-300">DOIL</span>
        </div>
        <div className="flex flex-col gap-1 ml-auto items-end">
          <button
            data-testid="bell"
            onClick={bellHold ? undefined : bellPress}
            onPointerDown={bellHold ? bellPress : undefined}
            onPointerUp={bellHold ? bellRelease : undefined}
            onPointerCancel={bellHold ? bellRelease : undefined}
            onPointerLeave={bellHold ? bellRelease : undefined}
            onContextMenu={(e) => e.preventDefault()}
            disabled={whyBell !== null}
            className="min-h-[56px] px-8 rounded-xl bg-slate-700 enabled:hover:bg-slate-600 enabled:active:bg-slate-500 disabled:opacity-40 font-bold select-none touch-none"
          >BELL</button>
          {chip(whyBell, true)}
          {bell.ok || bell.reason !== 'unmapped' ? chip(skipChip(bell, hasTrainId)) : null}
        </div>
      </div>
    </div>
  );
}
