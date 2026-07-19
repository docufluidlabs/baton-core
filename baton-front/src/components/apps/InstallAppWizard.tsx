/**
 * Install App Wizard — Baton
 *
 * 3-step modal for installing a catalog app:
 *  Step 1 — Show the Baton webhook URL (copy it into the platform)
 *  Step 2 — Platform-specific setup instructions
 *  Step 3 — Paste secret key + confirm install
 */
import { useState, useEffect } from 'react';
import {
  Copy, Check, ChevronRight, ChevronLeft, Loader2,
  ExternalLink, Key, X, CheckCircle, Eye, EyeOff,
} from 'lucide-react';
import { toast } from 'sonner';
import { PlatformIcon } from '@/components/ui/PlatformIcon';
import { preflightPlatform, installPlatform as installApp, type PlatformTemplate } from '@/hooks/useApi';
import clsx from 'clsx';

interface InstallAppWizardProps {
  template: PlatformTemplate;
  onClose: () => void;
  onInstalled: () => void;
}

type Step = 1 | 2 | 3;

export function InstallAppWizard({ template, onClose, onInstalled }: InstallAppWizardProps) {
  const [step, setStep] = useState<Step>(1);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [webhookKey, setWebhookKey] = useState('');
  const [secretKey, setSecretKey] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [secretVisible, setSecretVisible] = useState(false);
  const [usernameVisible, setUsernameVisible] = useState(false);
  const [displayName, setDisplayName] = useState(`${template.name} Production`);
  const [loadingPreflight, setLoadingPreflight] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [copied, setCopied] = useState(false);

  const isBasicAuth = !!(template.secretUsernameLabel || template.secretPasswordLabel);

  // Call preflight on mount — generates webhookKey without persisting anything.
  // This lets us show the URL in step 1 before the user has entered the secret.
  useEffect(() => {
    async function doPreflight() {
      setLoadingPreflight(true);
      try {
        const result = await preflightPlatform(template.slug);
        setWebhookUrl(result.webhookUrl);
        setWebhookKey(result.webhookKey);
      } catch {
        toast.error('Failed to generate webhook URL. Please try again.');
      } finally {
        setLoadingPreflight(false);
      }
    }
    doPreflight();
  }, [template.slug]);

  async function handleCopy() {
    if (!webhookUrl) return;
    await navigator.clipboard.writeText(webhookUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleInstall() {
    if (isBasicAuth) {
      if (!username.trim() || !password.trim()) {
        toast.error(`Please enter both username and password for ${template.name}`);
        return;
      }
    } else if (!secretKey.trim()) {
      toast.error(`Please paste the ${template.secretKeyLabel} from ${template.name}`);
      return;
    }
    setInstalling(true);
    try {
      const resolvedSecret = isBasicAuth
        ? `${username.trim()}:${password.trim()}`
        : secretKey.trim();
      await installApp({
        appSlug: template.slug,
        secretKey: resolvedSecret,
        displayName: displayName.trim() || template.name,
        webhookKey,
      });
      onInstalled();
    } catch (err: any) {
      toast.error(err?.message || 'Installation failed');
    } finally {
      setInstalling(false);
    }
  }

  const canProceedStep1 = !!webhookUrl && !loadingPreflight;
  const canInstall = isBasicAuth
    ? username.trim().length > 0 && password.trim().length > 0 && displayName.trim().length > 0
    : secretKey.trim().length > 0 && displayName.trim().length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl border border-gray-200 w-full max-w-lg overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <PlatformIcon platform={template.slug} size={26} />
            <div>
              <h2 className="text-base font-semibold text-gray-900">Install {template.name}</h2>
              <p className="text-xs text-gray-500">{template.category}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100">
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        {/* Step indicator */}
        <div className="flex items-center px-6 py-3 gap-2 bg-gray-50 border-b border-gray-100">
          {([1, 2, 3] as Step[]).map((s, i) => (
            <div key={s} className="flex items-center gap-2">
              <div className={clsx(
                'w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium transition-colors',
                step === s ? 'bg-brand-600 text-white' :
                s < step ? 'bg-green-500 text-white' :
                'bg-gray-200 text-gray-500',
              )}>
                {s < step ? <CheckCircle className="w-3.5 h-3.5" /> : s}
              </div>
              <span className={clsx(
                'text-xs font-medium',
                step === s ? 'text-brand-600' : 'text-gray-400',
              )}>
                {s === 1 ? 'Webhook URL' : s === 2 ? 'Setup' : 'Secret Key'}
              </span>
              {i < 2 && <div className="h-px bg-gray-200 w-8" />}
            </div>
          ))}
        </div>

        {/* Body */}
        <div className="p-6 min-h-[260px]">

          {/* Step 1: Webhook URL */}
          {step === 1 && (
            <div className="space-y-4">
              <p className="text-sm text-gray-600">
                Copy this URL and paste it into your{' '}
                <strong>{template.name}</strong> app settings as the webhook destination.
              </p>

              {loadingPreflight ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
                </div>
              ) : (
                <div className="bg-gray-50 rounded-xl border border-gray-200 p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      Baton Webhook URL
                    </span>
                    <button
                      onClick={handleCopy}
                      className={clsx(
                        'flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-lg transition-colors',
                        copied
                          ? 'bg-green-50 text-green-600'
                          : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50',
                      )}
                    >
                      {copied
                        ? <><Check className="w-3 h-3" /> Copied!</>
                        : <><Copy className="w-3 h-3" /> Copy</>}
                    </button>
                  </div>
                  <p className="text-xs font-mono text-gray-700 break-all leading-relaxed">
                    {webhookUrl}
                  </p>
                </div>
              )}

              <div className="bg-blue-50 rounded-lg p-3 border border-blue-100 text-xs text-blue-700">
                <strong>Next:</strong> Go to <strong>{template.name}</strong>, create a webhook
                app, paste this URL, then come back with the secret key.
              </div>
            </div>
          )}

          {/* Step 2: Setup instructions */}
          {step === 2 && (
            <div className="space-y-4">
              <p className="text-sm text-gray-600">
                Follow these steps in <strong>{template.name}</strong>:
              </p>

              <ol className="space-y-3">
                {template.setupInstructions.map((inst) => (
                  <li key={inst.step} className="flex gap-3">
                    <div className="w-6 h-6 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center text-xs font-semibold shrink-0 mt-0.5">
                      {inst.step}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-900">{inst.title}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{inst.description}</p>
                    </div>
                  </li>
                ))}
              </ol>

              {webhookUrl && (
                <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-gray-500 font-medium">Webhook URL</span>
                    <button
                      onClick={handleCopy}
                      className="text-xs text-brand-600 hover:underline flex items-center gap-1"
                    >
                      <Copy className="w-3 h-3" />
                      {copied ? 'Copied!' : 'Copy'}
                    </button>
                  </div>
                  <p className="text-xs font-mono text-gray-600 truncate">{webhookUrl}</p>
                </div>
              )}
            </div>
          )}

          {/* Step 3: Secret key (or Basic Auth credentials) */}
          {step === 3 && (
            <div className="space-y-4">
              <p className="text-sm text-gray-600">
                {isBasicAuth ? (
                  <>Enter the username and password you will configure in{' '}
                  <strong>{template.name}</strong>. Baton encrypts them at rest and never
                  returns them via the API.</>
                ) : (
                  <>Paste the <strong>{template.secretKeyLabel}</strong> from{' '}
                  <strong>{template.name}</strong>. Baton encrypts it at rest and never
                  returns it via the API.</>
                )}
              </p>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Display name
                </label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder={template.name}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent outline-none"
                />
              </div>

              {isBasicAuth ? (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">
                      <Key className="w-3.5 h-3.5 inline mr-1" />
                      {template.secretUsernameLabel ?? 'Username'}
                    </label>
                    <div className="relative">
                      <input
                        type={usernameVisible ? 'text' : 'password'}
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        placeholder="e.g. baton-webhook"
                        autoComplete="off"
                        className="w-full px-3 py-2 pr-10 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent outline-none font-mono"
                      />
                      <button
                        type="button"
                        onClick={() => setUsernameVisible((v) => !v)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                      >
                        {usernameVisible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">
                      <Key className="w-3.5 h-3.5 inline mr-1" />
                      {template.secretPasswordLabel ?? 'Password'}
                    </label>
                    <div className="relative">
                      <input
                        type={secretVisible ? 'text' : 'password'}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Strong random password"
                        autoComplete="new-password"
                        className="w-full px-3 py-2 pr-14 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent outline-none font-mono"
                      />
                      <button
                        type="button"
                        onClick={() => setSecretVisible((v) => !v)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 hover:text-gray-600 font-medium"
                      >
                        {secretVisible ? 'Hide' : 'Show'}
                      </button>
                    </div>
                    <p className="text-xs text-gray-400 mt-1.5 flex items-center gap-1">
                      <ExternalLink className="w-3 h-3" />
                      Stored AES-256-GCM encrypted. Not accessible after saving.
                    </p>
                  </div>
                </>
              ) : (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    <Key className="w-3.5 h-3.5 inline mr-1" />
                    {template.secretKeyLabel}
                  </label>
                  <div className="relative">
                    <input
                      type={secretVisible ? 'text' : 'password'}
                      value={secretKey}
                      onChange={(e) => setSecretKey(e.target.value)}
                      placeholder={template.secretKeyHint}
                      autoComplete="off"
                      className="w-full px-3 py-2 pr-14 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent outline-none font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => setSecretVisible((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 hover:text-gray-600 font-medium"
                    >
                      {secretVisible ? 'Hide' : 'Show'}
                    </button>
                  </div>
                  <p className="text-xs text-gray-400 mt-1.5 flex items-center gap-1">
                    <ExternalLink className="w-3 h-3" />
                    Stored AES-256-GCM encrypted. Not accessible after saving.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100 bg-gray-50">
          <button
            onClick={() => step > 1 ? setStep((s) => (s - 1) as Step) : onClose()}
            className="flex items-center gap-1.5 text-sm font-medium text-gray-600 hover:text-gray-900 px-3 py-2 rounded-lg hover:bg-gray-100"
          >
            <ChevronLeft className="w-4 h-4" />
            {step === 1 ? 'Cancel' : 'Back'}
          </button>

          {step < 3 ? (
            <button
              onClick={() => setStep((s) => (s + 1) as Step)}
              disabled={step === 1 && !canProceedStep1}
              className="flex items-center gap-1.5 text-sm font-medium bg-brand-600 text-white px-4 py-2 rounded-lg hover:bg-brand-700 disabled:opacity-50"
            >
              Next <ChevronRight className="w-4 h-4" />
            </button>
          ) : (
            <button
              onClick={handleInstall}
              disabled={installing || !canInstall}
              className="flex items-center gap-2 text-sm font-medium bg-brand-600 text-white px-5 py-2 rounded-lg hover:bg-brand-700 disabled:opacity-50"
            >
              {installing
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Installing...</>
                : <><CheckCircle className="w-4 h-4" /> Install App</>}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
