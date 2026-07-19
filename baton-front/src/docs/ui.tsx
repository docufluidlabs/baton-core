/**
 * Baton docs — presentational primitives.
 *
 * Each primitive emits the same class names that `docs.css` styles, so doc
 * pages stay clean, semantic React components. Internal cross-links go through
 * <DocLink> / <Card to="…"> which resolve to the `/docs/:slug` route.
 */
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Info, Lightbulb, AlertTriangle, OctagonAlert, ZoomIn, X } from 'lucide-react';

type CalloutType = 'note' | 'tip' | 'warning' | 'danger';
const CALLOUT_ICON = {
  note: Info,
  tip: Lightbulb,
  warning: AlertTriangle,
  danger: OctagonAlert,
} as const;

export function Lead({ children }: { children: ReactNode }) {
  return <p className="lead">{children}</p>;
}

export function Callout({
  type = 'note',
  title,
  children,
}: {
  type?: CalloutType;
  title?: string;
  children: ReactNode;
}) {
  const Icon = CALLOUT_ICON[type];
  return (
    <div className={`callout ${type}`}>
      <Icon className="callout__icon" aria-hidden="true" />
      <div className="callout__body">
        {title && <span className="callout__title">{title}</span>}
        {children}
      </div>
    </div>
  );
}

export function TableWrap({ children }: { children: ReactNode }) {
  return <div className="table-wrap">{children}</div>;
}

export function Steps({ children }: { children: ReactNode }) {
  return <ol className="steps">{children}</ol>;
}

export function Step({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <li>
      <strong>{title}</strong>
      {children}
    </li>
  );
}

export function Badge({
  color = 'gray',
  children,
}: {
  color?: 'green' | 'red' | 'amber' | 'blue' | 'gray';
  children: ReactNode;
}) {
  return <span className={`badge ${color}`}>{children}</span>;
}

export function FlowStrip({ children }: { children: ReactNode }) {
  return <div className="flowstrip">{children}</div>;
}

export function FlowNode({ k, t, d }: { k: string; t: string; d: string }) {
  return (
    <div className="flowstrip__node">
      <div className="k">{k}</div>
      <div className="t">{t}</div>
      <div className="d">{d}</div>
    </div>
  );
}

export function KV({ children }: { children: ReactNode }) {
  return <dl className="kv">{children}</dl>;
}

export function KVRow({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export function Cards({ children }: { children: ReactNode }) {
  return <div className="card-grid">{children}</div>;
}

export function Card({
  to,
  href,
  kicker,
  title,
  children,
}: {
  to?: string;
  href?: string;
  kicker?: string;
  title: string;
  children?: ReactNode;
}) {
  const inner = (
    <>
      {kicker && <span className="card__kicker">{kicker}</span>}
      <h3>{title}</h3>
      {children && <p>{children}</p>}
    </>
  );
  if (href) {
    return (
      <a className="card" href={href} target="_blank" rel="noreferrer">
        {inner}
      </a>
    );
  }
  return (
    <Link className="card" to={`/docs/${to}`}>
      {inner}
    </Link>
  );
}

export function DocLink({ to, children }: { to: string; children: ReactNode }) {
  return <Link to={`/docs/${to}`}>{children}</Link>;
}

// Critical layout for the fullscreen lightbox is inlined (mirroring SearchModal)
// so the overlay can never collapse into page flow if docs.css is momentarily
// missing — e.g. during a dev-server HMR update. docs.css adds the fade-in.
const LIGHTBOX_OVERLAY_STYLE: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 70,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '4vh 4vw',
  background: 'rgba(5,13,28,.82)',
  cursor: 'zoom-out',
};
const LIGHTBOX_IMG_STYLE: CSSProperties = {
  maxWidth: '100%',
  maxHeight: '92vh',
  width: 'auto',
  height: 'auto',
  objectFit: 'contain',
  borderRadius: 10,
  boxShadow: '0 24px 80px rgba(0,0,0,.5)',
  cursor: 'default',
};
const LIGHTBOX_CLOSE_STYLE: CSSProperties = {
  position: 'fixed',
  top: 18,
  right: 22,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 40,
  height: 40,
  padding: 0,
  border: 'none',
  borderRadius: 999,
  background: 'rgba(255,255,255,.16)',
  color: '#fff',
  cursor: 'pointer',
};

export function Screenshot({
  src,
  alt,
  caption,
}: {
  src: string;
  alt: string;
  caption?: string;
}) {
  const [open, setOpen] = useState(false);

  // While the lightbox is open, close on Escape and lock background scroll.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  return (
    <>
      <figure className="screenshot" data-shot data-src={src} data-alt={alt} data-caption={caption}>
        <button
          type="button"
          className="screenshot__zoom"
          onClick={() => setOpen(true)}
          aria-label={`Enlarge image: ${alt}`}
        >
          <img src={src} alt={alt} loading="lazy" />
          <span className="screenshot__hint" aria-hidden="true">
            <ZoomIn size={16} />
          </span>
        </button>
        {caption && <figcaption>{caption}</figcaption>}
      </figure>

      {open && (
        <div
          className="screenshot-lightbox"
          style={LIGHTBOX_OVERLAY_STYLE}
          role="dialog"
          aria-modal="true"
          aria-label={alt}
          onClick={() => setOpen(false)}
        >
          <button
            type="button"
            className="screenshot-lightbox__close"
            style={LIGHTBOX_CLOSE_STYLE}
            onClick={() => setOpen(false)}
            aria-label="Close"
          >
            <X />
          </button>
          <img
            src={src}
            alt={alt}
            style={LIGHTBOX_IMG_STYLE}
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );
}

export function Hero({
  pill,
  title,
  children,
}: {
  pill?: string;
  title: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="hero">
      {pill && <span className="pill">{pill}</span>}
      <h1>{title}</h1>
      <p>{children}</p>
    </section>
  );
}
