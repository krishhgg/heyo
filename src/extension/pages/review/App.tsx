import { useCallback, useEffect, useMemo, useState } from 'preact/hooks';
import { score as scoreLog } from '../../../core/metrics';
import type { Review, Verdict } from '../../../core/types';
import { decide } from '../../../decision';
import { clearLog, putReview, readLog, type Log } from '../../db';
import type { PageReply, PageRequest } from '../../messages';
import { DEFAULT_SETTINGS, readSettings, watchSettings, type Settings } from '../../settings';
import { decisionVersion } from '../../version';
import { firesOf, reviewKey, toExport, verdictsOf, type Fire } from './data';
import { NumbersView } from './NumbersView';
import { RetargetView } from './RetargetView';
import { ReviewView } from './ReviewView';

type View = 'review' | 'numbers' | 'retarget';

function download(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

export function App() {
  const [log, setLog] = useState<Log | null>(null);
  const [unread, setUnread] = useState(false);
  const [view, setView] = useState<View>('review');
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);

  useEffect(() => {
    void readSettings().then(setSettings);
    watchSettings(setSettings);
  }, []);

  const reload = useCallback(() => {
    void readLog().then(
      (read) => {
        setLog(read);
        setUnread(false);
      },
      () => setUnread(true),
    );
  }, []);

  // The log grows while the user browses in other tabs. Read it again on return.
  useEffect(() => {
    reload();
    const onVisible = () => {
      if (document.visibilityState === 'visible') reload();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [reload]);

  const fires = useMemo(() => (log ? firesOf(log.records, decide) : []), [log?.records]);
  const verdicts = useMemo(() => verdictsOf(log?.reviews ?? []), [log?.reviews]);
  const score = useMemo(
    () => (log ? scoreLog(log.records, log.reviews, decide) : null),
    [log?.records, log?.reviews],
  );

  if (!log || !score) {
    if (!unread) return <main class="page" aria-busy="true" />;
    return (
      <main class="page">
        <div class="empty" role="alert">
          <h2>The log could not be read</h2>
          <p>Nothing was changed. The browser did not hand over heyo's local store.</p>
          <button class="primary" onClick={reload}>
            Try again
          </button>
        </div>
      </main>
    );
  }

  const onVerdict = async (fire: Fire, verdict: Verdict) => {
    const review = { recordId: fire.record.id, candidate: fire.picked.id, verdict, t: Date.now() };
    await putReview(review);
    // The store keeps one mark per click and control, so a changed mark replaces the old one here too.
    const same = (r: Review) => r.recordId === review.recordId && r.candidate === review.candidate;
    setLog((current) =>
      current
        ? { ...current, reviews: [...current.reviews.filter((r) => !same(r)), review] }
        : current,
    );
  };

  const onExport = async () => {
    // Read the store again, so the file holds what was logged since this page last looked.
    const stored = await readLog();
    setLog(stored);
    const day = new Date().toISOString().slice(0, 10);
    const exported = toExport(stored, chrome.runtime.getManifest().version, decisionVersion);
    download(`heyo-log-${day}.json`, `${JSON.stringify(exported, null, 2)}\n`);
  };

  const onDelete = async () => {
    await clearLog();
    reload();
  };

  const waiting = fires.filter((f) => !verdicts.has(reviewKey(f))).length;

  // Only the service worker changes settings. It checks the gates before turning retargeting on.
  const request = async (message: PageRequest) => {
    const reply = await chrome.runtime.sendMessage<PageRequest, PageReply>(message);
    setSettings(reply.settings);
    reload();
  };
  const retargeting = settings.mode === 'retarget';

  return (
    <main class="page">
      <header class="top">
        <h1 class="wordmark">heyo</h1>
        <p class="mode">
          {retargeting
            ? `Retargeting is on for ${settings.allowlist.length} ${settings.allowlist.length === 1 ? 'site' : 'sites'}. Everywhere else heyo only logs.`
            : 'Shadow mode. heyo is logging and changes nothing on any page.'}
        </p>
        <nav class="tabs" aria-label="Sections">
          <button class="tab" aria-current={view === 'review'} onClick={() => setView('review')}>
            Review
            {waiting > 0 && <span class="count num">{waiting}</span>}
          </button>
          <button class="tab" aria-current={view === 'numbers'} onClick={() => setView('numbers')}>
            Numbers
          </button>
          <button
            class="tab"
            aria-current={view === 'retarget'}
            onClick={() => setView('retarget')}
          >
            Retargeting
            {retargeting && <span class="count num">on</span>}
          </button>
        </nav>
      </header>
      {/* The review stays mounted behind the numbers, so its place and its way back are kept. */}
      <div hidden={view !== 'review'}>
        <ReviewView
          active={view === 'review'}
          fires={fires}
          verdicts={verdicts}
          onVerdict={onVerdict}
        />
      </div>
      {view === 'numbers' && (
        <NumbersView log={log} score={score} onExport={onExport} onDelete={onDelete} />
      )}
      {view === 'retarget' && (
        <RetargetView log={log} score={score} settings={settings} request={request} />
      )}
    </main>
  );
}
