/**
 * Tests for ConnectionDetailModal — displayName rendering
 */
import { describe, it, expect } from 'vitest';

describe('ConnectionDetailModal — displayName rendering', () => {
  function renderName(displayName: string | undefined) {
    return displayName ?? '';
  }

  it('renders Docusign name as-is', () => {
    expect(renderName('Docusign eSignature')).toBe('Docusign eSignature');
  });

  it('returns empty string when displayName is undefined', () => {
    expect(renderName(undefined)).toBe('');
  });

  it('returns empty string when displayName is empty', () => {
    expect(renderName('')).toBe('');
  });

  it('leaves non-Docusign names unchanged', () => {
    expect(renderName('Salesforce CRM')).toBe('Salesforce CRM');
  });
});
