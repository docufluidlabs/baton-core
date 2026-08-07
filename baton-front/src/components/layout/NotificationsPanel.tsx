/**
 * Notifications Panel — Baton
 * Dropdown from the bell icon in the header
 *
 * Fixes applied:
 * - All API mutations (markRead, markAllRead, dismiss) now have try/catch and
 *   user-facing error feedback instead of silent unhandled promise rejections.
 * - Shared Notification type imported from useApi (field: "message").
 * - Duplicate timeAgo removed — imported from src/lib/utils.ts.
 * - Mutations now revalidate both the panel key and the full notifications key
 *   so the unread badge stays consistent with the notifications page.
 */
import { useState, useRef, useEffect } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import { fetcher, api } from '@/lib/api';
import { toast } from 'sonner';
import { Bell, Check, CheckCheck, X, AlertTriangle, Info, XCircle, CheckCircle } from 'lucide-react';
import clsx from 'clsx';
import { timeAgo, formatDateFull } from '@/lib/utils';
import type { Notification } from '@/hooks/useApi';

export function NotificationsPanel() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { mutate: globalMutate } = useSWRConfig();

  const { data, isLoading: _isLoading } = useSWR<{ notifications: Notification[]; unreadCount: number }>(
    '/notifications?limit=20',
    fetcher,
    { refreshInterval: 30_000 },
  );

  const notifications = data?.notifications || [];
  const unreadCount = data?.unreadCount || 0;
  const visible = notifications.filter((n) => !n.dismissedAt);

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

  /** Revalidate both the panel key and the full notifications page key. */
  function revalidateBoth() {
    globalMutate((key: unknown) => typeof key === 'string' && key.startsWith('/notifications'));
  }

  async function markRead(id: string) {
    try {
      await api.patch(`/notifications/${id}/read`);
      revalidateBoth();
    } catch {
      toast.error('Failed to mark notification as read');
    }
  }

  async function markAllRead() {
    try {
      await api.post('/notifications/read-all');
      revalidateBoth();
    } catch {
      toast.error('Failed to mark all as read');
    }
  }

  async function dismiss(id: string) {
    try {
      await api.patch(`/notifications/${id}/dismiss`);
      revalidateBoth();
    } catch {
      toast.error('Failed to dismiss notification');
    }
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="relative p-2 rounded-lg hover:bg-gray-100 text-gray-500"
      >
        <Bell className="w-5 h-5" />
        {unreadCount > 0 && (
          <span className="absolute top-1 right-1 min-w-[16px] h-4 flex items-center justify-center bg-red-500 text-white text-[10px] font-bold rounded-full px-1">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed md:absolute right-2 md:right-0 top-[60px] md:top-full md:mt-2 w-[calc(100vw-1rem)] md:w-96 bg-white rounded-xl border border-gray-200 shadow-xl z-50 max-h-[500px] flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <h3 className="text-sm font-semibold text-gray-900">Notifications</h3>
            <div className="flex items-center gap-2">
              {unreadCount > 0 && (
              <button
                onClick={markAllRead}
                className="text-xs text-brand-600 hover:underline flex items-center gap-1"
              >
                <CheckCheck className="w-3.5 h-3.5" />
                Mark all read
              </button>
            )}
            </div>
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto">
            {visible.length === 0 ? (
              <div className="py-12 text-center">
                <Bell className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                <p className="text-sm text-gray-500">All caught up!</p>
              </div>
            ) : (
              visible.map((notif) => (
                <div
                  key={notif.id}
                  className={clsx(
                    'flex gap-3 px-4 py-3 border-b border-gray-50 hover:bg-gray-50 transition-colors',
                    !notif.readAt && 'bg-brand-50/30',
                  )}
                >
                  <SeverityIcon severity={notif.severity} />
                  <div className="flex-1 min-w-0">
                    <p className={clsx('text-sm', notif.readAt ? 'text-gray-700' : 'text-gray-900 font-medium')}>
                      {notif.title}
                      {(notif.count ?? 1) > 1 && (
                        <span className="ml-1.5 text-[10px] font-semibold text-gray-500 bg-gray-100 rounded-full px-1.5 py-0.5 align-middle">
                          ×{notif.count}
                        </span>
                      )}
                    </p>
                    {/* "message" is the canonical API field */}
                    <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{notif.message}</p>
                    <p className="text-[10px] text-gray-400 mt-1" title={formatDateFull(notif.createdAt)}>{timeAgo(notif.createdAt)}</p>
                  </div>
                  <div className="flex flex-col gap-1 shrink-0">
                    {!notif.readAt && (
                      <button
                        onClick={() => markRead(notif.id)}
                        className="p-1 rounded hover:bg-gray-200 text-gray-400"
                        title="Mark read"
                      >
                        <Check className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button
                      onClick={() => dismiss(notif.id)}
                      className="p-1 rounded hover:bg-gray-200 text-gray-400"
                      title="Dismiss"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function SeverityIcon({ severity }: { severity: string }) {
  switch (severity) {
    case 'error':
      return <XCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />;
    case 'warning':
      return <AlertTriangle className="w-5 h-5 text-yellow-500 shrink-0 mt-0.5" />;
    case 'success':
      return <CheckCircle className="w-5 h-5 text-green-500 shrink-0 mt-0.5" />;
    default:
      return <Info className="w-5 h-5 text-blue-500 shrink-0 mt-0.5" />;
  }
}
