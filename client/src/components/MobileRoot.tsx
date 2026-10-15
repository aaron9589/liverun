import { useState } from 'react';
import { loadMobileView, resolveMobileView, saveMobileView, type MobileView } from '../lib/mode';
import { CrewMobile } from './CrewMobile';
import { MobilePicker } from './MobilePicker';
import { CrewJobs } from './jobs/CrewJobs';

/** Entry for …/mobile: Crew jobs, the Running board (CrewMobile) or the view picker. */
export function MobileRoot() {
  const [view, setView] = useState<MobileView | 'pick'>(() => {
    const r = resolveMobileView(window.location.search, loadMobileView());
    if (r.save) saveMobileView(r.save);
    if (r.replaceSearch !== undefined) {
      const { pathname, hash } = window.location;
      window.history.replaceState(null, '', pathname + r.replaceSearch + hash);
    }
    return r.view;
  });

  if (view === 'jobs') return <CrewJobs />;
  if (view === 'board') return <CrewMobile />;
  return <MobilePicker onPick={setView} />;
}
