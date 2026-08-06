/**
 * Tests for the Bulk Upload wizard mapping step.
 * Key behaviors verified:
 * - every parameter's dropdown lists ALL detected file columns plus
 *   "Fixed value..." and "- not set -"
 * - normalized header matches (case-insensitive, non-alphanumerics stripped)
 *   are auto-preselected; unmatched parameters start unset
 * - the live payload preview is built from row 1 of the file
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  WizardMappingStep,
  autoMapColumns,
  normalizeHeader,
  toApiMapping,
  type MappingChoice,
} from './BulkUploadWizard';
import type { SchemaField } from '@/hooks/useApi';

function field(key: string, overrides: Partial<SchemaField> = {}): SchemaField {
  return {
    key,
    label: key,
    type: 'string',
    dataType: 'String',
    enum: undefined,
    required: false,
    defaultValue: undefined,
    ...overrides,
  };
}

const FIELDS = [field('signer_email', { required: true }), field('amount'), field('contract_id')];
const COLUMNS = ['Signer Email', 'Amount', 'Notes'];
const PREVIEW_ROW = { 'Signer Email': 'jane@acme.com', Amount: '1200', Notes: 'rush order' };

describe('normalizeHeader', () => {
  it('lowercases and strips non-alphanumerics', () => {
    expect(normalizeHeader('Signer Email')).toBe('signeremail');
    expect(normalizeHeader('signer_email')).toBe('signeremail');
    expect(normalizeHeader('SIGNER-EMAIL ')).toBe('signeremail');
  });
});

describe('autoMapColumns', () => {
  it('preselects columns on normalized header match and leaves the rest unset', () => {
    const mapping = autoMapColumns(FIELDS, COLUMNS);
    expect(mapping.signer_email).toEqual({ kind: 'column', column: 'Signer Email' });
    expect(mapping.amount).toEqual({ kind: 'column', column: 'Amount' });
    expect(mapping.contract_id).toEqual({ kind: 'unset' });
  });

  it('does not auto-pick between columns that share a normalized form', () => {
    // Smartsheet reality: "Contact$" and "Contact%" both normalize to
    // "contact" - guessing either would silently send the wrong value.
    const mapping = autoMapColumns(
      [field('contact'), field('vendor_id')],
      ['Vendor ID', 'Contact$', 'Contact%'],
    );
    expect(mapping.contact).toEqual({ kind: 'unset' });
    expect(mapping.vendor_id).toEqual({ kind: 'column', column: 'Vendor ID' });
  });
});

describe('toApiMapping', () => {
  it('converts choices to the API shape, omitting unset parameters', () => {
    const mapping: Record<string, MappingChoice> = {
      signer_email: { kind: 'column', column: 'Signer Email' },
      amount: { kind: 'fixed', value: '42' },
      contract_id: { kind: 'unset' },
    };
    expect(toApiMapping(mapping)).toEqual({
      signer_email: { type: 'column', column: 'Signer Email' },
      amount: { type: 'fixed', value: '42' },
    });
  });
});

describe('WizardMappingStep', () => {
  function renderStep(mapping = autoMapColumns(FIELDS, COLUMNS), onChange = vi.fn()) {
    const utils = render(
      <WizardMappingStep
        fields={FIELDS}
        columns={COLUMNS}
        previewRow={PREVIEW_ROW}
        mapping={mapping}
        onChange={onChange}
      />,
    );
    return { ...utils, onChange };
  }

  it('lists every detected column plus "Fixed value..." and "- not set -" in each dropdown', () => {
    renderStep();
    for (const f of FIELDS) {
      const select = screen.getByLabelText(`Map ${f.key}`) as HTMLSelectElement;
      const labels = Array.from(select.options).map((o) => o.text);
      expect(labels).toEqual([...COLUMNS, 'Fixed value...', '- not set -']);
    }
  });

  it('auto-match preselects matching columns and leaves unmatched parameters unset', () => {
    renderStep();
    const emailSelect = screen.getByLabelText('Map signer_email') as HTMLSelectElement;
    expect(emailSelect.selectedOptions[0].text).toBe('Signer Email');
    const contractSelect = screen.getByLabelText('Map contract_id') as HTMLSelectElement;
    expect(contractSelect.selectedOptions[0].text).toBe('- not set -');
  });

  it('builds the live payload preview from row 1', () => {
    const { container } = renderStep();
    const pre = container.querySelector('pre');
    expect(pre?.textContent).toContain('"signer_email": "jane@acme.com"');
    expect(pre?.textContent).toContain('"amount": "1200"');
    expect(pre?.textContent).not.toContain('contract_id');
  });

  it('reveals a text input when "Fixed value..." is chosen', () => {
    const { onChange } = renderStep();
    const contractSelect = screen.getByLabelText('Map contract_id') as HTMLSelectElement;
    fireEvent.change(contractSelect, { target: { value: '__fixed__' } });
    expect(onChange).toHaveBeenCalledWith('contract_id', { kind: 'fixed', value: '' });

    // Re-render with the fixed choice applied - the input appears
    renderStep({ ...autoMapColumns(FIELDS, COLUMNS), contract_id: { kind: 'fixed', value: '' } });
    expect(screen.getByLabelText('Fixed value for contract_id')).toBeInTheDocument();
  });

  it('lists unused columns below the mapping', () => {
    renderStep();
    expect(screen.getByText(/Unused columns: Notes/)).toBeInTheDocument();
  });
});
