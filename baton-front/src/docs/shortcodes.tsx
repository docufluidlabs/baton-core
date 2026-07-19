/**
 * Shortcode registry — maps a stable name to the live React component it renders.
 *
 * The interactive demos can't be expressed as Markdown, so in edited pages they
 * survive as directive shortcodes: `::demo[filter-tabs]`. DocMarkdown renders
 * each token via this registry; the seed converter (docToMarkdown.ts) emits the
 * token from a `data-demo="<name>"` marker on the rendered demo. The names are a
 * stable public contract — keep them in sync with the markers in FilterDemo.tsx
 * and CardDemo.tsx, and never rename one without a migration.
 */
import type { ComponentType } from 'react';
import {
  FilterTabsDemo,
  InProgressOriginDemo,
  PlatformAutomationDemo,
  ChipStatesDemo,
} from './FilterDemo';
import { StatusLegend, InstanceCardShowcase } from './CardDemo';

export const DEMO_SHORTCODES: Record<string, ComponentType> = {
  'filter-tabs': FilterTabsDemo,
  'inprogress-origin': InProgressOriginDemo,
  'platform-automation': PlatformAutomationDemo,
  'chip-states': ChipStatesDemo,
  'status-legend': StatusLegend,
  'instance-cards': InstanceCardShowcase,
};

/** Names a tester may reference — surfaced in the editor's shortcode helper. */
export const DEMO_NAMES = Object.keys(DEMO_SHORTCODES);
