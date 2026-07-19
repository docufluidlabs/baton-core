/**
 * automationSaveGuard — unit tests
 *
 * Covers Friday's Bamboo HR fix (7ccdb52): the Create button gates only on
 * `secretSaved`, not on re-validating raw secret fields — which used to keep
 * basic-auth platforms (BambooHR) disabled even after a valid secret save.
 */
import { describe, it, expect } from 'vitest';
import { isAutomationSaveDisabled, automationSaveBlockReason, type AutomationSaveState } from './automationSaveGuard';

const valid: AutomationSaveState = {
  saving: false,
  name: 'My Automation',
  sourcePlatform: 'bamboohr',
  eventType: 'employee.updated',
  workflowId: 'wf-1',
  editingAutomation: false,
  secretSaved: true,
};

describe('isAutomationSaveDisabled', () => {
  it('enabled when all required fields are present and the secret is saved', () => {
    expect(isAutomationSaveDisabled(valid)).toBe(false);
  });

  it('disabled while saving', () => {
    expect(isAutomationSaveDisabled({ ...valid, saving: true })).toBe(true);
  });

  it.each(['name', 'sourcePlatform', 'eventType', 'workflowId'] as const)(
    'disabled when %s is empty',
    (field) => {
      expect(isAutomationSaveDisabled({ ...valid, [field]: '' })).toBe(true);
    },
  );

  // ── The Bamboo regression ──────────────────────────────────
  it('basic-auth platform (BambooHR) is enabled once the secret is saved', () => {
    expect(isAutomationSaveDisabled({ ...valid, sourcePlatform: 'bamboohr', secretSaved: true })).toBe(false);
  });

  it('new automation is disabled until the secret is saved', () => {
    expect(isAutomationSaveDisabled({ ...valid, editingAutomation: false, secretSaved: false })).toBe(true);
  });

  it('Salesforce is exempt from the secret requirement (bootstrap flow)', () => {
    expect(isAutomationSaveDisabled({ ...valid, sourcePlatform: 'salesforce', secretSaved: false })).toBe(false);
  });

  it('editing an existing automation does not re-require the secret', () => {
    expect(isAutomationSaveDisabled({ ...valid, editingAutomation: true, secretSaved: false })).toBe(false);
  });
});

describe('automationSaveBlockReason', () => {
  it('returns null when the form is ready to submit', () => {
    expect(automationSaveBlockReason(valid)).toBeNull();
  });

  it('reports "saving" while a save is in flight (takes priority)', () => {
    expect(automationSaveBlockReason({ ...valid, saving: true, name: '' })).toBe('saving');
  });

  it('reports "missing-fields" when a required field is empty', () => {
    expect(automationSaveBlockReason({ ...valid, workflowId: '' })).toBe('missing-fields');
  });

  it('reports "secret-unsaved" when only the unsaved secret blocks creation', () => {
    expect(automationSaveBlockReason({ ...valid, secretSaved: false })).toBe('secret-unsaved');
  });

  it('does not report "secret-unsaved" for Salesforce', () => {
    expect(automationSaveBlockReason({ ...valid, sourcePlatform: 'salesforce', secretSaved: false })).toBeNull();
  });

  it('does not report "secret-unsaved" when editing', () => {
    expect(automationSaveBlockReason({ ...valid, editingAutomation: true, secretSaved: false })).toBeNull();
  });

  it('missing fields take priority over the unsaved secret', () => {
    expect(automationSaveBlockReason({ ...valid, name: '', secretSaved: false })).toBe('missing-fields');
  });
});
