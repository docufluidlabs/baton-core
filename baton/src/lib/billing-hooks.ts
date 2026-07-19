/**
 * Billing Hooks — Baton
 *
 * Billing/licensing seam — the hosted edition injects real implementations.
 * The open core ships permissive defaults: every relay is allowed and usage
 * metering is a no-op, so a self-hosted install runs fully unlocked.
 */

/** Decides whether an org may launch another relay right now. */
export interface RelayGate {
  check(orgId: string): Promise<{ allowed: boolean; reason?: string }>;
}

/** Records billable relay usage for an org. */
export interface RelayMeter {
  /**
   * @param idempotencyKey stable per-relay key (the WorkflowInstance id) so
   *        retries that eventually succeed are recorded exactly once.
   */
  record(orgId: string, count: number, idempotencyKey?: string): Promise<void>;
}

const allowAllGate: RelayGate = {
  check: async () => ({ allowed: true }),
};

const noopMeter: RelayMeter = {
  record: async () => {},
};

let relayGate: RelayGate = allowAllGate;
let relayMeter: RelayMeter = noopMeter;

/** Replace the relay gate (hosted edition injects plan/cap enforcement). */
export function setRelayGate(gate: RelayGate): void {
  relayGate = gate;
}

/** Replace the relay meter (hosted edition injects usage-based billing). */
export function setRelayMeter(meter: RelayMeter): void {
  relayMeter = meter;
}

export function getRelayGate(): RelayGate {
  return relayGate;
}

export function getRelayMeter(): RelayMeter {
  return relayMeter;
}
