// dashboard/src/pages/Operations.tsx
import { useOperations } from '../hooks/useApi';
import { useActivityLog, type LogEntry } from '../hooks/useActivityLog';

const ACTION_COLOR: Record<string, string> = {
  reprice: 'text-green-400',
  hold: 'text-text-muted',
  pause: 'text-amber-400',
};

function spreadColor(spread: number): string {
  if (spread >= 0.015) return 'text-green-400';
  if (spread > 0) return 'text-amber-400';
  return 'text-red-400';
}

const SEVERITY_COLOR: Record<string, string> = {
  problem: 'text-red-400',
  change: 'text-amber-400',
  info: 'text-text',
};

function formatLastEvent(ts: number | null): string {
  if (!ts) return 'Last event: never';
  const ago = Math.round((Date.now() - ts) / 1000);
  if (ago < 60) return `Last event: ${ago}s ago`;
  return `Last event: ${Math.round(ago / 60)}m ago`;
}

export default function Operations() {
  const { data, isLoading } = useOperations();
  const { entries, lastEventAt } = useActivityLog();

  if (isLoading || !data) {
    return <div className="text-text-faint">Loading...</div>;
  }

  const { imbalance: imb, ads, repricing: rp } = data;
  const total = imb.sellVol + imb.buyVol;
  const buyPct = total > 0 ? (imb.buyVol / total) * 100 : 50;
  const sellPct = total > 0 ? (imb.sellVol / total) * 100 : 50;

  return (
    <div>
      <div className="grid gap-10" style={{ gridTemplateColumns: '1fr 1fr' }}>
        {/* Left — Liquidity & Imbalance */}
        <div>
          <h2 className="text-xs uppercase text-text-faint tracking-wide mb-3">Liquidity & Imbalance</h2>

          <div className="flex items-baseline gap-1.5 mb-2">
            <span className="text-text-faint text-xs uppercase">Net</span>
            <span className={`font-num text-lg font-semibold ${imb.net >= 0 ? 'text-amber-400' : 'text-blue-400'}`}>
              {imb.net >= 0 ? '+' : ''}{imb.net.toFixed(0)}
            </span>
            <span className="text-text-faint font-num text-sm">/ {imb.threshold}</span>
          </div>

          {imb.pausedSide && (
            <div className="text-red-400 text-xs mt-1 mb-2">
              {imb.pausedSide} side paused by imbalance limiter
            </div>
          )}

          <div className="flex items-baseline gap-4 mb-3">
            <div className="flex items-baseline gap-1.5">
              <span className="text-text-faint text-xs uppercase">Sell Vol</span>
              <span className="font-num text-sm text-amber-400">{imb.sellVol.toFixed(0)}</span>
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-text-faint text-xs uppercase">Buy Vol</span>
              <span className="font-num text-sm text-blue-400">{imb.buyVol.toFixed(0)}</span>
            </div>
          </div>

          {/* Balance bar */}
          <div className="flex items-center gap-2 mb-4">
            <span className="text-text-faint text-[10px] font-num">BUY {imb.buyVol.toFixed(0)}</span>
            <div className="flex-1 bg-surface-muted rounded h-1.5 overflow-hidden flex">
              <div className="bg-blue-400 h-full" style={{ width: `${buyPct}%` }} />
              <div className="bg-amber-400 h-full" style={{ width: `${sellPct}%` }} />
            </div>
            <span className="text-text-faint text-[10px] font-num">SELL {imb.sellVol.toFixed(0)}</span>
          </div>

          {/* Ad state */}
          <div className="border-t border-surface-muted/20 pt-3">
            {ads.sell || ads.buy ? (
              <div className="flex flex-col gap-2">
                {ads.sell && (
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-text-faint text-xs uppercase">Sell Ad</span>
                    <span className="font-num text-sm">{ads.sell.amountUsdt.toFixed(0)} USDT</span>
                    <span className="text-text-faint text-xs">@ {ads.sell.price.toFixed(3)}</span>
                  </div>
                )}
                {ads.buy && (
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-text-faint text-xs uppercase">Buy Ad</span>
                    <span className="font-num text-sm">{ads.buy.amountUsdt.toFixed(0)} USDT</span>
                    <span className="text-text-faint text-xs">@ {ads.buy.price.toFixed(3)}</span>
                  </div>
                )}
              </div>
            ) : (
              <span className="text-text-faint text-sm">No active ads</span>
            )}
          </div>
        </div>

        {/* Right — Pricing & Repricing */}
        <div>
          <h2 className="text-xs uppercase text-text-faint tracking-wide mb-3">Pricing & Repricing</h2>

          {rp ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-baseline gap-4">
                <div className="flex items-baseline gap-1.5">
                  <span className="text-text-faint text-xs uppercase">Buy</span>
                  <span className="font-num text-lg font-semibold text-blue-400">{rp.buyPrice.toFixed(3)}</span>
                </div>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-text-faint text-xs uppercase">Sell</span>
                  <span className="font-num text-lg font-semibold text-amber-400">{rp.sellPrice.toFixed(3)}</span>
                </div>
              </div>

              <div className="flex items-baseline gap-1.5">
                <span className="text-text-faint text-xs uppercase">Spread</span>
                <span className={`font-num text-sm ${spreadColor(rp.spread)}`}>{rp.spread.toFixed(3)}</span>
                <span className="text-text-faint text-xs">BOB</span>
              </div>

              <div className="flex items-baseline gap-1.5">
                <span className="text-text-faint text-xs uppercase">Action</span>
                <span className={`font-num text-xs font-semibold uppercase ${ACTION_COLOR[rp.action] ?? 'text-text-faint'}`}>
                  {rp.action}
                </span>
              </div>

              {(rp.action === 'hold' || rp.action === 'pause') && rp.reason && (
                <div className="text-xs text-text-faint truncate" title={rp.reason}>{rp.reason}</div>
              )}

              <div className="flex items-baseline gap-1.5">
                <span className="text-text-faint text-xs uppercase">Pos</span>
                <span className="font-num text-sm">
                  <span className="text-amber-400">S</span>#{rp.position.sell}
                  <span className="text-text-faint mx-1">/</span>
                  <span className="text-blue-400">B</span>#{rp.position.buy}
                </span>
              </div>

              <div className="flex items-baseline gap-4">
                <div className="flex items-baseline gap-1.5">
                  <span className="text-text-faint text-xs uppercase">Filtered</span>
                  <span className="font-num text-xs text-text-muted">{rp.filteredCompetitors.sell}s / {rp.filteredCompetitors.buy}b</span>
                </div>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-text-faint text-xs uppercase">Mode</span>
                  <span className="text-xs text-text-muted">{rp.mode}</span>
                </div>
              </div>
            </div>
          ) : (
            <span className="text-text-faint text-sm">Engine starting...</span>
          )}
        </div>
      </div>

      {/* Activity Log */}
      <div className="mt-8">
        <h2 className="text-xs uppercase text-text-faint tracking-wide mb-3">Activity</h2>
        {entries.length === 0 ? (
          <div className="text-text-faint text-sm">{formatLastEvent(lastEventAt)}</div>
        ) : (
          <div>
            {entries.map((entry: LogEntry) => (
              <div key={entry.id} className="py-1.5 border-b border-surface-muted/10 flex items-baseline gap-3">
                <span className="font-num text-xs text-text-faint">{entry.time}</span>
                <span className={`text-xs font-semibold uppercase w-20 inline-block ${SEVERITY_COLOR[entry.severity]}`}>
                  {entry.label}
                </span>
                <span className="text-xs text-text-muted">{entry.detail}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
