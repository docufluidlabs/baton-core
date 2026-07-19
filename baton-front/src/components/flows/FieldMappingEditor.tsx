/**
 * Field Mapping Editor — Baton
 * Visual editor for mapping webhook payload fields → Maestro trigger inputs
 */
import { Plus, Trash2, ArrowRight } from 'lucide-react';

export interface FieldMapping {
  id: string;
  sourceField: string;
  targetField: string;
  type: 'path' | 'static' | 'template';
  value?: string;
}

interface Props {
  mappings: FieldMapping[];
  onChange: (mappings: FieldMapping[]) => void;
  sourceFields?: string[];
  targetFields?: string[];
  requiredFields?: string[];
  fieldTypes?: Record<string, string>;
}

export function FieldMappingEditor({ mappings, onChange, sourceFields = [], targetFields = [], requiredFields = [], fieldTypes = {} }: Props) {
  function addMapping() {
    onChange([
      ...mappings,
      { id: crypto.randomUUID(), sourceField: '', targetField: '', type: 'path' },
    ]);
  }

  function updateMapping(id: string, updates: Partial<FieldMapping>) {
    onChange(mappings.map((m) => (m.id === id ? { ...m, ...updates } : m)));
  }

  function removeMapping(id: string) {
    onChange(mappings.filter((m) => m.id !== id));
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-gray-700">Field Mapping</label>
        <button
          onClick={addMapping}
          className="text-xs text-brand-600 hover:text-brand-700 font-medium flex items-center gap-1"
        >
          <Plus className="w-3.5 h-3.5" /> Add field
        </button>
      </div>

      {mappings.length === 0 && (
        <p className="text-xs text-gray-400 py-3 text-center border border-dashed border-gray-200 rounded-lg">
          No field mappings. Webhook payload will be passed as-is.
        </p>
      )}

      {mappings.map((mapping) => (
        <div key={mapping.id} className="bg-gray-50 rounded-lg p-3 space-y-2">
          {/* Row 1: Source → Target */}
          <div className="flex items-end gap-2">
            <div className="flex-1 min-w-0">
              <label className="text-[10px] text-gray-500 mb-1 block">Source (webhook)</label>
              {sourceFields.length > 0 ? (
                <select
                  value={mapping.sourceField}
                  onChange={(e) => updateMapping(mapping.id, { sourceField: e.target.value })}
                  className="w-full text-xs border border-gray-200 rounded px-2 py-1.5 bg-white"
                >
                  <option value="">Select field...</option>
                  {sourceFields.map((f) => (
                    <option key={f} value={f}>{f}</option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={mapping.sourceField}
                  onChange={(e) => updateMapping(mapping.id, { sourceField: e.target.value })}
                  placeholder="$.data.field_name"
                  className="w-full text-xs border border-gray-200 rounded px-2 py-1.5 font-mono"
                />
              )}
            </div>

            <ArrowRight className="w-4 h-4 text-gray-400 mb-1.5 shrink-0" />

            <div className="flex-1 min-w-0">
              <label className="text-[10px] text-gray-500 mb-1 block">Target (Maestro input)</label>
              {targetFields.length > 0 ? (
                <select
                  value={mapping.targetField}
                  onChange={(e) => updateMapping(mapping.id, { targetField: e.target.value })}
                  className="w-full text-xs border border-gray-200 rounded px-2 py-1.5 bg-white"
                >
                  <option value="">Select input...</option>
                  {targetFields.map((f) => (
                    <option key={f} value={f}>
                      {f}{requiredFields.includes(f) ? ' *' : ''}{fieldTypes[f] ? ` (${fieldTypes[f]})` : ''}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={mapping.targetField}
                  onChange={(e) => updateMapping(mapping.id, { targetField: e.target.value })}
                  placeholder="trigger_input_name"
                  className="w-full text-xs border border-gray-200 rounded px-2 py-1.5 font-mono"
                />
              )}
            </div>
          </div>

          {/* Row 2: Type + Delete */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <label className="text-[10px] text-gray-500">Type:</label>
              <select
                value={mapping.type}
                onChange={(e) => updateMapping(mapping.id, { type: e.target.value as FieldMapping['type'] })}
                className="text-xs border border-gray-200 rounded px-2 py-1 bg-white"
              >
                <option value="path">Path</option>
                <option value="static">Static</option>
                <option value="template">Template</option>
              </select>
            </div>
            <button
              onClick={() => removeMapping(mapping.id)}
              className="p-1 text-gray-400 hover:text-red-500"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      ))}

      {requiredFields.length > 0 && (() => {
        const mappedTargets = new Set(mappings.map((m) => m.targetField));
        const missing = requiredFields.filter((f) => !mappedTargets.has(f));
        if (missing.length === 0) return null;
        return (
          <p className="text-[10px] text-amber-600 bg-amber-50 rounded px-2 py-1.5">
            Required inputs not yet mapped: {missing.map((f) => <code key={f} className="bg-amber-100 px-1 rounded mx-0.5">{f}</code>)}
          </p>
        );
      })()}

      {mappings.length > 0 && (
        <p className="text-[10px] text-gray-400">
          Path: use dot notation like <code className="bg-gray-100 px-1 rounded">$.data.project_id</code>.
          Static: fixed value. Template: <code className="bg-gray-100 px-1 rounded">{'{{field}}'}</code> interpolation.
        </p>
      )}
    </div>
  );
}

/**
 * Convert FieldMapping[] to actionConfig.fieldMapping format for the API
 */
type ApiFieldMappingValue =
  | string
  | { type: 'static'; value: string }
  | { type: 'template'; template: string }
  | Record<string, unknown>;

export function toApiFieldMapping(mappings: FieldMapping[]): Record<string, ApiFieldMappingValue> {
  const result: Record<string, ApiFieldMappingValue> = {};
  for (const m of mappings) {
    if (!m.targetField) continue;
    const source = (m.sourceField ?? '').trim();
    if (m.type === 'static') {
      // Inline-edited value lives in sourceField; fall back to a previously loaded `value`.
      const value = source || (m.value ?? '');
      if (!value) continue;
      result[m.targetField] = { type: 'static', value };
    } else if (m.type === 'template') {
      if (!source) continue;
      result[m.targetField] = { type: 'template', template: m.sourceField };
    } else {
      // Path: skip empty rows so we don't emit a bare "$." for unmapped inputs.
      if (!source) continue;
      result[m.targetField] = source.startsWith('$.') ? source : `$.${source}`;
    }
  }
  return result;
}

/**
 * Convert API fieldMapping format back to FieldMapping[] for the editor
 */
export function fromApiFieldMapping(fieldMapping: Record<string, unknown> | undefined): FieldMapping[] {
  if (!fieldMapping) return [];
  return Object.entries(fieldMapping).map(([targetField, sourceSpec]) => {
    if (typeof sourceSpec === 'string') {
      return {
        id: crypto.randomUUID(),
        sourceField: sourceSpec,
        targetField,
        type: 'path' as const,
      };
    }
    if (typeof sourceSpec === 'object' && sourceSpec !== null) {
      const s = sourceSpec as Record<string, unknown>;
      if (s.type === 'static') {
        return {
          id: crypto.randomUUID(),
          sourceField: (s.value as string) || '',
          targetField,
          type: 'static' as const,
          value: s.value as string,
        };
      }
      if (s.type === 'template') {
        return {
          id: crypto.randomUUID(),
          sourceField: (s.template as string) || '',
          targetField,
          type: 'template' as const,
        };
      }
    }
    return { id: crypto.randomUUID(), sourceField: '', targetField, type: 'path' as const };
  });
}
