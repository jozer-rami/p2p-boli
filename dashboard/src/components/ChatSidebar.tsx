import { useState, useRef, useEffect } from 'react';
import { useOrder, useOrderChat, useStatus, useSendChatMessage, useSendChatImage } from '../hooks/useApi';
import ChatView from './ChatView';

interface Props {
  orderId: string;
  onClose: () => void;
}

export default function ChatSidebar({ orderId, onClose }: Props) {
  const { data: order } = useOrder(orderId);
  const { data: chatMessages, isError, refetch } = useOrderChat(orderId);
  const { data: status } = useStatus();
  const sendMessage = useSendChatMessage();
  const sendImage = useSendChatImage();
  const [input, setInput] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const o = order as any;
  const s = status as any;
  const messages = (chatMessages ?? []) as any[];
  const bybitUserId = s?.bybitUserId ?? '';

  // Close on Escape
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  return (
    <div className="fixed inset-y-0 right-0 w-[360px] bg-surface border-l border-surface-muted/30 flex flex-col z-40">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-surface-muted/20">
        <div className="min-w-0">
          <div className="text-sm font-semibold truncate">
            {o?.counterpartyName ?? 'Loading...'}
          </div>
          {o && (
            <div className="text-[11px] text-text-faint">
              {o.side.toUpperCase()} {o.amount} USDT @ {o.price.toFixed(3)} — {o.status.replace('_', ' ')}
            </div>
          )}
        </div>
        <button onClick={onClose} className="text-text-faint hover:text-text text-lg ml-3">
          ×
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-hidden px-3 py-2">
        {isError ? (
          <div className="text-text-faint text-sm py-4">
            Could not load messages.{' '}
            <button onClick={() => refetch()} className="text-text-muted underline">Retry</button>
          </div>
        ) : (
          <ChatView messages={messages} myUserId={bybitUserId} />
        )}
      </div>

      {/* Input */}
      <div className="flex gap-2 px-3 py-3 border-t border-surface-muted/20">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && input.trim()) {
              sendMessage.mutate({ orderId, message: input.trim() });
              setInput('');
            }
          }}
          placeholder="Message..."
          className="flex-1 bg-surface-subtle border border-surface-muted/30 px-3 py-1.5 text-sm text-text placeholder:text-text-faint outline-none focus:border-text-faint"
          disabled={sendMessage.isPending}
        />
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) {
              sendImage.mutate({ orderId, file });
              e.target.value = '';
            }
          }}
        />
        <button
          onClick={() => fileRef.current?.click()}
          className="px-2 py-1.5 text-text-faint hover:text-text text-sm border border-surface-muted/30"
          disabled={sendImage.isPending}
          title="Send image"
        >
          {sendImage.isPending ? '...' : '📷'}
        </button>
      </div>
    </div>
  );
}
