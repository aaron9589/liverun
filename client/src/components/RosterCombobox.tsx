import { useId, useMemo, useRef, useState } from 'react';
import { rankRosterMatches } from '../lib/jmri';
import type { JmriRoster } from '../hooks/useJmriRoster';

interface Props {
  value: string;
  onChange: (v: string) => void;
  roster: JmriRoster;
  placeholder?: string;
}

const INPUT_CLS =
  'w-full rounded-lg bg-slate-800 border border-slate-600 px-3 py-2 text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500 text-sm';

export function RosterCombobox({ value, onChange, roster, placeholder }: Props) {
  const uid = useId();
  const listId = `${uid}-list`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);

  const usable = roster.status === 'ready' || roster.status === 'loading';
  const matches = useMemo(
    () => (usable ? rankRosterMatches(roster.entries, text) : []),
    [usable, roster.entries, text],
  );
  const showList = open && usable;

  function accept(v: string) {
    onChange(v);
    setText('');
    setOpen(false);
    setActive(-1);
  }

  function clear() {
    onChange('');
    setText('');
    // Input is re-mounted once the chip disappears; focus after that render.
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!usable) return;
      e.preventDefault();
      if (!open) { setOpen(true); setActive(0); return; }
      const n = matches.length;
      if (n === 0) return;
      setActive((a) => (e.key === 'ArrowDown' ? (a + 1) % n : (a - 1 + n) % n));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (showList && active >= 0 && matches[active]) accept(matches[active].name);
      else if (text.trim()) accept(text.trim());
    } else if (e.key === 'Tab') {
      // Only intercept when a suggestion is highlighted; otherwise Tab moves focus normally.
      if (showList && active >= 0 && matches[active]) {
        e.preventDefault();
        accept(matches[active].name);
      }
    } else if (e.key === 'Escape') {
      if (open) { e.stopPropagation(); setOpen(false); setActive(-1); }
    }
  }

  const notInRoster = !!value && roster.status === 'ready' && !roster.entries.some((x) => x.name === value);

  return (
    <div className="relative">
      {value ? (
        <div className="flex items-center gap-2 min-h-[38px]">
          <span
            className={`inline-flex items-center gap-1 rounded-lg bg-slate-800 px-2 py-1 text-sm text-white border ${
              notInRoster ? 'border-dashed border-amber-500/60' : 'border-slate-600'
            }`}
          >
            <span className="truncate max-w-[16rem]">{value}</span>
            <button
              type="button"
              onClick={clear}
              aria-label={`Clear ${value}`}
              className="text-slate-400 hover:text-white leading-none px-0.5"
            >
              ×
            </button>
          </span>
          {notInRoster && <span className="text-xs text-amber-400/80">not in roster</span>}
        </div>
      ) : (
        <input
          ref={inputRef}
          value={text}
          placeholder={placeholder}
          onChange={(e) => { setText(e.target.value); setOpen(true); setActive(e.target.value && usable ? 0 : -1); }}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            // Commit typed text on blur so clicking Save without Enter doesn't drop it.
            if (text.trim()) accept(text.trim());
            else { setOpen(false); setActive(-1); }
          }}
          onKeyDown={onKeyDown}
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList && active >= 0 ? `${uid}-opt-${active}` : undefined}
          className={INPUT_CLS}
        />
      )}

      {showList && !value && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-30 mt-1 w-full rounded-lg bg-slate-800 border border-slate-600 shadow-xl max-h-64 overflow-auto"
        >
          {matches.map((m, i) => (
            <li
              key={m.name}
              id={`${uid}-opt-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => { e.preventDefault(); accept(m.name); }}
              onMouseEnter={() => setActive(i)}
              className={`px-3 py-1.5 text-sm cursor-pointer ${i === active ? 'bg-blue-600/30 text-white' : 'text-slate-200'}`}
            >
              {m.name}
              {m.address && <span className="ml-2 text-xs text-slate-500">#{m.address}</span>}
            </li>
          ))}
          {matches.length === 0 && (
            <li role="presentation" className="px-3 py-1.5 text-xs text-slate-500">
              {roster.status === 'loading' ? 'Loading roster…' : text.trim() ? 'No match — Enter to use as typed' : 'Roster is empty'}
            </li>
          )}
          <li role="presentation" className="border-t border-slate-700">
            <button
              type="button"
              onMouseDown={(e) => { e.preventDefault(); roster.refresh(); }}
              className="w-full text-left px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200"
            >
              ↻ Refresh roster
            </button>
          </li>
        </ul>
      )}

      {!value && !usable && (
        <p className="text-xs text-slate-600 mt-1">
          {roster.status === 'error' ? 'Roster unavailable' : 'JMRI not configured'}
        </p>
      )}
    </div>
  );
}
