/**
 * Public platform catalog for the docs setup guides.
 * Uses a plain unauthenticated fetch (not the auth-gated app API client) so the
 * guides load for any visitor — the docs are public. Backed by the public
 * endpoint GET /api/public/platforms-catalog.
 */
import useSWR from 'swr';
import type { PlatformTemplate } from '@/hooks/useApi';

const publicFetcher = async (url: string): Promise<{ templates: PlatformTemplate[] }> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Catalog request failed (${res.status})`);
  return res.json();
};

export function usePublicCatalog() {
  return useSWR<{ templates: PlatformTemplate[] }>('/api/public/platforms-catalog', publicFetcher, {
    revalidateOnFocus: false,
  });
}

export type { PlatformTemplate };
