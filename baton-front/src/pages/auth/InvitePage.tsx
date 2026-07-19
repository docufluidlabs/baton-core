/**
 * Invite Page — /invite?token=...
 * A teammate opens the link from their admin, picks a name + password, and
 * POST /api/auth/accept-invite signs them straight in. Invalid or expired
 * tokens get a friendly dead-end card instead of a form error loop.
 */
import { useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { Loader2, MailX } from 'lucide-react';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/auth/AuthContext';
import { AuthCard, AuthField } from './AuthCard';

export default function InvitePage() {
  const { refresh } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';

  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tokenRejected, setTokenRejected] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await api.post('/auth/accept-invite', { token, name, password });
      await refresh();
      toast.success('Welcome to Baton');
      navigate('/flows', { replace: true });
    } catch (err) {
      // The backend answers 400 "Invalid or expired invite token" for any
      // token problem — swap the form for the dead-end card in that case.
      if (err instanceof ApiError && /invite token/i.test(err.message)) {
        setTokenRejected(true);
      } else {
        setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
      }
      setSubmitting(false);
    }
  }

  if (!token || tokenRejected) {
    return (
      <AuthCard title="Invite link not valid">
        <div className="text-center">
          <div className="mx-auto w-12 h-12 rounded-full bg-red-50 flex items-center justify-center mb-4">
            <MailX className="w-6 h-6 text-red-500" />
          </div>
          <p className="text-sm text-gray-600">
            This invite link is invalid or has expired. Invite links are valid
            for 72 hours - ask your administrator to send you a new one.
          </p>
          <Link
            to="/signin"
            className="inline-block mt-5 text-sm font-medium text-brand-600 hover:text-brand-700"
          >
            Go to sign in
          </Link>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Join your team on Baton"
      subtitle="Choose a name and password to finish creating your account."
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <AuthField
          id="name"
          label="Your name"
          value={name}
          onChange={setName}
          placeholder="Alex Doe"
          autoComplete="name"
          autoFocus
        />
        <AuthField
          id="password"
          label="Password"
          type="password"
          value={password}
          onChange={setPassword}
          placeholder="At least 8 characters"
          autoComplete="new-password"
          minLength={8}
        />

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="w-full flex items-center justify-center gap-2 px-5 py-2.5 bg-brand-600 text-white text-sm font-semibold rounded-lg hover:bg-brand-700 disabled:opacity-50 transition-colors"
        >
          {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
          Accept invite
        </button>
      </form>
    </AuthCard>
  );
}
