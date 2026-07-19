/**
 * Live, interactive filter demos for the docs.
 *
 * These are faithful re-creations of the real Resolution Center filter controls
 * (src/pages/ControlCenterPage.tsx): the status tabs, the In Progress origin
 * sub-filter, and the cascading Platform → Automation chip rows. They render the
 * actual chip markup with the same colours and states, and are clickable so the
 * reader can flip each control between its statuses. The real PlatformIcon is
 * reused so the platform chips look exactly like the app.
 *
 * Colours mirror the Tailwind tokens used in the app (violet/red/amber/blue/
 * green/grey). State styling lives in docs.css under `.bd-tabs` / `.bd-chip`;
 * the per-tab count-badge colours are data-driven so they're set inline here.
 */
import { useState } from 'react';
import { Zap } from 'lucide-react';
import { PlatformIcon } from '@/components/ui/PlatformIcon';

/** Non-zero count-badge colours, one per status tab — [background, text]. */
const TAB_TONE: Record<string, [string, string]> = {
  all:         ['#ede9fe', '#6d28d9'], // violet-100 / violet-700
  failed:      ['#fee2e2', '#b91c1c'], // red-100 / red-700
  overdue:     ['#fef3c7', '#b45309'], // amber-100 / amber-700
  in_progress: ['#dbeafe', '#1d4ed8'], // blue-100 / blue-700
  resolved:    ['#dcfce7', '#15803d'], // green-100 / green-700
  cancelled:   ['#f3f4f6', '#4b5563'], // gray-100 / gray-600
};

const DEMO_TABS: { key: keyof typeof TAB_TONE; label: string; count: number }[] = [
  { key: 'all',         label: 'All',         count: 7 },
  { key: 'failed',      label: 'Failed',      count: 3 },
  { key: 'overdue',     label: 'Overdue',     count: 1 },
  { key: 'in_progress', label: 'In Progress', count: 3 },
  { key: 'resolved',    label: 'Resolved',    count: 12 },
  { key: 'cancelled',   label: 'Cancelled',   count: 0 },
];

/** The status tabs, with their live count badges. Click to change the active tab. */
export function FilterTabsDemo() {
  const [active, setActive] = useState<string>('failed');
  return (
    <div className="bd-demo" data-demo="filter-tabs">
      <span className="bd-demo__label">Live — click a tab</span>
      <div className="bd-tabs">
        {DEMO_TABS.map((t) => {
          const isActive = t.key === active;
          const [bg, fg] = TAB_TONE[t.key];
          return (
            <button
              key={t.key}
              type="button"
              className={`bd-tab${isActive ? ' is-active' : ''}`}
              onClick={() => setActive(t.key)}
            >
              {t.label}
              <span className="bd-tab__count" style={t.count > 0 ? { background: bg, color: fg } : undefined}>
                {t.count}
              </span>
            </button>
          );
        })}
      </div>
      <p className="bd-demo__hint">
        The active tab is underlined in blue. Every tab keeps a live count in its own colour; a count of zero
        fades to grey, so an empty tab reads at a glance as "nothing here."
      </p>
    </div>
  );
}

const ORIGINS: { key: string; label: string; tone: '' | 'tone-red' | 'tone-amber'; dot: boolean }[] = [
  { key: 'all',     label: 'All',           tone: '',          dot: false },
  { key: 'failed',  label: 'After Failed',  tone: 'tone-red',  dot: true },
  { key: 'overdue', label: 'After Overdue', tone: 'tone-amber', dot: true },
];

/** The In Progress origin sub-filter (only shown on the In Progress tab in the app). */
export function InProgressOriginDemo() {
  const [active, setActive] = useState('all');
  return (
    <div className="bd-demo" data-demo="inprogress-origin">
      <span className="bd-demo__label">Live — In Progress origin</span>
      <div className="bd-demo__row">
        {ORIGINS.map((o) => {
          const isActive = o.key === active;
          return (
            <button
              key={o.key}
              type="button"
              className={`bd-chip ${o.tone}${isActive ? ' is-active' : ''}`}
              onClick={() => setActive(o.key)}
            >
              {o.dot && <span className="bd-chip__dot" />}
              {o.label}
            </button>
          );
        })}
      </div>
      <p className="bd-demo__hint">
        In Progress holds two kinds of instance: ones retried after a failure (<strong>After Failed</strong>, red
        dot) and overdue ones you postponed (<strong>After Overdue</strong>, amber dot). The active chip picks up
        its colour; the rest stay neutral.
      </p>
    </div>
  );
}

const DEMO_PLATFORMS = ['salesforce', 'hubspot', 'pipedrive'];
const DEMO_AUTOMATIONS: Record<string, string[]> = {
  salesforce: ['Closed-won → NDA', 'New account → MSA'],
  hubspot: ['Deal won → Order form'],
  pipedrive: ['Deal won → Quote'],
};

/** The cascading Platform → Automation filter rows. Pick a platform to reveal its automations. */
export function PlatformAutomationDemo() {
  const [platform, setPlatform] = useState<string | null>(null);
  const [rule, setRule] = useState<string | null>(null);

  function selectPlatform(p: string | null) {
    setPlatform(p);
    setRule(null); // selecting a platform always resets the automation filter
  }

  const automations = platform ? DEMO_AUTOMATIONS[platform] ?? [] : [];

  return (
    <div className="bd-demo" data-demo="platform-automation">
      <span className="bd-demo__label">Live — pick a platform, then an automation</span>

      {/* Platform row */}
      <div className="bd-demo__row">
        <button
          type="button"
          className={`bd-chip${platform === null ? ' is-active' : ''}`}
          onClick={() => selectPlatform(null)}
        >
          All
        </button>
        {DEMO_PLATFORMS.map((p) => (
          <button
            key={p}
            type="button"
            className={`bd-chip${platform === p ? ' is-active' : ''}`}
            onClick={() => selectPlatform(p)}
          >
            <PlatformIcon platform={p} size={11} />
            <span style={{ textTransform: 'capitalize' }}>{p}</span>
          </button>
        ))}
      </div>

      {/* Automation row — appears only once a platform is picked */}
      {platform && automations.length > 0 && (
        <div className="bd-demo__row" style={{ marginTop: 8 }}>
          <button
            type="button"
            className={`bd-chip is-dim${rule === null ? ' is-active' : ''}`}
            onClick={() => setRule(null)}
          >
            All automations
          </button>
          {automations.map((a) => (
            <button
              key={a}
              type="button"
              className={`bd-chip is-dim${rule === a ? ' is-active' : ''}`}
              onClick={() => setRule(a)}
            >
              <Zap style={{ width: 10, height: 10, flexShrink: 0 }} />
              {a}
            </button>
          ))}
        </div>
      )}

      <p className="bd-demo__hint">
        {platform
          ? `Showing the ${platform} automations. A second row appeared so you can narrow to one automation — pick "All" above to clear it.`
          : 'Pick a platform to narrow the list. A second row of its automations appears so you can drill down further.'}
      </p>
    </div>
  );
}

/** A static reference card naming every chip status side by side. */
export function ChipStatesDemo() {
  return (
    <div className="bd-demo" data-demo="chip-states">
      <span className="bd-demo__label">Every chip status</span>
      <div className="bd-demo__row">
        <span className="bd-chip">Default</span>
        <span className="bd-chip is-active">Active</span>
        <span className="bd-chip tone-red is-active"><span className="bd-chip__dot" />Active · failed</span>
        <span className="bd-chip tone-amber is-active"><span className="bd-chip__dot" />Active · overdue</span>
        <span className="bd-chip is-dim">Dimmed (automation)</span>
      </div>
      <p className="bd-demo__hint">
        Every filter chip is one of these: <strong>Default</strong> (white, grey text), <strong>Active</strong>{' '}
        (violet — or red/amber for an origin chip), or <strong>Dimmed</strong> for the secondary automation row.
      </p>
    </div>
  );
}
