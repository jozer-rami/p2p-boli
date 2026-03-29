import { useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useOrder, useOrderChat, useStatus, useReleaseOrder, useDisputeOrder, useSendChatMessage, useSendChatImage } from '../hooks/useApi';
import ChatView from '../components/ChatView';
import ConfirmDialog from '../components/ConfirmDialog';

export default function ReleasePanel() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: order, isLoading } = useOrder(id!);
  const { data: chatMessages, isError: chatError, refetch: refetchChat } = useOrderChat(id!);
  const { data: status } = useStatus();
  const release = useReleaseOrder();
  const dispute = useDisputeOrder();
  const sendMessage = useSendChatMessage();
  const sendImage = useSendChatImage();
  const [showConfirm, setShowConfirm] = useState(false);
  const [showDispute, setShowDispute] = useState(false);
  const [releaseError, setReleaseError] = useState<string | null>(null);
  const [chatInput, setChatInput] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (isLoading || !order) {
    return <div className="text-text-faint">Loading order...</div>;
  }

  const o = order as any;
  const s = status as any;
  const messages = (chatMessages ?? []) as any[];
  const timeAgo = Math.round((Date.now() - o.createdAt) / 60000);
  const bybitUserId = s?.bybitUserId ?? '';

  return (
    <div>
      <button onClick={() => navigate('/')} className="text-text-faint hover:text-text text-xs mb-5">
        &larr; back
      </button>

      <div className="grid gap-8" style={{ gridTemplateColumns: '240px 1fr 240px' }}>
        <div>
          <h2 className="text-xs uppercase text-text-faint tracking-wide mb-3">Order</h2>
          <div className="text-sm text-text-muted space-y-1.5">
            <div className="font-num text-text-faint text-xs">#{o.id.slice(-12)}</div>
            <div className={`text-sm font-semibold ${o.side === 'sell' ? 'text-amber-400' : 'text-blue-400'}`}>{o.side.toUpperCase()}</div>
            <div><span className="font-num text-text">{o.amount}</span> USDT</div>
            <div>@ <span className="font-num text-text">{o.price}</span> BOB</div>
            <div className="pt-1 border-t border-surface-muted/20">
              <span className="font-num text-lg font-semibold text-text">{o.totalBob.toFixed(2)}</span>
              <span className="text-text-faint text-xs ml-1">BOB</span>
            </div>
            <div className="pt-1">{o.counterpartyName}</div>
            <div className={`text-xs ${o.status === 'payment_marked' ? 'text-amber-400' : 'text-text-faint'}`}>
              {o.status.replace('_', ' ')} · {timeAgo}m ago
            </div>
          </div>
        </div>

        <div className="flex flex-col max-h-[450px]">
          <h2 className="text-xs uppercase text-text-faint tracking-wide mb-3">Chat</h2>
          {chatError ? (
            <div className="text-text-faint text-sm">
              Could not load chat messages.{' '}
              <button onClick={() => refetchChat()} className="text-text-muted underline">Retry</button>
            </div>
          ) : (
            <div className="flex-1 overflow-hidden">
              <ChatView messages={messages} myUserId={bybitUserId} />
            </div>
          )}
          {/* Chat input */}
          <div className="flex gap-2 mt-2 pt-2 border-t border-surface-muted/20">
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && chatInput.trim()) {
                  sendMessage.mutate({ orderId: id!, message: chatInput.trim() });
                  setChatInput('');
                }
              }}
              placeholder="Type a message..."
              className="flex-1 bg-surface border border-surface-muted/30 px-3 py-1.5 text-sm text-text placeholder:text-text-faint outline-none focus:border-text-faint"
              disabled={sendMessage.isPending}
            />
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  sendImage.mutate({ orderId: id!, file });
                  e.target.value = '';
                }
              }}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="px-2 py-1.5 text-text-faint hover:text-text text-sm border border-surface-muted/30"
              disabled={sendImage.isPending}
              title="Send image"
            >
              {sendImage.isPending ? '...' : '📷'}
            </button>
          </div>
        </div>

        <div>
          <h2 className="text-xs uppercase text-text-faint tracking-wide mb-3">Bank</h2>
          <div className="text-sm text-text-muted space-y-1.5">
            <div className="text-text-faint text-[10px] uppercase">Expected payment</div>
            <div className="font-num text-lg font-semibold text-green-500">{o.totalBob.toFixed(2)} BOB</div>
            <div className="text-text">{o.bankAccountName || `Account #${o.bankAccountId}`}</div>
          </div>
          <div className="mt-6 border border-dashed border-surface-muted/30 p-3 text-center text-text-faint text-xs">
            Auto-verify: Phase 2
          </div>
        </div>
      </div>

      <div className="mt-8 pt-5 border-t border-surface-muted/20">
        {releaseError && (
          <div className="text-red-400 text-sm mb-3">{releaseError}</div>
        )}
        <button
          onClick={() => { setReleaseError(null); setShowConfirm(true); }}
          disabled={o.status !== 'payment_marked'}
          className="w-full py-3 text-sm font-semibold bg-green-600 hover:bg-green-500 text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          Release {o.totalBob.toFixed(2)} BOB to {o.counterpartyName}
        </button>
        <div className="text-center mt-2">
          <button onClick={() => setShowDispute(true)} className="text-text-faint text-xs hover:text-red-400">
            Open dispute
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={showConfirm}
        title="Confirm Release"
        message={`Release ${o.amount} USDT (${o.totalBob.toFixed(2)} BOB) to ${o.counterpartyName}. This cannot be undone.`}
        confirmLabel="Release Now"
        confirmColor="green"
        loading={release.isPending}
        onConfirm={() => {
          release.mutate(o.id, {
            onSuccess: () => { setShowConfirm(false); navigate('/'); },
            onError: (err: any) => { setShowConfirm(false); setReleaseError(err.message); },
          });
        }}
        onCancel={() => setShowConfirm(false)}
      />

      <ConfirmDialog
        open={showDispute}
        title="Open Dispute"
        message="Open a dispute for this order? This escalates to Bybit support."
        confirmLabel="Open Dispute"
        confirmColor="red"
        loading={dispute.isPending}
        onConfirm={() => {
          dispute.mutate(o.id, {
            onSuccess: () => { setShowDispute(false); navigate('/'); },
          });
        }}
        onCancel={() => setShowDispute(false)}
      />
    </div>
  );
}
