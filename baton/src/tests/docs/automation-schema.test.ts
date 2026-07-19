/**
 * Automation schema tests — Baton
 *
 * Regression guard for BUG-Z01: a specific trigger event picked in the UI was
 * lost when EDITING an automation, because UpdateAutomationInput didn't include
 * `eventType`/`eventLabel`, so Zod stripped them from the PATCH body and the
 * route only persisted whitelisted fields.
 */
import { describe, it, expect } from 'vitest';
import { CreateAutomationInput, UpdateAutomationInput } from '../../docs/schemas/automation';

const WF_ID = '11111111-1111-1111-1111-111111111111';

describe('UpdateAutomationInput', () => {
  it('keeps eventType and eventLabel (BUG-Z01 regression)', () => {
    const parsed = UpdateAutomationInput.parse({
      name: 'My rule',
      eventType: 'ticket.created',
      eventLabel: 'Ticket Created',
      targetWorkflowId: WF_ID,
    });
    expect(parsed.eventType).toBe('ticket.created');
    expect(parsed.eventLabel).toBe('Ticket Created');
  });

  it('allows partial updates that omit eventType', () => {
    const parsed = UpdateAutomationInput.parse({ name: 'Renamed' });
    expect(parsed.name).toBe('Renamed');
    expect(parsed.eventType).toBeUndefined();
  });

  it('rejects an empty eventType', () => {
    expect(() => UpdateAutomationInput.parse({ eventType: '' })).toThrow();
  });
});

describe('CreateAutomationInput', () => {
  it('persists the chosen eventType', () => {
    const parsed = CreateAutomationInput.parse({
      name: 'My rule',
      appSlug: 'zendesk',
      sourcePlatform: 'zendesk',
      eventType: 'ticket.solved',
      eventLabel: 'Ticket Solved',
      targetWorkflowId: WF_ID,
    });
    expect(parsed.eventType).toBe('ticket.solved');
    expect(parsed.eventLabel).toBe('Ticket Solved');
  });
});
