import { AsyncLocalStorage } from 'async_hooks';

export interface RequestStore {
  requestId: string;
  userId?: string;
  orgId?: string;
}

export const requestContext = new AsyncLocalStorage<RequestStore>();
