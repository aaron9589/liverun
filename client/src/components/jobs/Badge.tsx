import type { Badge as BadgeData, BadgeTone } from '../../lib/pathRequests';

const TONE: Record<BadgeTone, string> = {
  amber: 'bg-amber-900/60 text-amber-300',
  blue: 'bg-blue-900/60 text-blue-300',
  green: 'bg-emerald-900/60 text-emerald-300',
  teal: 'bg-teal-900/60 text-teal-200',
  red: 'bg-red-900/60 text-red-300',
  slate: 'bg-slate-800 text-slate-400',
};

/** The one badge style for jobs and requests in Crew jobs. */
export function Badge({ badge }: { badge: BadgeData }) {
  return <span className={`shrink-0 text-xs font-semibold px-2 py-1 rounded-full whitespace-nowrap ${TONE[badge.tone]}`}>{badge.label}</span>;
}
