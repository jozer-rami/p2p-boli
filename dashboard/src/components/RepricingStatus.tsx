import { useRepricingStatus } from '../hooks/useApi';

const ACTION_STYLE: Record<string, string> = {
  reprice: 'text-green-400',
  hold: 'text-text-muted',
  pause: 'text-amber-400',
  none: 'text-text-faint',
};

export default function RepricingStatus() {
  const { data } = useRepricingStatus();

  if (!data) return null;

  const s = data;
  const spreadLabel = s.spread > 0
    ? `${s.spread.toFixed(3)}`
    : s.spread < 0 ? `${s.spread.toFixed(3)}` : '0';

  const spreadColor = s.spread >= 0.015
    ? 'text-green-400'
    : s.spread > 0 ? 'text-amber-400' : 'text-red-400';

  return (
    <div className="flex items-baseline gap-6 py-2 border-b border-surface-muted/20 mb-4 -mt-2">
      <div className="flex items-baseline gap-1.5">
        <span className="text-text-faint text-xs uppercase">Engine</span>
        <span className={`font-num text-xs font-semibold uppercase ${ACTION_STYLE[s.action] ?? 'text-text-faint'}`}>
          {s.action}
        </span>
      </div>

      <div className="flex items-baseline gap-1.5">
        <span className="text-text-faint text-xs uppercase">Spread</span>
        <span className={`font-num text-sm ${spreadColor}`}>{spreadLabel}</span>
        <span className="text-text-faint text-xs">BOB</span>
      </div>

      {s.action === 'reprice' && (
        <>
          <div className="flex items-baseline gap-1.5">
            <span className="text-text-faint text-xs uppercase">Pos</span>
            <span className="font-num text-sm">
              <span className="text-amber-400">S</span>#{s.position.sell}
              <span className="text-text-faint mx-1">/</span>
              <span className="text-blue-400">B</span>#{s.position.buy}
            </span>
          </div>

          <div className="flex items-baseline gap-1.5">
            <span className="text-text-faint text-xs uppercase">Buy</span>
            <span className="font-num text-sm">{s.buyPrice.toFixed(3)}</span>
            <span className="text-text-faint text-xs mx-1">&rarr;</span>
            <span className="text-text-faint text-xs uppercase">Sell</span>
            <span className="font-num text-sm">{s.sellPrice.toFixed(3)}</span>
          </div>
        </>
      )}

      <div className="flex items-baseline gap-1.5">
        <span className="text-text-faint text-xs uppercase">Mode</span>
        <span className="text-xs text-text-muted">{s.mode}</span>
      </div>

      <div className="flex items-baseline gap-1.5">
        <span className="text-text-faint text-xs uppercase">Filtered</span>
        <span className="font-num text-xs text-text-muted">
          {s.filteredCompetitors.sell}s / {s.filteredCompetitors.buy}b
        </span>
      </div>

      {s.action === 'pause' && (
        <span className="text-xs text-text-faint truncate max-w-[300px]" title={s.reason}>
          {s.reason}
        </span>
      )}
    </div>
  );
}
