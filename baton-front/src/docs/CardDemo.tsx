/**
 * Live instance-card replicas for the docs.
 *
 * Faithful, static re-creations of the real per-instance card rendered in the
 * Resolution Center (InstanceCard in src/components/flows/InstancesSidebar.tsx).
 * They reproduce the card's anatomy — automation name, status badge, meta row,
 * progress bar, error/auto-retry notes, tags, and the action bar — in the three
 * states a reader meets most: Failed, Overdue, and In Progress. Colours mirror
 * the app's STATUS tokens (emerald/blue/red/purple). The action buttons are
 * illustrative (non-interactive), so these render fine in the search index too.
 *
 * Styling lives in docs.css under `.bd-card*` / `.bd-statkey`.
 */
import {
  Zap, RefreshCw, Ban, AlertTriangle, ExternalLink, MessageSquareWarning, CalendarPlus, Tag, Plus,
} from 'lucide-react';
import { PlatformIcon } from '@/components/ui/PlatformIcon';

/** The four real instance statuses, with the colours the app paints them. */
export function StatusLegend() {
  const items = [
    { key: 'completed', label: 'Completed', note: 'finished successfully' },
    { key: 'running',   label: 'Running',   note: 'in flight right now' },
    { key: 'failed',    label: 'Failed',    note: 'crashed or errored' },
    { key: 'cancelled', label: 'Cancelled', note: 'stopped by you or Docusign' },
  ];
  return (
    <div className="bd-statuslegend" data-demo="status-legend">
      {items.map((s) => (
        <span key={s.key} className={`bd-statkey s-${s.key}`}>
          <span className="bd-statkey__dot" />
          <strong>{s.label}</strong>
          <span>- {s.note}</span>
        </span>
      ))}
    </div>
  );
}

/** Failed instance — red rail, error note, retry/cancel/report actions. */
function FailedCard() {
  return (
    <div className="bd-card s-failed">
      <div className="bd-card__body">
        <div className="bd-card__row">
          <span className="bd-card__auto"><Zap /><span>Closed-won → NDA</span></span>
          <span className="bd-card__status s-failed">failed</span>
        </div>
        <p className="bd-card__sub">Acme Corp - order #4821</p>
        <div className="bd-card__meta">
          <span>2h ago</span>
          <span className="sep">|</span>
          <PlatformIcon platform="salesforce" size={11} />
          <span className="cap">salesforce</span>
        </div>
        <div className="bd-card__bar">
          <div className="bd-card__track"><div className="bd-card__fill s-failed" style={{ width: '40%' }} /></div>
          <span className="bd-card__count">2/5</span>
        </div>
        <p className="bd-card__step"><span className="err">Failed at: Send envelope</span></p>
        <div className="bd-card__err">
          <AlertTriangle />
          <p>Workflow Builder returned 422 - recipient email is missing.</p>
        </div>
        <div className="bd-card__tags">
          <span className="bd-card__tag"><Tag />priority</span>
          <span className="bd-card__tagadd"><Plus />Add tag</span>
        </div>
      </div>
      <div className="bd-card__actions">
        <span className="bd-act primary"><RefreshCw />Try Again</span>
        <span className="bd-act danger"><Ban />Cancel</span>
        <span className="bd-act neutral push"><ExternalLink />Open in Docusign</span>
        <span className="bd-act amber"><MessageSquareWarning />Support</span>
      </div>
    </div>
  );
}

/** Overdue instance — running, but past its expected duration: red day count + Add days. */
function OverdueCard() {
  return (
    <div className="bd-card s-running">
      <div className="bd-card__body">
        <div className="bd-card__row">
          <span className="bd-card__auto"><Zap /><span>New account → MSA</span></span>
          <span className="bd-card__status s-running">running</span>
        </div>
        <p className="bd-card__sub">Globex Inc - MSA</p>
        <div className="bd-card__meta">
          <span className="over">9/7 days passed</span>
          <span className="sep">|</span>
          <PlatformIcon platform="salesforce" size={11} />
          <span className="cap">salesforce</span>
        </div>
        <div className="bd-card__bar">
          <div className="bd-card__track"><div className="bd-card__fill s-running" style={{ width: '50%' }} /></div>
          <span className="bd-card__count">3/6</span>
        </div>
        <p className="bd-card__step">Step 3 - Awaiting counter-signature</p>
        <div className="bd-card__tags">
          <span className="bd-card__tagadd"><Plus />Add tag</span>
        </div>
      </div>
      <div className="bd-card__actions">
        <input className="bd-card__daysinput" value="7" readOnly aria-label="Days to add" />
        <span className="bd-act add"><CalendarPlus />Add days</span>
        <span className="bd-act danger"><Ban />Cancel</span>
        <span className="bd-act neutral push"><ExternalLink />Open in Docusign</span>
      </div>
    </div>
  );
}

/** In Progress instance — running after a retry, mid auto-retry cycle. */
function InProgressCard() {
  return (
    <div className="bd-card s-running">
      <div className="bd-card__body">
        <div className="bd-card__row">
          <span className="bd-card__auto"><Zap /><span>Deal won → Order form</span></span>
          <span className="bd-card__status s-running">running</span>
        </div>
        <p className="bd-card__sub">Initech - order #99</p>
        <div className="bd-card__meta">
          <span>5m ago</span>
          <span className="sep">|</span>
          <PlatformIcon platform="hubspot" size={11} />
          <span className="cap">hubspot</span>
        </div>
        <div className="bd-card__note amber">
          <RefreshCw />
          <span>Auto-retry 2/6</span>
          <span style={{ marginLeft: 'auto', color: '#f59e0b' }}>next in 3m</span>
        </div>
        <div className="bd-card__bar">
          <div className="bd-card__track"><div className="bd-card__fill s-running" style={{ width: '25%' }} /></div>
          <span className="bd-card__count">1/4</span>
        </div>
        <p className="bd-card__step">Step 1 - Create envelope</p>
        <div className="bd-card__tags">
          <span className="bd-card__tagadd"><Plus />Add tag</span>
        </div>
      </div>
      <div className="bd-card__actions">
        <span className="bd-act primary"><RefreshCw />Retry now</span>
        <span className="bd-act danger"><Ban />Cancel</span>
        <span className="bd-act neutral push"><ExternalLink />Open in Docusign</span>
      </div>
    </div>
  );
}

/** The three instance-card states side by side. */
export function InstanceCardShowcase() {
  return (
    <div className="bd-cardgrid" data-demo="instance-cards">
      <FailedCard />
      <OverdueCard />
      <InProgressCard />
    </div>
  );
}
