/**
 * Org Switcher — Baton
 *
 * Dropdown that shows the current org and allows switching between orgs.
 * Uses Clerk's useOrganizationList() for org data and setActive() for switching.
 */
import { useState, useRef, useEffect } from 'react';
import { useOrganization, useOrganizationList } from '@clerk/clerk-react';
import { useAuth } from '@clerk/clerk-react';
import { ChevronDown, Building2, Check } from 'lucide-react';
import clsx from 'clsx';

export function OrgSwitcher() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { getToken } = useAuth();
  const { organization: activeOrg } = useOrganization();
  const { userMemberships, setActive } = useOrganizationList({
    userMemberships: { infinite: true },
  });

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const memberships = userMemberships?.data || [];

  async function handleSwitch(orgId: string) {
    if (!setActive) return;
    setOpen(false);

    await setActive({ organization: orgId });

    // Force Clerk to issue a fresh JWT with the new orgId baked in.
    // Without this, the cached token still contains the old org and the
    // backend returns data for the wrong organization.
    await getToken({ skipCache: true });

    window.location.href = '/flows';
  }

  if (!activeOrg) return null;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-gray-50 transition-colors text-sm"
      >
        <div className="w-5 h-5 rounded-md bg-gray-100 flex items-center justify-center flex-shrink-0">
          {activeOrg.imageUrl ? (
            <img src={activeOrg.imageUrl} alt="" className="w-5 h-5 rounded-md" />
          ) : (
            <Building2 className="w-4 h-4 text-gray-400" />
          )}
        </div>
        <span className="font-medium text-gray-700 max-w-[160px] truncate">
          {activeOrg.name}
        </span>
        <ChevronDown className={clsx('w-3.5 h-3.5 text-gray-400 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-64 bg-white rounded-xl border border-gray-200 shadow-lg z-50 py-1">
          <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
            Organizations
          </div>

          {memberships.map((membership) => {
            const org = membership.organization;
            const isActive = org.id === activeOrg.id;

            return (
              <button
                key={org.id}
                onClick={() => !isActive && handleSwitch(org.id)}
                className={clsx(
                  'flex items-center gap-3 w-full px-3 py-2 text-sm transition-colors',
                  isActive
                    ? 'bg-brand-50 text-brand-700'
                    : 'text-gray-700 hover:bg-gray-50',
                )}
              >
                <div className="w-7 h-7 rounded-md bg-gray-100 flex items-center justify-center flex-shrink-0">
                  {org.imageUrl ? (
                    <img src={org.imageUrl} alt="" className="w-7 h-7 rounded-md" />
                  ) : (
                    <span className="text-xs font-bold text-gray-500">
                      {org.name?.charAt(0)?.toUpperCase()}
                    </span>
                  )}
                </div>
                <span className="truncate flex-1 text-left">{org.name}</span>
                {isActive && <Check className="w-4 h-4 text-brand-600 flex-shrink-0" />}
              </button>
            );
          })}

        </div>
      )}
    </div>
  );
}
