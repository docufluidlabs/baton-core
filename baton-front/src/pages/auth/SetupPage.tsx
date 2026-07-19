/**
 * Setup Page — first-run only.
 * Creates the organization + owner account via POST /api/auth/setup, which
 * also sets the session cookie, so the user lands signed in on /flows.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/auth/AuthContext';
import { AuthCard, AuthField } from './AuthCard';

export default function SetupPage() {
  const { refresh } = useAuth();
  const navigate = useNavigate();
  const [orgName, setOrgName] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await api.post('/auth/setup', { orgName, name, email, password });
      await refresh();
      toast.success('Welcome to Baton');
      navigate('/flows', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Setup failed. Please try again.');
      setSubmitting(false);
    }
  }

  return (
    <AuthCard
      title="Set up Baton"
      subtitle="Create your organization and the first admin account."
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <AuthField
          id="orgName"
          label="Organization name"
          value={orgName}
          onChange={setOrgName}
          placeholder="Acme Inc."
          autoComplete="organization"
          autoFocus
        />
        <AuthField
          id="name"
          label="Your name"
          value={name}
          onChange={setName}
          placeholder="Alex Doe"
          autoComplete="name"
        />
        <AuthField
          id="email"
          label="Email"
          type="email"
          value={email}
          onChange={setEmail}
          placeholder="you@company.com"
          autoComplete="email"
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
          Set up Baton
        </button>
      </form>
    </AuthCard>
  );
}
