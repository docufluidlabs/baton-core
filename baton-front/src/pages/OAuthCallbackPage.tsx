/**
 * OAuth Callback Page — Baton
 * Handles the redirect after OAuth authorization.
 *
 * Fixes applied:
 * - Authorization code is sent via POST body instead of GET query parameter.
 *   GET exposes the code in nginx access logs, browser history, and Referer headers.
 * - useRef guard prevents double-invocation in React StrictMode: effects run twice
 *   in dev, but OAuth codes are single-use — the second call would get a 400.
 */
import { useEffect, useRef, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';
import { CheckCircle, XCircle, Loader2 } from 'lucide-react';

export default function OAuthCallbackPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('');

  // Prevent double-invocation in React StrictMode (effects run twice in dev).
  // OAuth codes are single-use — the second attempt would fail with a 400.
  const calledRef = useRef(false);

  useEffect(() => {
    if (calledRef.current) return;
    calledRef.current = true;

    async function handleCallback() {
      const code = params.get('code');
      const state = params.get('state');
      const error = params.get('error');

      if (error) {
        setStatus('error');
        setMessage(`Authorization denied: ${params.get('error_description') || error}`);
        return;
      }

      if (!code || !state) {
        setStatus('error');
        setMessage('Missing authorization code or state parameter.');
        return;
      }

      try {
        // POST the code in the request body — never expose it as a URL parameter.
        // URL parameters appear in nginx access logs, browser history, and
        // Referer headers sent to third-party resources on the next page.
        await api.post('/connections/callback', { code, state });
        setStatus('success');
        setMessage('Platform connected successfully!');
        setTimeout(() => navigate('/connections?status=success'), 2000);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Failed to complete OAuth connection.';
        setStatus('error');
        setMessage(msg);
      }
    }

    handleCallback();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // params and navigate are stable refs; the effect must fire exactly once.

  return (
    <div className="flex items-center justify-center h-full">
      <div className="text-center max-w-md">
        {status === 'loading' && (
          <>
            <Loader2 className="w-12 h-12 animate-spin text-brand-500 mx-auto mb-4" />
            <h2 className="text-lg font-semibold text-gray-900">Connecting platform...</h2>
            <p className="text-sm text-gray-500 mt-1">Please wait while we complete the authorization.</p>
          </>
        )}
        {status === 'success' && (
          <>
            <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-4" />
            <h2 className="text-lg font-semibold text-gray-900">Connected!</h2>
            <p className="text-sm text-gray-500 mt-1">{message}</p>
            <p className="text-xs text-gray-400 mt-3">Redirecting to Connections...</p>
          </>
        )}
        {status === 'error' && (
          <>
            <XCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
            <h2 className="text-lg font-semibold text-gray-900">Connection Failed</h2>
            <p className="text-sm text-gray-500 mt-1">{message}</p>
            <button
              onClick={() => navigate('/connections')}
              className="mt-6 px-5 py-2 bg-brand-600 text-white text-sm font-medium rounded-lg hover:bg-brand-700"
            >
              Back to Connections
            </button>
          </>
        )}
      </div>
    </div>
  );
}
