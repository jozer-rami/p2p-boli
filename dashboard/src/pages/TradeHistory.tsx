import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTrades } from '../hooks/useApi';
import { useChatSidebar } from '../hooks/useChatSidebar';

const RANGES = ['today', '7d', '30d'] as const;
const RANGE_LABELS: Record<string, string> = { today: 'Today', '7d': '7 days', '30d': '30 days' };

export default function TradeHistory() {
  const [range, setRange] = useState<string>('today');
  const navigate = useNavigate();
  const { openChat } = useChatSidebar();
  const { data, isLoading } = useTrades(range);

  const result = data as any;
  const trades = result?.trades ?? [];
  const summary = result?.summary ?? { tradesCount: 0, volumeUsdt: 0, profitBob: 0 };
  const prev = result?.previousPeriod ?? { profitBob: 0 };

  const profitDelta = prev.profitBob > 0
    ? ((summary.profitBob - prev.profitBob) / prev.profitBob * 100).toFixed(0)
    : null;

  return (
    <div>
      <div className="mb-6">
        <div className="text-text-faint text-xs uppercase tracking-wide mb-1">Profit</div>
        <div className="flex items-baseline gap-3">
          <span className="font-num text-3xl font-semibold">{summary.profitBob.toFixed(2)}</span>
          <span className="text-text-faint text-sm">BOB</span>
          {profitDelta !== null && (
            <span className={`text-xs font-num ${Number(profitDelta) >= 0 ? 'text-green-500' : 'text-red-400'}`}>
              {Number(profitDelta) >= 0 ? '+' : ''}{profitDelta}% vs prev
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between mb-4">
        <div className="flex gap-1">
          {RANGES.map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`px-3 py-1 text-xs ${range === r ? 'text-text border-b border-text' : 'text-text-faint hover:text-text-muted'}`}
            >
              {RANGE_LABELS[r]}
            </button>
          ))}
        </div>
        <div className="text-xs text-text-faint">
          <span className="font-num">{summary.tradesCount}</span> trades · <span className="font-num">{summary.volumeUsdt.toFixed(0)}</span> USDT vol
        </div>
      </div>

      {isLoading ? (
        <div className="text-text-faint text-sm">Loading...</div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-text-faint uppercase text-[10px] tracking-wide">
              <th className="text-left py-2 pr-3 border-b border-surface-muted/20">Time</th>
              <th className="text-left py-2 pr-3 border-b border-surface-muted/20">Side</th>
              <th className="text-right py-2 pr-3 border-b border-surface-muted/20">USDT</th>
              <th className="text-right py-2 pr-3 border-b border-surface-muted/20">Price</th>
              <th className="text-right py-2 pr-3 border-b border-surface-muted/20">Total BOB</th>
              <th className="text-right py-2 pr-3 border-b border-surface-muted/20">Spread</th>
              <th className="text-left py-2 pr-3 border-b border-surface-muted/20">Counterparty</th>
              <th className="text-left py-2 border-b border-surface-muted/20">Status</th>
              <th className="text-left py-2 border-b border-surface-muted/20"></th>
            </tr>
          </thead>
          <tbody>
            {trades.map((t: any) => (
              <tr key={t.id} onClick={() => navigate(`/order/${t.bybitOrderId}`)} className="border-b border-surface-muted/10 hover:bg-surface-subtle/30 cursor-pointer">
                <td className="py-2 pr-3 font-num text-text-muted">{t.createdAt ? new Date(t.createdAt).toLocaleTimeString() : '-'}</td>
                <td className={`py-2 pr-3 text-xs font-semibold ${t.side === 'sell' ? 'text-amber-400' : 'text-blue-400'}`}>{t.side.toUpperCase()}</td>
                <td className="py-2 pr-3 text-right font-num">{t.amountUsdt}</td>
                <td className="py-2 pr-3 text-right font-num">{t.priceBob.toFixed(3)}</td>
                <td className="py-2 pr-3 text-right font-num">{t.totalBob.toFixed(2)}</td>
                <td className="py-2 pr-3 text-right font-num text-text-muted">
                  {t.spreadCaptured != null ? `${(t.spreadCaptured * 100).toFixed(1)}%` : '-'}
                </td>
                <td className="py-2 pr-3 text-text-muted">{t.counterpartyName ?? '-'}</td>
                <td className="py-2">
                  <span className={t.status === 'completed' ? 'text-green-500' : 'text-text-faint'}>{t.status}</span>
                </td>
                <td className="py-2">
                  <button
                    onClick={(e) => { e.stopPropagation(); openChat(t.bybitOrderId); }}
                    className="text-text-faint hover:text-text text-xs"
                  >
                    chat
                  </button>
                </td>
              </tr>
            ))}
            {trades.length === 0 && (
              <tr><td colSpan={9} className="py-6 text-center text-text-faint">No trades in this period</td></tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}
