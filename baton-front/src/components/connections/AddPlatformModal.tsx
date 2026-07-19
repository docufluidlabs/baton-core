import { useState } from 'react';
import { toast } from 'sonner';
import { useSWRConfig } from 'swr';
import { Modal } from '@/components/ui/Modal';
import { PlatformIcon } from '@/components/ui/PlatformIcon';
import { Badge } from '@/components/ui/Badge';
import { AlertCircle, Plus, ShieldCheck, Loader2, Check, Search } from 'lucide-react';
import { installPlatform, type PlatformTemplate } from '@/hooks/useApi';

interface AddPlatformModalProps {
  open: boolean;
  onClose: () => void;
  templates: PlatformTemplate[];
  installedSlugs: Set<string>;
  canInstall: boolean;
}

export function AddPlatformModal({
  open, onClose, templates, installedSlugs, canInstall,
}: AddPlatformModalProps) {
  const { mutate } = useSWRConfig();
  const [search, setSearch] = useState('');
  const [installing, setInstalling] = useState<string | null>(null);
  const [justInstalled, setJustInstalled] = useState<Set<string>>(new Set());

  const filtered = search.trim()
    ? templates.filter((t) => t.name.toLowerCase().includes(search.trim().toLowerCase()))
    : templates;

  async function handleInstall(slug: string) {
    setInstalling(slug);
    try {
      await installPlatform({ appSlug: slug });
      setJustInstalled((prev) => new Set(prev).add(slug));
      toast.success(`${templates.find((t) => t.slug === slug)?.name ?? slug} added`);
      mutate('/platforms');
    } catch {
      // error shown by global handler
    } finally {
      setInstalling(null);
    }
  }

  function handleClose() {
    setSearch('');
    setJustInstalled(new Set());
    onClose();
  }

  return (
    <Modal open={open} onClose={handleClose} title="Add Platform" className="max-w-lg">
      <div className="space-y-3">
        {!canInstall && (
          <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2.5">
            <AlertCircle className="w-4 h-4 shrink-0" />
            You need the <strong className="mx-0.5">superuser</strong> or{' '}
            <strong className="mx-0.5">owner</strong> role to install platforms.
          </div>
        )}

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search platforms..."
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
            autoFocus
          />
        </div>

        <div className="divide-y divide-gray-100 -mx-5">
          {filtered.length === 0 ? (
            <div className="px-5 py-12 text-center">
              <Search className="w-8 h-8 text-gray-200 mx-auto mb-3" />
              <p className="text-sm font-medium text-gray-500">No platforms found</p>
              <p className="text-xs text-gray-400 mt-1">
                Nothing matches &ldquo;{search}&rdquo; &mdash; try a different keyword
              </p>
            </div>
          ) : filtered.map((t) => {
            const installed = installedSlugs.has(t.slug) || justInstalled.has(t.slug);
            const isInstalling = installing === t.slug;
            return (
              <div
                key={t.slug}
                className="flex items-center gap-3 px-5 py-3 hover:bg-gray-50 transition-colors"
              >
                <PlatformIcon platform={t.slug} size={28} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-900">{t.name}</span>
                    <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full font-medium">
                      {t.category}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 truncate mt-0.5">{t.description}</p>
                  <div className="flex items-center gap-1 mt-1 text-[10px] text-gray-400">
                    <ShieldCheck className="w-3 h-3 text-green-400" />
                    {(t.secretUsernameLabel || t.secretPasswordLabel) ? 'Basic Auth Credentials' : 'HMAC Auth'}
                  </div>
                </div>
                <div className="shrink-0">
                  {installed ? (
                    <Badge variant="green">
                      <Check className="w-3 h-3 mr-1" /> Added
                    </Badge>
                  ) : isInstalling ? (
                    <span className="px-3 py-1.5 text-xs font-medium text-gray-400 flex items-center gap-1.5">
                      <Loader2 className="w-3 h-3 animate-spin" /> Adding...
                    </span>
                  ) : canInstall ? (
                    <button
                      onClick={() => handleInstall(t.slug)}
                      disabled={installing !== null}
                      className="px-3 py-1.5 text-xs font-medium bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-50 flex items-center gap-1.5"
                    >
                      <Plus className="w-3 h-3" /> Add
                    </button>
                  ) : (
                    <span className="text-xs text-gray-400">No access</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}
