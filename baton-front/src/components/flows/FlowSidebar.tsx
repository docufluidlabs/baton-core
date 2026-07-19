/**
 * Flow Sidebar — Automation Creator / Editor
 * Slides in from the right when user clicks "Add Automation" or edits existing
 *
 * Fixes applied:
 * - PLATFORM_ICONS imported from src/lib/utils.ts (was duplicated locally).
 * - TriggerHistory no longer uses useInstances({ limit: 100 }) to build a
 *   client-side lookup map. That hook fetched 100 instances every 10 s just to
 *   decorate ≤20 history rows — classic N+1 at hook level. History is now
 *   rendered with its own status from the history endpoint only.
 * - Auto-name useEffect dependency array now includes `eventTypes` and
 *   `workflows` so the generated name updates after async data arrives
 *   (previously they were empty on first render → stale name).
 * - timeAgo imported from src/lib/utils.ts instead of re-declared inline.
 */
import { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  usePlatforms,
  useConnections,
  useWorkflows,
  useAutomations,
  useInstalledPlatforms,
  usePlatformTemplates,
  // useAutomationEventTypes, // kept for commented-out event picker
  createAutomation,
  updateAutomation,
  deleteAutomation,
  syncSingleWorkflow,
  syncWorkflows,
  updateConnectionWebhookSecret,
  updateAppWebhookSecret,
  preflightAutomation,
  connectPlatform,
  installPlatform,
  parseTriggerInputSchema,
  type Automation,
  type PlatformTemplate,
} from '@/hooks/useApi';
import { useSWRConfig } from 'swr';
import { X, Zap, ArrowRight, Loader2, CheckCircle, RefreshCw, ExternalLink, AlertCircle, ChevronDown, Copy, Plus, Trash2, Eye, EyeOff } from 'lucide-react';
import { PlatformIcon, PLATFORM_BRAND_COLORS } from '@/components/ui/PlatformIcon';
import { toast } from 'sonner';
import clsx from 'clsx';
import {
  // FieldMappingEditor, // temporarily hidden
  toApiFieldMapping,
  fromApiFieldMapping,
  type FieldMapping,
} from './FieldMappingEditor';
import {
  // ConditionsBuilder, // temporarily hidden
  toApiConditions,
  fromApiConditions,
  type Condition,
} from './ConditionsBuilder';
import { useFlowStore } from '@/stores/flowStore';
import { automationSaveBlockReason } from './automationSaveGuard';

// ─── Reusable Portal Select ─────────────────────────────────

interface PortalSelectOption {
  value: string;
  label: string;
}

function PortalSelect({
  value,
  onChange,
  options,
  placeholder = 'Select...',
  className = '',
  searchable = false,
}: {
  value: string;
  onChange: (value: string) => void;
  options: PortalSelectOption[];
  placeholder?: string;
  className?: string;
  searchable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const btnRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (
        listRef.current && !listRef.current.contains(e.target as Node) &&
        btnRef.current && !btnRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  useEffect(() => {
    if (open && searchable) {
      setSearch('');
      setTimeout(() => searchRef.current?.focus(), 0);
    }
  }, [open, searchable]);

  function toggle() {
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
    }
    setOpen(!open);
  }

  const selected = options.find((o) => o.value === value);
  const filtered = searchable && search.trim()
    ? options.filter((o) => o.label.toLowerCase().includes(search.toLowerCase()))
    : options;

  return (
    <div className={className}>
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        className="w-full flex items-center gap-2 px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white hover:border-gray-300 focus:ring-2 focus:ring-brand-500 outline-none text-left"
      >
        <span className={clsx('flex-1 truncate', selected ? 'text-gray-900' : 'text-gray-400')}>
          {selected?.label || placeholder}
        </span>
        <ChevronDown className={clsx('w-4 h-4 text-gray-400 shrink-0 transition-transform', open && 'rotate-180')} />
      </button>
      {open && createPortal(
        <div
          ref={listRef}
          className="fixed z-[9999] bg-white border border-gray-200 rounded-lg shadow-lg"
          style={{ top: pos.top, left: pos.left, width: pos.width }}
        >
          {searchable && (
            <div className="p-2 border-b border-gray-100">
              <input
                ref={searchRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search..."
                className="w-full px-2.5 py-1.5 text-sm border border-gray-200 rounded-md outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
          )}
          <div className="max-h-[220px] overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-3 py-2 text-sm text-gray-400">No results</div>
            ) : filtered.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => { onChange(o.value); setOpen(false); }}
                className={clsx(
                  'w-full text-left px-3 py-2 text-sm hover:bg-gray-50 transition-colors',
                  value === o.value && 'bg-brand-50 text-brand-700',
                )}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

interface FlowSidebarProps {
  open: boolean;
  onClose: () => void;
  editingAutomation?: Automation | null;
  onSaved: () => void;
}

type SourceType = 'connection' | 'app' | 'new';

export function FlowSidebar({ open, onClose, editingAutomation, onSaved }: FlowSidebarProps) {
  const preSelectedPlatform = useFlowStore((s) => s.preSelectedPlatform);
  const { data: platformsData } = usePlatforms();
  const { data: connectionsData } = useConnections();
  const { data: workflowsData } = useWorkflows();
  const { data: automationsData } = useAutomations();
  const { data: installedPlatformsData } = useInstalledPlatforms();
  const { data: templatesData } = usePlatformTemplates();
  // const { data: eventTypesData } = useAutomationEventTypes(...); // kept for commented-out event picker
  const { mutate } = useSWRConfig();
  const connections = connectionsData?.connections || [];
  const allAutomations = automationsData?.automations || [];
  const installedPlatforms = installedPlatformsData?.platforms || [];
  const platformTemplates = templatesData?.templates || [];

  const [sourceKey, setSourceKey] = useState('');
  const [eventType, setEventType] = useState('*');
  const [workflowId, setWorkflowId] = useState('');
  const [name, setName] = useState('');
  const [fieldMappings, setFieldMappings] = useState<FieldMapping[]>([]);
  const [conditions, setConditions] = useState<Condition[]>([]);
  const [expectedDurationDays, setExpectedDurationDays] = useState<string>('');
  const [syncing, setSyncing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingSecret, setEditingSecret] = useState(!editingAutomation);
  const [secretValue, setSecretValue] = useState('');
  const [secretUsername, setSecretUsername] = useState('');
  const [secretPassword, setSecretPassword] = useState('');
  const [usernameVisible, setUsernameVisible] = useState(false);
  const [savingSecret, setSavingSecret] = useState(false);
  const [secretSaved, setSecretSaved] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Pre-generated webhook URL for new automations
  const [preflightUrl, setPreflightUrl] = useState('');
  const [preflightKey, setPreflightKey] = useState('');
  const [preflightLoading, setPreflightLoading] = useState(false);
  const [preflightCopied, setPreflightCopied] = useState(false);
  const [sourceDropdownOpen, setSourceDropdownOpen] = useState(false);
  const sourceButtonRef = useRef<HTMLButtonElement>(null);
  const sourceDropdownRef = useRef<HTMLDivElement>(null);
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0, width: 0 });
  const [autoInstalling, setAutoInstalling] = useState<string | null>(null); // slug being installed

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        sourceDropdownRef.current && !sourceDropdownRef.current.contains(e.target as Node) &&
        sourceButtonRef.current && !sourceButtonRef.current.contains(e.target as Node)
      ) {
        setSourceDropdownOpen(false);
      }
    }
    if (sourceDropdownOpen) {
      document.addEventListener('mousedown', handleClick);
      return () => document.removeEventListener('mousedown', handleClick);
    }
  }, [sourceDropdownOpen]);

  function toggleSourceDropdown() {
    if (!sourceDropdownOpen && sourceButtonRef.current) {
      const rect = sourceButtonRef.current.getBoundingClientRect();
      setDropdownPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
    }
    setSourceDropdownOpen(!sourceDropdownOpen);
  }

  const sourceType: SourceType | '' = sourceKey.startsWith('connection:') ? 'connection' : sourceKey.startsWith('app:') ? 'app' : sourceKey.startsWith('new:') ? 'new' : '';
  const sourcePlatform = sourceKey.split(':')[1] || '';

  // const { data: eventTypesData } = useAutomationEventTypes(sourceType === 'connection' ? sourcePlatform : ''); // kept for commented-out event picker

  const platforms = platformsData?.platforms || [];
  const workflows = (workflowsData?.workflows || []).filter((wf) => wf.maestroStatus === 'active');

  // 1 workflow = 1 automation: exclude workflows already used by other automations
  const usedWorkflowIds = new Set(
    allAutomations
      .filter((a) => a.id !== editingAutomation?.id && a.targetWorkflowId)
      .map((a) => a.targetWorkflowId),
  );
  const availableWorkflows = workflows.filter((wf) => !usedWorkflowIds.has(wf.id));
  // eventTypes/eventTypesData — kept for commented-out event picker

  const { targetFields, requiredFields, fieldTypes } = useMemo(() => {
    const schema = workflows.find((w) => w.id === workflowId)?.triggerInputSchema;
    const parsed = parseTriggerInputSchema(schema);
    return {
      targetFields: parsed.map((f) => f.key),
      requiredFields: parsed.filter((f) => f.required).map((f) => f.key),
      fieldTypes: Object.fromEntries(parsed.map((f) => [f.key, f.dataType])),
    };
  }, [workflowId, workflows]);

  // Field mapping is keyed by Maestro target field — one row per API parameter.
  const mappingByTarget = useMemo(() => {
    const map: Record<string, FieldMapping> = {};
    for (const m of fieldMappings) {
      if (m.targetField) map[m.targetField] = m;
    }
    return map;
  }, [fieldMappings]);

  // Upsert the mapping for a single Maestro input (creates the row on first edit).
  function upsertMapping(targetField: string, updates: Partial<FieldMapping>) {
    setFieldMappings((prev) => {
      const idx = prev.findIndex((m) => m.targetField === targetField);
      if (idx === -1) {
        return [...prev, { id: crypto.randomUUID(), sourceField: '', targetField, type: 'path', ...updates }];
      }
      return prev.map((m, i) => (i === idx ? { ...m, ...updates } : m));
    });
  }

  // Mappings whose target isn't a declared Maestro input — rendered as editable
  // custom rows so users can still map when the workflow has no published schema.
  const customMappings = fieldMappings.filter((m) => !targetFields.includes(m.targetField));

  function updateMappingById(id: string, updates: Partial<FieldMapping>) {
    setFieldMappings((prev) => prev.map((m) => (m.id === id ? { ...m, ...updates } : m)));
  }
  function removeMappingById(id: string) {
    setFieldMappings((prev) => prev.filter((m) => m.id !== id));
  }
  function addCustomMapping() {
    setFieldMappings((prev) => [
      ...prev,
      { id: crypto.randomUUID(), sourceField: '', targetField: '', type: 'path' },
    ]);
  }

  // Pre-fill when editing
  useEffect(() => {
    if (editingAutomation) {
      setName(editingAutomation.name);
      if (editingAutomation.appSlug) {
        setSourceKey(`app:${editingAutomation.appSlug}`);
      } else {
        setSourceKey(`connection:${editingAutomation.sourcePlatform}`);
      }
      setEventType(editingAutomation.eventType);
      setWorkflowId(editingAutomation.targetWorkflowId || '');
      setFieldMappings(fromApiFieldMapping(editingAutomation.actionConfig?.fieldMapping as Record<string, unknown>));
      setConditions(fromApiConditions(editingAutomation.conditions as Record<string, unknown>));
      const dur = editingAutomation.actionConfig?.expectedDurationDays;
      setExpectedDurationDays(typeof dur === 'number' && dur > 0 ? String(dur) : '');
      setEditingSecret(false);
    } else {
      setName('');
      setEditingSecret(true);
      // Auto-select platform if opened from a platform "+" button
      if (preSelectedPlatform) {
        const connMatch = connections.find((c) => c.platform === preSelectedPlatform);
        if (connMatch) {
          setSourceKey(`connection:${preSelectedPlatform}`);
        } else if (installedPlatforms.find((a) => a.appSlug === preSelectedPlatform)) {
          setSourceKey(`app:${preSelectedPlatform}`);
        } else {
          setSourceKey('');
        }
      } else {
        setSourceKey('');
      }
      setEventType('*');
      setWorkflowId('');
      setFieldMappings([]);
      setConditions([]);
      setExpectedDurationDays('');
    }
    setConfirmingDelete(false);
    setDeleting(false);
    setSecretValue('');
    setSecretSaved(false);
    setPreflightUrl('');
    setPreflightKey('');
    setPreflightCopied(false);
  }, [editingAutomation, open, preSelectedPlatform]);


  // Clear stale preflight data immediately when source changes
  useEffect(() => {
    setPreflightUrl('');
    setPreflightKey('');
    setPreflightCopied(false);
  }, [sourceKey]);

  // Pre-generate webhook URL when source is selected (new automations only)
  useEffect(() => {
    if (editingAutomation || !sourcePlatform || sourceType === 'new') return;
    let cancelled = false;
    setPreflightLoading(true);
    preflightAutomation(sourcePlatform)
      .then((result) => {
        if (!cancelled) {
          setPreflightUrl(result.webhookUrl);
          setPreflightKey(result.webhookKey);
        }
      })
      .catch(() => { /* silent — field shows placeholder */ })
      .finally(() => { if (!cancelled) setPreflightLoading(false); });
    return () => { cancelled = true; };
  }, [sourcePlatform, sourceType, editingAutomation, open]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleCopyPreflightUrl() {
    const url = editingAutomation?.webhookUrl || preflightUrl;
    if (!url) return;
    await navigator.clipboard.writeText(url);
    setPreflightCopied(true);
    toast.success('Webhook URL copied');
    setTimeout(() => setPreflightCopied(false), 2000);
  }

  async function handleSyncWorkflow() {
    setSyncing(true);
    try {
      if (workflowId) {
        await syncSingleWorkflow(workflowId);
      } else {
        await syncWorkflows();
      }
      mutate('/workflows');
    } catch {
      // error shown by global handler
    } finally {
      setSyncing(false);
    }
  }

  const selectedWorkflow = workflows.find((w) => w.id === workflowId);

  async function handleSaveSecret() {
    const tmpl = platformTemplates.find((t) => t.slug === sourcePlatform);
    const isBasicAuth = !!(tmpl?.secretUsernameLabel || tmpl?.secretPasswordLabel);
    const resolvedSecret = isBasicAuth
      ? `${secretUsername.trim()}:${secretPassword.trim()}`
      : secretValue.trim();
    if (!resolvedSecret || (isBasicAuth && (!secretUsername.trim() || !secretPassword.trim()))) return;
    setSavingSecret(true);
    try {
      if (sourceType === 'connection') {
        const conn = connections.find((c) => c.platform === sourcePlatform);
        if (conn) await updateConnectionWebhookSecret(conn.id, resolvedSecret);
      } else if (sourceType === 'app') {
        const app = installedPlatforms.find((a) => a.appSlug === sourcePlatform && a.status === 'active');
        if (app) await updateAppWebhookSecret(app.id, resolvedSecret);
      }
      setEditingSecret(false);
      setSecretValue('');
      setSecretUsername('');
      setSecretPassword('');
      setSecretSaved(true);
    } catch {
      // error shown by global handler
    } finally {
      setSavingSecret(false);
    }
  }

  async function handleSelectNewPlatform(template: PlatformTemplate) {
    setSourceDropdownOpen(false);
    setAutoInstalling(template.slug);
    try {
      await installPlatform({ appSlug: template.slug, displayName: template.name });
      await mutate('/platforms/installed');
      setSourceKey(`app:${template.slug}`);
    } catch {
      // error shown by global handler
    } finally {
      setAutoInstalling(null);
    }
  }

  // OAuth: open authorize in new window
  function handleConnectOAuth(platform: string) {
    connectPlatform(platform);
  }

  async function handleDelete() {
    if (!editingAutomation) return;
    setDeleting(true);
    try {
      await deleteAutomation(editingAutomation.id);
      mutate('/automations');
      onSaved();
      onClose();
    } catch {
      // error shown by global handler
    } finally {
      setDeleting(false);
      setConfirmingDelete(false);
    }
  }

  async function handleSave() {
    if (!name || !sourcePlatform || !eventType || !workflowId) return;

    const fieldMapping = toApiFieldMapping(fieldMappings);
    const apiConditions = toApiConditions(conditions);
    const parsedDuration = parseInt(expectedDurationDays, 10);
    const actionConfig: Record<string, unknown> = { fieldMapping };
    if (Number.isFinite(parsedDuration) && parsedDuration > 0) {
      actionConfig.expectedDurationDays = parsedDuration;
    }

    // Human-readable label for the chosen event, derived from the platform's
    // catalog so it matches the picker (falls back to the raw type / "Any event").
    const selectedEvent = platformTemplates
      .find((t) => t.slug === sourcePlatform)?.supportedEvents
      ?.find((e) => e.eventType === eventType);
    const eventLabel = eventType === '*' ? 'Any event' : (selectedEvent?.label ?? eventType);

    setSaving(true);
    try {
      if (editingAutomation) {
        await updateAutomation(editingAutomation.id, {
          name,
          eventType,
          eventLabel,
          targetWorkflowId: workflowId,
          conditions: apiConditions,
          actionConfig,
        });
      } else {
        if (sourceType === 'app') {
          // Find the installed platform to get its id (needed as appId in the automation)
          const installedPlatform = installedPlatforms.find((a) => a.appSlug === sourcePlatform && a.status === 'active');
          await createAutomation({
            name,
            appId: installedPlatform?.id,
            appSlug: sourcePlatform,
            sourcePlatform,
            eventType,
            eventLabel,
            targetWorkflowId: workflowId,
            conditions: apiConditions,
            actionConfig,
            status: 'active',
            webhookKey: preflightKey || undefined,
          });
        } else {
          const conn = connections.find((c) => c.platform === sourcePlatform);
          if (!conn) {
            toast.error(`No connected ${sourcePlatform} account found. Connect it first on the Connections page.`);
            setSaving(false);
            return;
          }
          await createAutomation({
            name,
            sourcePlatform,
            eventType,
            eventLabel,
            connectionId: conn.id,
            targetWorkflowId: workflowId,
            conditions: apiConditions,
            actionConfig,
            status: 'active',
            webhookKey: preflightKey || undefined,
          });
        }
      }
      onSaved();
      onClose();
    } catch {
      // error shown by global handler
    } finally {
      setSaving(false);
    }
  }

  // Build source options
  // DocuSign is OAuth-only (no webhook source) — exclude from automation sources
  // TODO: re-enable when DocuSign Connect/Navigator webhook support is added
  const OAUTH_ONLY_PLATFORMS = new Set(['docusign']);

  const sourceOptions: Array<{ key: string; label: string; badge?: string; type: 'connected' | 'not_connected' | 'installed' | 'available' }> = [];

  for (const conn of connections) {
    if (OAUTH_ONLY_PLATFORMS.has(conn.platform)) continue;
    sourceOptions.push({
      key: `connection:${conn.platform}`,
      label: conn.displayName,
      badge: 'Connected',
      type: 'connected',
    });
  }

  for (const p of platforms) {
    if (OAUTH_ONLY_PLATFORMS.has(p.platform)) continue;
    if (!connections.some((c) => c.platform === p.platform)) {
      sourceOptions.push({
        key: `connection:${p.platform}`,
        label: p.displayName,
        badge: 'Not connected',
        type: 'not_connected',
      });
    }
  }

  for (const platform of installedPlatforms) {
    sourceOptions.push({
      key: `app:${platform.appSlug}`,
      label: platform.displayName,
      badge: 'Installed',
      type: 'installed',
    });
  }

  // Available catalog templates (not yet installed)
  const installedSlugs = new Set(installedPlatforms.map((p) => p.appSlug));
  for (const tmpl of platformTemplates) {
    if (!installedSlugs.has(tmpl.slug)) {
      sourceOptions.push({
        key: `new:${tmpl.slug}`,
        label: tmpl.name,
        badge: 'Available',
        type: 'available',
      });
    }
  }

  return (
    <>
      {open && <div className="fixed inset-0 bg-black/20 z-40" onClick={onClose} />}

      <div
        className={clsx(
          'fixed top-0 right-0 h-full w-full md:w-[400px] bg-white border-l border-gray-200 z-50 transition-transform duration-200',
          open ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-brand-500" />
            <h2 className="text-base font-semibold text-gray-900">
              {editingAutomation ? 'Edit Automation' : 'New Automation'}
            </h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <div className="p-5 space-y-5 overflow-y-auto overflow-x-hidden" style={{ maxHeight: 'calc(100vh - 140px)' }}>
          {/* Source */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Webhook Source</label>
            {editingAutomation ? (
              /* Read-only platform display when editing */
              <div className="flex items-center gap-2.5 px-3 py-2 text-sm border border-gray-200 rounded-lg bg-gray-50">
                <PlatformIcon platform={sourcePlatform} size={18} />
                <span className="flex-1 truncate text-gray-900">
                  {sourceOptions.find((o) => o.key === sourceKey)?.label || sourcePlatform}
                </span>
              </div>
            ) : (
            <div>
              <button
                ref={sourceButtonRef}
                type="button"
                onClick={toggleSourceDropdown}
                disabled={!!autoInstalling}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white hover:border-gray-300 focus:ring-2 focus:ring-brand-500 outline-none text-left disabled:opacity-60"
              >
                {autoInstalling ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin text-brand-500 shrink-0" />
                    <span className="flex-1 truncate text-gray-500">Installing {platformTemplates.find((t) => t.slug === autoInstalling)?.name ?? autoInstalling}...</span>
                  </>
                ) : sourceKey ? (
                  <>
                    <PlatformIcon platform={sourcePlatform} size={18} />
                    <span className="flex-1 truncate text-gray-900">
                      {sourceOptions.find((o) => o.key === sourceKey)?.label || sourcePlatform}
                    </span>
                  </>
                ) : (
                  <span className="flex-1 text-gray-400">Select source...</span>
                )}
                <ChevronDown className={clsx('w-4 h-4 text-gray-400 transition-transform', sourceDropdownOpen && 'rotate-180')} />
              </button>

              {sourceDropdownOpen && createPortal(
                <div
                  ref={sourceDropdownRef}
                  className="fixed z-[9999] bg-white border border-gray-200 rounded-lg shadow-lg max-h-[320px] overflow-y-auto"
                  style={{ top: dropdownPos.top, left: dropdownPos.left, width: dropdownPos.width }}
                >
                  {sourceOptions.filter((o) => o.type === 'connected').length > 0 && (
                    <>
                      <p className="px-3 pt-2 pb-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Connected</p>
                      {sourceOptions.filter((o) => o.type === 'connected').map((o) => (
                        <button
                          key={o.key}
                          type="button"
                          onClick={() => { setSourceKey(o.key); setEventType('*'); setSourceDropdownOpen(false); }}
                          className={clsx(
                            'w-full flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-gray-50 transition-colors',
                            sourceKey === o.key && 'bg-brand-50 text-brand-700',
                          )}
                        >
                          <PlatformIcon platform={o.key.split(':')[1]} size={18} />
                          <span className="truncate flex-1">{o.label}</span>
                          <span className="text-[9px] font-medium text-green-600 bg-green-50 px-1.5 py-0.5 rounded">Connected</span>
                        </button>
                      ))}
                    </>
                  )}
                  {sourceOptions.filter((o) => o.type === 'installed').length > 0 && (
                    <>
                      <p className="px-3 pt-2 pb-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Installed</p>
                      {sourceOptions.filter((o) => o.type === 'installed').map((o) => (
                        <button
                          key={o.key}
                          type="button"
                          onClick={() => { setSourceKey(o.key); setEventType('*'); setSourceDropdownOpen(false); }}
                          className={clsx(
                            'w-full flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-gray-50 transition-colors',
                            sourceKey === o.key && 'bg-brand-50 text-brand-700',
                          )}
                        >
                          <PlatformIcon platform={o.key.split(':')[1]} size={18} />
                          <span className="truncate flex-1">{o.label}</span>
                          <span className="text-[9px] font-medium text-brand-600 bg-brand-50 px-1.5 py-0.5 rounded">Installed</span>
                        </button>
                      ))}
                    </>
                  )}
                  {sourceOptions.filter((o) => o.type === 'not_connected').length > 0 && (
                    <>
                      <p className="px-3 pt-2 pb-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">OAuth Platforms</p>
                      {sourceOptions.filter((o) => o.type === 'not_connected').map((o) => (
                        <button
                          key={o.key}
                          type="button"
                          onClick={() => handleConnectOAuth(o.key.split(':')[1])}
                          className="w-full flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-gray-50 transition-colors"
                        >
                          <PlatformIcon platform={o.key.split(':')[1]} size={18} />
                          <span className="truncate flex-1 text-gray-500">{o.label}</span>
                          <span className="text-[9px] font-medium text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">Connect</span>
                        </button>
                      ))}
                    </>
                  )}
                  {sourceOptions.filter((o) => o.type === 'available').length > 0 && (
                    <>
                      <p className="px-3 pt-2 pb-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Available</p>
                      {sourceOptions.filter((o) => o.type === 'available').map((o) => {
                        const tmpl = platformTemplates.find((t) => t.slug === o.key.split(':')[1]);
                        return (
                          <button
                            key={o.key}
                            type="button"
                            onClick={() => tmpl && handleSelectNewPlatform(tmpl)}
                            className={clsx(
                              'w-full flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-gray-50 transition-colors',
                              sourceKey === o.key && 'bg-brand-50 text-brand-700',
                            )}
                          >
                            <PlatformIcon platform={o.key.split(':')[1]} size={18} />
                            <span className="truncate flex-1">{o.label}</span>
                            <span className="text-[9px] font-medium text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">Setup</span>
                          </button>
                        );
                      })}
                    </>
                  )}
                </div>,
                document.body,
              )}
            </div>
            )}
          </div>

          {/* Source connector — link to the in-app install + setup guide.
              Opens in a new tab so the admin can follow the steps while the
              automation panel stays open. Salesforce has its own bespoke
              setup page; every other connector uses /setup/:slug. */}
          {(() => {
            const srcTemplate = platformTemplates.find((t) => t.slug === sourcePlatform);
            if (sourcePlatform !== 'salesforce' && !srcTemplate) return null;
            const srcName =
              srcTemplate?.name ||
              sourceOptions.find((o) => o.key === sourceKey)?.label ||
              sourcePlatform;
            const accent = PLATFORM_BRAND_COLORS[sourcePlatform] ?? '#00A1E0';
            return (
              <a
                href={sourcePlatform === 'salesforce' ? '/salesforce-setup' : `/setup/${sourcePlatform}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg border transition-colors"
                style={{ borderColor: `${accent}4d`, backgroundColor: `${accent}0d` }}
              >
                <PlatformIcon platform={sourcePlatform} size={18} />
                <span className="flex-1 text-xs text-gray-700 leading-snug">
                  <strong className="font-semibold text-gray-900">Set up {srcName}.</strong>{' '}
                  {`Configure the ${srcName} webhook and follow the step-by-step guide.`}
                </span>
                <span
                  className="flex items-center gap-1 text-xs font-medium whitespace-nowrap"
                  style={{ color: accent }}
                >
                  View instructions
                  <ExternalLink className="w-3.5 h-3.5" />
                </span>
              </a>
            );
          })()}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Automation Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Give your automation a name..."
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent outline-none"
            />
          </div>

          {/* Event Type picker removed — automations now match every event from
              the source ("Any event", eventType "*"). The `eventType` state still
              defaults to "*" (and is preserved when editing), so the save path is
              unchanged. */}

          {/* Conditions — temporarily hidden
          {sourcePlatform && eventType && (
            <ConditionsBuilder
              conditions={conditions}
              onChange={setConditions}
              platform={sourcePlatform}
            />
          )}
          */}

          {sourcePlatform && (
            <div className="flex items-center gap-2 px-2">
              <div className="flex-1 h-px bg-gray-200" />
              <ArrowRight className="w-5 h-5 text-gray-400" />
              <div className="flex-1 h-px bg-gray-200" />
            </div>
          )}

          {/* Target Workflow */}
          {sourcePlatform && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Target Docusign Workflow</label>
              <div className="flex gap-2">
                <PortalSelect
                  value={workflowId}
                  onChange={setWorkflowId}
                  placeholder="Select workflow..."
                  className="flex-1 min-w-0"
                  searchable
                  options={availableWorkflows.map((wf) => ({ value: wf.id, label: wf.name }))}
                />
                <button
                  onClick={handleSyncWorkflow}
                  disabled={syncing}
                  className="px-2.5 py-2 border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-500 disabled:opacity-50 shrink-0"
                  title={workflowId ? 'Sync selected workflow from Workflow Builder' : 'Sync all workflows from Workflow Builder'}
                >
                  <RefreshCw className={clsx('w-4 h-4', syncing && 'animate-spin')} />
                </button>
              </div>
            </div>
          )}

          {/* Expected workflow instance duration */}
          {sourcePlatform && workflowId && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Expected workflow instance duration
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={365}
                  step={1}
                  inputMode="numeric"
                  value={expectedDurationDays}
                  onChange={(e) => setExpectedDurationDays(e.target.value.replace(/[^\d]/g, ''))}
                  placeholder="e.g. 7"
                  className="w-28 px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:ring-2 focus:ring-brand-500 outline-none"
                />
                <span className="text-sm text-gray-500">days</span>
              </div>
              <p className="text-[11px] text-gray-500 mt-1.5 leading-snug">
                Instances that take longer than set duration will be shown in Resolution Center as
                {' '}<span className="font-medium text-amber-700">Overdue</span> for your attention.
              </p>
            </div>
          )}

          {/* Non-API trigger warning */}
          {workflowId && selectedWorkflow && selectedWorkflow.triggerType !== 'HTTP' && (
            <div className="bg-amber-50 rounded-lg border border-amber-100 p-3 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
              <div className="text-xs text-amber-700">
                <p className="font-medium mb-0.5">This workflow does not have an API trigger</p>
                <p>
                  Please update it in Workflow Builder to use HTTP trigger for automations.{' '}
                  {selectedWorkflow.maestroUrl && (
                    <a
                      href={selectedWorkflow.maestroUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-0.5 text-amber-800 underline hover:text-amber-900"
                    >
                      Edit in Workflow Builder <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </p>
              </div>
            </div>
          )}

          {/* Maestro API Parameters — map each workflow input to a webhook payload field.
              Declared Maestro inputs render as fixed rows; "Add field" lets you map
              custom inputs when the workflow has no published trigger schema. */}
          {sourcePlatform && workflowId && (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-sm font-medium text-gray-700">Workflow Builder API Parameters</label>
                <button
                  type="button"
                  onClick={addCustomMapping}
                  className="text-xs text-brand-600 hover:text-brand-700 font-medium flex items-center gap-1"
                >
                  <Plus className="w-3.5 h-3.5" /> Add field
                </button>
              </div>

              {targetFields.length === 0 && customMappings.length === 0 ? (
                <div className="bg-amber-50 rounded-lg border border-amber-100 p-3 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                  <div className="text-xs text-amber-700">
                    <p className="font-medium mb-0.5">No API parameters found</p>
                    <p>
                      This workflow has no published trigger inputs. Add them in Workflow Builder, or use{' '}
                      <span className="font-medium">Add field</span> to map values manually.{' '}
                      {selectedWorkflow?.maestroUrl && (
                        <a
                          href={selectedWorkflow.maestroUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-0.5 text-amber-800 underline hover:text-amber-900"
                        >
                          Edit in Workflow Builder <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </p>
                  </div>
                </div>
              ) : (
                <>
                  <div className="bg-gray-50 rounded-lg border border-gray-200 divide-y divide-gray-200">
                    {/* Declared Maestro inputs — fixed target name from the trigger schema */}
                    {targetFields.map((field) => {
                      const mapping = mappingByTarget[field];
                      const type = mapping?.type ?? 'path';
                      const placeholder =
                        type === 'static' ? 'Fixed value'
                          : type === 'template' ? '{{data.field}}'
                          : '$.data.field_name';
                      return (
                        <div key={field} className="px-3 py-2.5 space-y-1.5">
                          <div className="flex items-center justify-between">
                            <span className="text-sm text-gray-700 font-mono">{field}</span>
                            <span className="text-[10px] text-gray-400 uppercase">
                              {fieldTypes[field] || 'string'}
                              {requiredFields.includes(field) && (
                                <span className="text-red-400 ml-1">required</span>
                              )}
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <select
                              value={type}
                              onChange={(e) => upsertMapping(field, { type: e.target.value as FieldMapping['type'] })}
                              className="text-[11px] border border-gray-200 rounded px-1.5 py-1.5 bg-white text-gray-600 shrink-0 outline-none focus:ring-1 focus:ring-brand-500"
                              title="How this value is resolved from the webhook payload"
                            >
                              <option value="path">Path</option>
                              <option value="static">Static</option>
                              <option value="template">Template</option>
                            </select>
                            <input
                              type="text"
                              value={mapping?.sourceField ?? ''}
                              onChange={(e) => upsertMapping(field, { sourceField: e.target.value, value: undefined })}
                              placeholder={placeholder}
                              className="flex-1 min-w-0 text-[11px] font-mono bg-white border border-gray-200 rounded px-2 py-1.5 outline-none focus:ring-1 focus:ring-brand-500"
                            />
                          </div>
                        </div>
                      );
                    })}

                    {/* Custom inputs — editable target name (no schema, or extra inputs) */}
                    {customMappings.map((m) => {
                      const type = m.type ?? 'path';
                      const placeholder =
                        type === 'static' ? 'Fixed value'
                          : type === 'template' ? '{{data.field}}'
                          : '$.data.field_name';
                      return (
                        <div key={m.id} className="px-3 py-2.5 space-y-1.5">
                          <div className="flex items-center gap-1.5">
                            <input
                              type="text"
                              value={m.targetField}
                              onChange={(e) => updateMappingById(m.id, { targetField: e.target.value })}
                              placeholder="maestro_input_name"
                              className="flex-1 min-w-0 text-sm font-mono text-gray-700 bg-white border border-gray-200 rounded px-2 py-1 outline-none focus:ring-1 focus:ring-brand-500"
                            />
                            <button
                              type="button"
                              onClick={() => removeMappingById(m.id)}
                              className="p-1 text-gray-400 hover:text-red-500 shrink-0"
                              title="Remove field"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <select
                              value={type}
                              onChange={(e) => updateMappingById(m.id, { type: e.target.value as FieldMapping['type'] })}
                              className="text-[11px] border border-gray-200 rounded px-1.5 py-1.5 bg-white text-gray-600 shrink-0 outline-none focus:ring-1 focus:ring-brand-500"
                              title="How this value is resolved from the webhook payload"
                            >
                              <option value="path">Path</option>
                              <option value="static">Static</option>
                              <option value="template">Template</option>
                            </select>
                            <input
                              type="text"
                              value={m.sourceField ?? ''}
                              onChange={(e) => updateMappingById(m.id, { sourceField: e.target.value, value: undefined })}
                              placeholder={placeholder}
                              className="flex-1 min-w-0 text-[11px] font-mono bg-white border border-gray-200 rounded px-2 py-1.5 outline-none focus:ring-1 focus:ring-brand-500"
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {targetFields.length === 0 && (
                    <p className="text-[11px] text-amber-600 mt-1.5 leading-snug">
                      No published trigger inputs detected - make sure each target name matches an input your
                      Docusign workflow expects.
                    </p>
                  )}

                  {(() => {
                    const mappedTargets = new Set(
                      fieldMappings.filter((m) => (m.sourceField ?? '').trim()).map((m) => m.targetField),
                    );
                    const missing = requiredFields.filter((f) => !mappedTargets.has(f));
                    if (missing.length === 0) return null;
                    return (
                      <p className="text-[10px] text-amber-600 bg-amber-50 rounded px-2 py-1.5 mt-1.5">
                        Required inputs not yet mapped:
                        {missing.map((f) => (
                          <code key={f} className="bg-amber-100 px-1 rounded mx-0.5">{f}</code>
                        ))}
                      </p>
                    );
                  })()}

                  <p className="text-[11px] text-gray-500 mt-1.5 leading-snug">
                    Leave a field empty to skip it. <span className="font-medium">Path</span> reads from the webhook
                    payload - e.g. <code className="bg-gray-100 px-1 rounded">$.data.project_id</code>.{' '}
                    <span className="font-medium">Static</span> sends a fixed value.{' '}
                    <span className="font-medium">Template</span> interpolates{' '}
                    <code className="bg-gray-100 px-1 rounded">{'{{field}}'}</code>.
                  </p>
                </>
              )}
            </div>
          )}

          {/* Webhook URL + Secret — shown after workflow/params so user configures "from → to" first */}
          {(sourceType === 'app' || sourceType === 'connection') && sourcePlatform && (() => {
            const webhookUrl = editingAutomation?.webhookUrl || preflightUrl;
            const conn = sourceType === 'connection'
              ? connections.find((c) => c.platform === sourcePlatform)
              : null;

            return (
              <div className="bg-gray-50 rounded-lg border border-gray-200 p-3 space-y-2">
                <div>
                  <label className="text-[10px] text-gray-500 mb-1 block font-medium">
                    {editingAutomation ? 'Permanent Webhook URL' : 'Webhook URL'}
                  </label>
                  {!editingAutomation && preflightLoading ? (
                    <div className="flex items-center gap-2 py-1">
                      <Loader2 className="w-3 h-3 animate-spin text-gray-400" />
                      <span className="text-[11px] text-gray-400">Generating URL...</span>
                    </div>
                  ) : webhookUrl ? (
                    <div className="flex items-center gap-1.5">
                      <code className="flex-1 text-[11px] text-gray-700 bg-white border border-gray-200 rounded px-2 py-1 truncate block">
                        {webhookUrl}
                      </code>
                      <button
                        type="button"
                        onClick={() => handleCopyPreflightUrl()}
                        className={clsx(
                          'shrink-0 p-1.5 border border-gray-200 rounded',
                          preflightCopied ? 'text-green-500 border-green-300' : 'text-gray-400 hover:text-brand-600 hover:border-brand-300',
                        )}
                        title="Copy webhook URL"
                      >
                        {preflightCopied ? <CheckCircle className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                      </button>
                    </div>
                  ) : (
                    <p className="text-[11px] text-gray-400 italic">Select a webhook source to generate URL</p>
                  )}
                </div>
                {(sourceType === 'app' || conn) && (() => {
                  const srcTmpl = platformTemplates.find((t) => t.slug === sourcePlatform);
                  const isBasicAuth = !!(srcTmpl?.secretUsernameLabel || srcTmpl?.secretPasswordLabel);
                  const canSave = savingSecret || (isBasicAuth
                    ? !secretUsername.trim() || !secretPassword.trim()
                    : !secretValue.trim());
                  return (
                    <div>
                      <label className="text-[10px] text-gray-500 mb-1 block font-medium">
                        {isBasicAuth ? 'Basic Auth Credentials' : 'Webhook Secret'}
                      </label>
                      {editingSecret ? (
                        isBasicAuth ? (
                          <div className="space-y-1.5">
                            <div className="relative">
                              <input
                                type={usernameVisible ? 'text' : 'password'}
                                value={secretUsername}
                                onChange={(e) => setSecretUsername(e.target.value)}
                                placeholder={srcTmpl?.secretUsernameLabel ?? 'Username'}
                                autoComplete="off"
                                className="w-full text-[11px] bg-white border border-gray-200 rounded px-2 py-1 pr-7 outline-none focus:ring-1 focus:ring-brand-500"
                              />
                              <button
                                type="button"
                                onClick={() => setUsernameVisible((v) => !v)}
                                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                              >
                                {usernameVisible ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                              </button>
                            </div>
                            <input
                              type="password"
                              value={secretPassword}
                              onChange={(e) => setSecretPassword(e.target.value)}
                              placeholder={srcTmpl?.secretPasswordLabel ?? 'Password'}
                              autoComplete="new-password"
                              className="w-full text-[11px] bg-white border border-gray-200 rounded px-2 py-1 outline-none focus:ring-1 focus:ring-brand-500"
                            />
                            <div className="flex gap-1.5">
                              <button
                                type="button"
                                onClick={handleSaveSecret}
                                disabled={canSave}
                                className="px-2 py-1 text-[10px] font-medium bg-brand-600 text-white rounded hover:bg-brand-700 disabled:opacity-50"
                              >
                                {savingSecret ? '...' : 'Save'}
                              </button>
                              <button
                                type="button"
                                onClick={() => { setEditingSecret(false); setSecretUsername(''); setSecretPassword(''); }}
                                className="px-2 py-1 text-[10px] font-medium border border-gray-200 rounded hover:bg-gray-50"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5">
                            <input
                              type="password"
                              value={secretValue}
                              onChange={(e) => setSecretValue(e.target.value)}
                              placeholder="Enter new secret..."
                              className="flex-1 text-[11px] bg-white border border-gray-200 rounded px-2 py-1 outline-none focus:ring-1 focus:ring-brand-500"
                            />
                            <button
                              type="button"
                              onClick={handleSaveSecret}
                              disabled={canSave}
                              className="shrink-0 px-2 py-1 text-[10px] font-medium bg-brand-600 text-white rounded hover:bg-brand-700 disabled:opacity-50"
                            >
                              {savingSecret ? '...' : 'Save'}
                            </button>
                            <button
                              type="button"
                              onClick={() => { setEditingSecret(false); setSecretValue(''); }}
                              className="shrink-0 px-2 py-1 text-[10px] font-medium border border-gray-200 rounded hover:bg-gray-50"
                            >
                              Cancel
                            </button>
                          </div>
                        )
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <span className="flex-1 text-[11px] text-gray-500 font-mono">••••••••</span>
                          <button
                            type="button"
                            onClick={() => setEditingSecret(true)}
                            className="shrink-0 px-2 py-1 text-[10px] font-medium border border-gray-200 rounded hover:bg-gray-50 text-gray-600"
                          >
                            Edit
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            );
          })()}

          {/* Field mapping now lives inline in the Maestro API Parameters section above —
              one source-field input per workflow parameter. */}

          {/* Summary — hidden while event type is always "all events" (no useful info beyond field values)
          {name && sourcePlatform && workflowId && (
            <div className="bg-brand-50 rounded-lg p-4 border border-brand-100">
              <p className="text-xs font-medium text-brand-700 mb-1">Automation Summary</p>
              <p className="text-sm text-brand-900">
                When any event occurs on <strong>
                  {sourceType === 'app'
                    ? installedPlatforms.find((a) => a.appSlug === sourcePlatform)?.displayName || sourcePlatform
                    : sourceOptions.find((o) => o.key === sourceKey)?.label || sourcePlatform}
                </strong>,{' '}
                automatically launch <strong>{workflows.find((w) => w.id === workflowId)?.name}</strong>.
              </p>
            </div>
          )}
          */}

        </div>

        {/* Footer */}
        <div className="absolute bottom-0 left-0 right-0 px-5 py-4 border-t border-gray-100 bg-white space-y-3">
          {editingAutomation && confirmingDelete && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
              <p className="text-sm text-red-800 font-medium mb-2">Delete this automation?</p>
              <p className="text-xs text-red-600 mb-3">This cannot be undone. Logs of the launched Docusign workflows will be available only in Workflow Checker.</p>
              <div className="flex gap-2">
                <button
                  onClick={() => setConfirmingDelete(false)}
                  disabled={deleting}
                  className="flex-1 px-3 py-1.5 text-xs font-medium border border-gray-200 rounded-lg hover:bg-white bg-white"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="flex-1 px-3 py-1.5 text-xs font-medium bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 flex items-center justify-center gap-1"
                >
                  {deleting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                  Delete
                </button>
              </div>
            </div>
          )}
          {(() => {
            const blockReason = automationSaveBlockReason({ saving, name, sourcePlatform, eventType, workflowId, editingAutomation: !!editingAutomation, secretSaved });
            return (
              <>
                {/* Hint: the only thing blocking Create is an unsaved webhook secret.
                    Without this, the disabled button looks broken with no explanation. */}
                {blockReason === 'secret-unsaved' && (
                  <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    <AlertCircle className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-px" />
                    <p className="text-[11px] text-amber-700 leading-snug">
                      Click <span className="font-semibold">Save</span> on the Webhook Secret above before creating the automation.
                    </p>
                  </div>
                )}
                <div className="flex gap-3">
                  <button
                    onClick={onClose}
                    className="px-4 py-2.5 text-sm font-medium border border-gray-200 rounded-lg hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={blockReason !== null}
                    className="flex-1 px-4 py-2.5 text-sm font-medium bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-50 flex items-center justify-center gap-2 whitespace-nowrap"
                  >
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                    {editingAutomation ? 'Update Automation' : 'Create Automation'}
                  </button>
                </div>
              </>
            );
          })()}
          {editingAutomation && !confirmingDelete && (
            <button
              onClick={() => setConfirmingDelete(true)}
              className="w-full px-3 py-2 text-sm font-medium border border-gray-200 rounded-lg text-red-500 hover:bg-red-50 hover:border-red-200 transition-colors flex items-center justify-center gap-2"
            >
              <Trash2 className="w-4 h-4" />
              Delete Automation
            </button>
          )}
        </div>
      </div>
    </>
  );
}

// ─── Trigger History ──────────────────────────────────────────
