import { SoundSelect, useSoundList, validateGuard, type LayoutSectionProps } from './shared';

export function GuardSection({ draft, onChange }: LayoutSectionProps) {
  const { sounds, error } = useSoundList();
  const problem = validateGuard(draft);
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-semibold text-white">Guard panel</h3>
        <p className="text-sm text-slate-400 mt-1">Settings for the guard panel on tablets.</p>
      </div>
      <div>
        <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">
          Event alert sound
        </label>
        <SoundSelect
          label="Event alert sound"
          sounds={sounds}
          value={draft.guard.event_alert_sound}
          onChange={(v) => onChange({ ...draft, guard: { ...draft.guard, event_alert_sound: v } })}
        />
        {problem && <p className="text-xs text-red-400 mt-1">{problem}</p>}
        {error && <p className="text-xs text-amber-400 mt-1">{error}</p>}
        <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
          Played for guard events, Control banners and new-job toasts. Manage files under Sound library.
        </p>
      </div>
    </div>
  );
}
