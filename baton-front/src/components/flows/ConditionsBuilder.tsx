/**
 * Conditions Builder — Baton
 * Visual editor for rule conditions (field / operator / value rows)
 * Backend supports: eq, neq, gt, gte, lt, lte, in, contains, regex, exists, not_exists
 *
 * Fix: ConditionRow customMode state was initialized from props once and never
 * updated when the `fields` list or `condition.field` changed via the parent
 * (e.g. after the user switches source platform). Now derived via useMemo so
 * it always reflects the current props, with a separate forceCustom override
 * only for explicit user choice.
 */
import { useState, useMemo } from 'react';
import { Plus, Trash2, Pencil } from 'lucide-react';

export interface Condition {
  id: string;
  field: string;
  operator: string;
  value: string;
}

interface Props {
  conditions: Condition[];
  onChange: (conditions: Condition[]) => void;
  platform?: string;
}

interface FieldDef {
  path: string;
  label: string;
  type?: 'string' | 'number' | 'array';
}

// ─── Known payload fields per platform ──────────────────────

const PLATFORM_FIELDS: Record<string, FieldDef[]> = {
  docusign: [
    { path: 'event', label: 'Event name' },
    { path: 'data.envelopeId', label: 'Envelope ID' },
    { path: 'data.envelopeSummary.status', label: 'Envelope status' },
    { path: 'data.envelopeSummary.sender.email', label: 'Sender email' },
    { path: 'data.envelopeSummary.emailSubject', label: 'Email subject' },
    { path: 'data.envelopeSummary.sender.userName', label: 'Sender name' },
    { path: 'data.envelopeSummary.documentsCount', label: 'Documents count', type: 'number' },
    { path: 'data.envelopeSummary.recipientsCount', label: 'Recipients count', type: 'number' },
  ],
  procore: [
    { path: 'resource_name', label: 'Resource name' },
    { path: 'event_type', label: 'Event type' },
    { path: 'resource_id', label: 'Resource ID' },
    { path: 'project_id', label: 'Project ID' },
    { path: 'company_id', label: 'Company ID' },
    { path: 'user_id', label: 'User ID' },
    { path: 'api_version', label: 'API version' },
  ],
  xero: [
    { path: 'events[0].resourceId', label: 'Resource ID' },
    { path: 'events[0].resourceUrl', label: 'Resource URL' },
    { path: 'events[0].eventType', label: 'Event type' },
    { path: 'events[0].eventCategory', label: 'Event category' },
    { path: 'events[0].eventDateUtc', label: 'Event date (UTC)' },
    { path: 'events[0].tenantId', label: 'Tenant ID' },
    { path: 'firstEventSequence', label: 'First event sequence', type: 'number' },
    { path: 'lastEventSequence', label: 'Last event sequence', type: 'number' },
  ],
  bamboohr: [
    { path: 'employees[0].id', label: 'Employee ID' },
    { path: 'employees[0].changedFields', label: 'Changed fields', type: 'array' },
  ],
  smartsheet: [
    { path: 'webhookId', label: 'Webhook ID' },
    { path: 'scope', label: 'Scope' },
    { path: 'scopeObjectId', label: 'Scope object ID' },
    { path: 'events[0].objectType', label: 'Object type' },
    { path: 'events[0].eventType', label: 'Event type' },
    { path: 'events[0].id', label: 'Object ID' },
    { path: 'events[0].userId', label: 'User ID' },
    { path: 'events[0].rowId', label: 'Row ID' },
    { path: 'events[0].columnId', label: 'Column ID' },
  ],
  zohocrm: [
    { path: 'module', label: 'Module name' },
    { path: 'operation', label: 'Operation type' },
    { path: 'ids', label: 'Record IDs', type: 'array' },
    { path: 'ids[0]', label: 'First record ID' },
    { path: 'token', label: 'Token' },
  ],
};

const OPERATORS = [
  { value: 'eq', label: '= equals' },
  { value: 'neq', label: '!= not equals' },
  { value: 'gt', label: '> greater than' },
  { value: 'gte', label: '>= greater or equal' },
  { value: 'lt', label: '< less than' },
  { value: 'lte', label: '<= less or equal' },
  { value: 'contains', label: 'contains' },
  { value: 'in', label: 'in (comma-separated)' },
  { value: 'regex', label: 'matches regex' },
  { value: 'exists', label: 'exists' },
  { value: 'not_exists', label: 'does not exist' },
];

const NO_VALUE_OPERATORS = ['exists', 'not_exists'];

export function ConditionsBuilder({ conditions, onChange, platform }: Props) {
  const fields = platform ? PLATFORM_FIELDS[platform] || [] : [];

  function addCondition() {
    onChange([
      ...conditions,
      { id: crypto.randomUUID(), field: '', operator: 'eq', value: '' },
    ]);
  }

  function updateCondition(id: string, updates: Partial<Condition>) {
    onChange(conditions.map((c) => (c.id === id ? { ...c, ...updates } : c)));
  }

  function removeCondition(id: string) {
    onChange(conditions.filter((c) => c.id !== id));
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-gray-700">Conditions</label>
        <button
          onClick={addCondition}
          className="text-xs text-brand-600 hover:text-brand-700 font-medium flex items-center gap-1"
        >
          <Plus className="w-3.5 h-3.5" /> Add condition
        </button>
      </div>

      {conditions.length === 0 && (
        <p className="text-xs text-gray-400 py-3 text-center border border-dashed border-gray-200 rounded-lg">
          No conditions. Automation will trigger on every matching event.
        </p>
      )}

      {conditions.map((cond) => (
        <ConditionRow
          key={cond.id}
          condition={cond}
          fields={fields}
          onUpdate={(updates) => updateCondition(cond.id, updates)}
          onRemove={() => removeCondition(cond.id)}
        />
      ))}

      {conditions.length > 0 && fields.length === 0 && (
        <p className="text-[10px] text-gray-400">
          Use dot notation for nested fields: <code className="bg-gray-100 px-1 rounded">data.field_name</code>
        </p>
      )}
    </div>
  );
}

// ─── Condition Row ──────────────────────────────────────────

function ConditionRow({
  condition,
  fields,
  onUpdate,
  onRemove,
}: {
  condition: Condition;
  fields: FieldDef[];
  onUpdate: (updates: Partial<Condition>) => void;
  onRemove: () => void;
}) {
  // Derived from props — updates whenever fields list or condition.field changes.
  // This fixes the stale-closure bug where switching platform left customMode stuck.
  const isKnownField = useMemo(
    () => fields.some((f) => f.path === condition.field),
    [fields, condition.field],
  );

  // Explicit user override: user clicked "Custom field...".
  // Reset when field becomes a known field again.
  const [forceCustom, setForceCustom] = useState(false);

  // custom mode = user forced it, OR field is non-empty and not in known list
  const customMode = forceCustom || (!isKnownField && condition.field !== '');

  function handleFieldSelect(value: string) {
    if (value === '__custom__') {
      setForceCustom(true);
      onUpdate({ field: '' });
    } else {
      setForceCustom(false);
      onUpdate({ field: value });
    }
  }

  function handleBackToKnown() {
    setForceCustom(false);
    onUpdate({ field: '' });
  }

  return (
    <div className="bg-gray-50 rounded-lg p-3 space-y-2">
      {/* Row 1: Field + Delete */}
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <label className="text-[10px] text-gray-500 mb-1 block">Field</label>
          {fields.length > 0 && !customMode ? (
            <select
              value={condition.field}
              onChange={(e) => handleFieldSelect(e.target.value)}
              className="w-full text-xs border border-gray-200 rounded px-2 py-1.5 bg-white"
            >
              <option value="">Select field...</option>
              {fields.map((f) => (
                <option key={f.path} value={f.path}>
                  {f.label}
                </option>
              ))}
              <option value="__custom__">Custom field...</option>
            </select>
          ) : (
            <div className="flex gap-1">
              <input
                type="text"
                value={condition.field}
                onChange={(e) => onUpdate({ field: e.target.value })}
                placeholder="data.field_name"
                className="w-full text-xs border border-gray-200 rounded px-2 py-1.5 font-mono"
              />
              {fields.length > 0 && (
                <button
                  onClick={handleBackToKnown}
                  title="Pick from known fields"
                  className="shrink-0 p-1.5 text-gray-400 hover:text-brand-600 border border-gray-200 rounded hover:border-brand-300"
                >
                  <Pencil className="w-3 h-3" />
                </button>
              )}
            </div>
          )}
          {!customMode && condition.field && fields.length > 0 && (
            <p className="text-[10px] text-gray-400 mt-0.5 font-mono truncate">{condition.field}</p>
          )}
        </div>
        <button
          onClick={onRemove}
          className="mt-5 p-1 text-gray-400 hover:text-red-500"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Row 2: Operator + Value */}
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <label className="text-[10px] text-gray-500 mb-1 block">Operator</label>
          <select
            value={condition.operator}
            onChange={(e) => onUpdate({ operator: e.target.value })}
            className="w-full text-xs border border-gray-200 rounded px-2 py-1.5 bg-white"
          >
            {OPERATORS.map((op) => (
              <option key={op.value} value={op.value}>{op.label}</option>
            ))}
          </select>
        </div>

        {!NO_VALUE_OPERATORS.includes(condition.operator) && (
          <div className="flex-1 min-w-0">
            <label className="text-[10px] text-gray-500 mb-1 block">Value</label>
            <input
              type="text"
              value={condition.value}
              onChange={(e) => onUpdate({ value: e.target.value })}
              placeholder={condition.operator === 'in' ? 'val1, val2, val3' : 'value'}
              className="w-full text-xs border border-gray-200 rounded px-2 py-1.5"
            />
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Convert Condition[] to API conditions format
 * Backend expects: { "$.field": { operator: "eq", value: "..." } }
 */
export function toApiConditions(conditions: Condition[]): Record<string, unknown> {
  if (conditions.length === 0) return {};
  const result: Record<string, unknown> = {};
  for (const c of conditions) {
    if (!c.field) continue;
    const key = c.field.startsWith('$.') ? c.field : `$.${c.field}`;
    if (NO_VALUE_OPERATORS.includes(c.operator)) {
      result[key] = { operator: c.operator };
    } else if (c.operator === 'in') {
      result[key] = { operator: 'in', value: c.value.split(',').map((v) => v.trim()) };
    } else {
      result[key] = { operator: c.operator, value: c.value };
    }
  }
  return result;
}

/**
 * Convert API conditions format back to Condition[]
 */
export function fromApiConditions(conditions: Record<string, unknown> | undefined): Condition[] {
  if (!conditions || Object.keys(conditions).length === 0) return [];
  return Object.entries(conditions).map(([field, spec]) => {
    if (typeof spec === 'object' && spec !== null) {
      const s = spec as Record<string, unknown>;
      return {
        id: crypto.randomUUID(),
        field,
        operator: (s.operator as string) || 'eq',
        value: Array.isArray(s.value)
          ? (s.value as string[]).join(', ')
          : String(s.value ?? ''),
      };
    }
    return {
      id: crypto.randomUUID(),
      field,
      operator: 'eq',
      value: String(spec),
    };
  });
}
