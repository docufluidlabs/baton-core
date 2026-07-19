/**
 * Clerk Mock — Preview Build
 *
 * Provides stub implementations of all @clerk/clerk-react exports
 * used by the app, so the preview build renders without Clerk.
 */
import type { ReactNode } from 'react';

// ─── Providers ────────────────────────────────────────────

export function ClerkProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

// ─── Auth gates — always show children ────────────────────

export function SignedIn({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export function SignedOut(_props: { children: ReactNode }) {
  return null; // Never show sign-in in preview
}

export function SignIn() {
  return null;
}

// ─── Hooks ────────────────────────────────────────────────

export function useAuth() {
  return {
    getToken: async () => 'preview-token',
    isSignedIn: true,
    isLoaded: true,
    userId: 'preview-user',
    orgId: 'preview-org',
  };
}

export function useUser() {
  return {
    isLoaded: true,
    isSignedIn: true,
    user: {
      id: 'preview-user',
      fullName: 'Alex Johnson',
      firstName: 'Alex',
      lastName: 'Johnson',
      imageUrl: '',
      primaryEmailAddress: { emailAddress: 'alex@acme.com' },
      emailAddresses: [{ emailAddress: 'alex@acme.com' }],
      publicMetadata: {} as Record<string, unknown>,
    },
  };
}

export function useOrganization() {
  return {
    organization: {
      id: 'org_preview',
      name: 'Acme Corp',
      imageUrl: null,
      membersCount: 5,
    },
    isLoaded: true,
  };
}

export function useOrganizationList() {
  return {
    isLoaded: true,
    setActive: async () => {},
    userMemberships: {
      data: [
        {
          organization: {
            id: 'org_preview',
            name: 'Acme Corp',
            imageUrl: null,
          },
        },
        {
          organization: {
            id: 'org_preview_2',
            name: 'Beta Inc',
            imageUrl: null,
          },
        },
      ],
    },
  };
}

// ─── Components ───────────────────────────────────────────

export function UserButton() {
  return (
    <div className="w-8 h-8 rounded-full bg-brand-600 flex items-center justify-center cursor-pointer">
      <span className="text-white text-xs font-bold">A</span>
    </div>
  );
}

export function CreateOrganization() {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-8 w-96 text-center">
      <h2 className="text-lg font-semibold text-gray-900 mb-2">Create Organization</h2>
      <p className="text-sm text-gray-500 mb-4">This is a preview — org creation is disabled.</p>
      <input
        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-3"
        placeholder="Organization name"
        disabled
      />
      <button className="w-full bg-brand-600 text-white rounded-lg px-4 py-2 text-sm font-medium opacity-50 cursor-not-allowed" disabled>
        Create
      </button>
    </div>
  );
}
