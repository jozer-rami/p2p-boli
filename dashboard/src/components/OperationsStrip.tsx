// dashboard/src/components/OperationsStrip.tsx
import { Link } from 'react-router-dom';
import { useOperations } from '../hooks/useApi';

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

function dotColor(net: number, threshold: number, pausedSide: string | null): string {
  if (pausedSide) return 'bg-red-500';
  if (Math.abs(net) > threshold * 0.8) return 'bg-amber-500';
  return 'bg-green-500';
}

export default function OperationsStrip() {
  const { data } = useOperations();

  if (!data) return null;

  const { imbalance: imb, repricing: rp } = data;
  const total = imb.sellVol + imb.buyVol;
  const buyPct = total > 0 ? (imb.buyVol / total) * 100 : 50;
  const sellPct = total > 0 ? (imb.sellVol / total) * 100 : 50;

  return (
    <div className="border-b border-surface-muted/20 py-2 mb-4 -mt-2">
      {/* Top row */}
      <div className="flex items-baseline gap-6">
        <div className="flex items-center gap-1.5">
          <div className={`w-1.5 h-1.5 rounded-full ${dotColor(imb.net, imb.threshold, imb.pausedSide)}`} />
          <span className="text-text-faint text-xs uppercase">Net</span>
          <span className="font-num text-xs font-semibold">
            {imb.net >= 0 ? '+' : ''}{imb.net.toFixed(0)}
          </span>
          <span className="text-text-faint text-xs">/ {imb.threshold}</span>
        </div>

        {rp ? (
          <>
            <div className="flex items-baseline gap-1.5">
              <span className="text-text-faint text-xs uppercase">Buy</span>
              <span className="font-num text-sm">{rp.buyPrice.toFixed(3)}</span>
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-text-faint text-xs uppercase">Sell</span>
              <span className="font-num text-sm">{rp.sellPrice.toFixed(3)}</span>
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-text-faint text-xs uppercase">Spread</span>
              <span className={`font-num text-sm ${spreadColor(rp.spread)}`}>{rp.spread.toFixed(3)}</span>
              <span className="text-text-faint text-xs">BOB</span>
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-text-faint text-xs uppercase">Engine</span>
              <span className={`font-num text-xs font-semibold uppercase ${ACTION_COLOR[rp.action] ?? 'text-text-faint'}`}>
                {rp.action}
              </span>
            </div>
            {rp.action === 'reprice' && (
              <div className="flex items-baseline gap-1.5">
                <span className="text-text-faint text-xs uppercase">Pos</span>
                <span className="font-num text-sm">
                  <span className="text-amber-400">S</span>#{rp.position.sell}
                  <span className="text-text-faint mx-1">/</span>
                  <span className="text-blue-400">B</span>#{rp.position.buy}
                </span>
              </div>
            )}
            <div className="flex items-baseline gap-1.5">
              <span className="text-text-faint text-xs uppercase">Mode</span>
              <span className="text-xs text-text-muted">{rp.mode}</span>
            </div>
          </>
        ) : (
          <span className="text-text-faint text-xs">Engine starting...</span>
        )}

        <Link to="/operations" className="ml-auto text-xs text-text-faint hover:text-text transition-colors">
          Operations &rarr;
        </Link>
      </div>

      {/* Bottom row — balance bar */}
      <div className="flex items-center gap-2 mt-1">
        <span className="text-text-faint text-[10px] font-num">BUY {imb.buyVol.toFixed(0)}</span>
        <div className="flex-1 bg-surface-muted rounded h-1 overflow-hidden flex">
          <div className="bg-blue-400 h-full" style={{ width: `${buyPct}%` }} />
          <div className="bg-amber-400 h-full" style={{ width: `${sellPct}%` }} />
        </div>
        <span className="text-text-faint text-[10px] font-num">SELL {imb.sellVol.toFixed(0)}</span>
      </div>
    </div>
  );
}
