/**
 * Guard for the FlowSidebar "Create / Update Automation" button.
 *
 * Friday's Bamboo HR fix (7ccdb52): creating an automation requires the Webhook
 * Secret to be explicitly Saved first (`secretSaved`). The previous logic also
 * re-validated the raw secret fields inline, which kept the button disabled for
 * basic-auth platforms (e.g. BambooHR) even after the secret had been saved.
 * Now the single source of truth is `secretSaved`.
 *
 * Salesforce is exempt — it uses a bootstrap flow where the secret is generated
 * automatically. Editing an existing automation never re-requires the secret.
 */
export interface AutomationSaveState {
  saving: boolean;
  name: string;
  sourcePlatform: string;
  eventType: string;
  workflowId: string;
  editingAutomation: boolean;
  secretSaved: boolean;
}

/**
 * Why the Create/Update button is disabled, or null if it's enabled.
 *  - 'saving'         — a save is already in flight
 *  - 'missing-fields' — a required field (name/source/event/workflow) is empty
 *  - 'secret-unsaved' — everything is filled but the webhook secret hasn't been
 *                       Saved yet (new, non-Salesforce automation). This is the
 *                       case worth surfacing as a hint — nothing else looks wrong.
 */
export type AutomationSaveBlockReason = 'saving' | 'missing-fields' | 'secret-unsaved' | null;

export function automationSaveBlockReason(s: AutomationSaveState): AutomationSaveBlockReason {
  if (s.saving) return 'saving';
  if (!s.name || !s.sourcePlatform || !s.eventType || !s.workflowId) return 'missing-fields';
  // New automation: the webhook secret must be saved first, except Salesforce.
  if (!s.editingAutomation && !s.secretSaved && s.sourcePlatform !== 'salesforce') return 'secret-unsaved';
  return null;
}

export function isAutomationSaveDisabled(s: AutomationSaveState): boolean {
  return automationSaveBlockReason(s) !== null;
}
