import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import clsx from 'clsx';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  className?: string;
  hideHeader?: boolean;
}

export function Modal({ open, onClose, title, children, className, hideHeader }: ModalProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    if (open) document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30">
      <div className="absolute inset-0" onClick={onClose} />
      <div
        ref={ref}
        className={clsx(
          'relative bg-white rounded-xl shadow-2xl border border-gray-200 w-full max-w-md mx-4 flex flex-col max-h-[85vh]',
          className,
        )}
      >
        {!hideHeader && (
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
            <h2 className="text-base font-semibold text-gray-900">{title}</h2>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100">
              <X className="w-5 h-5 text-gray-500" />
            </button>
          </div>
        )}
        <div className="p-5 overflow-y-auto">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
