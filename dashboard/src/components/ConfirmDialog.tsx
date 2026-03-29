import { useEffect } from 'react';

interface Props {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  confirmColor?: 'green' | 'red';
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
}

export default function ConfirmDialog({ open, title, message, confirmLabel, confirmColor = 'green', onConfirm, onCancel, loading }: Props) {
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel();
      if (e.key === 'Enter' && !loading) onConfirm();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onConfirm, onCancel, loading]);

  if (!open) return null;

  const btnClass = confirmColor === 'green'
    ? 'bg-green-600 hover:bg-green-500 text-white'
    : 'bg-red-600 hover:bg-red-500 text-white';

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <div className="bg-surface-subtle border border-surface-muted/30 p-6 max-w-md w-full mx-4">
        <h3 className="text-base font-semibold">{title}</h3>
        <p className="text-text-muted mt-2 text-sm">{message}</p>
        <div className="text-text-faint text-xs mt-3">Enter to confirm · Esc to cancel</div>
        <div className="flex justify-end gap-3 mt-5">
          <button onClick={onCancel} className="px-4 py-2 text-sm text-text-faint hover:text-text" disabled={loading}>
            Cancel
          </button>
          <button onClick={onConfirm} className={`px-4 py-2 text-sm font-semibold ${btnClass}`} disabled={loading}>
            {loading ? 'Processing...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
