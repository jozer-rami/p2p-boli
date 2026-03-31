import { useRepricingOrderbook, useRepricingStatus, type OrderBookEntry } from '../hooks/useApi';

function BookTable({ title, entries, side, accentColor }: {
  title: string;
  entries: OrderBookEntry[];
  side: 'sell' | 'buy';
  accentColor: string;
}) {
  return (
    <div>
      <h3 className="text-xs uppercase text-text-faint tracking-wide mb-2">
        {title} <span className="text-text-faint/50">({entries.length})</span>
      </h3>
      <div className="text-xs">
        <div className="flex items-baseline gap-1 text-text-faint/60 border-b border-surface-muted/20 pb-1 mb-1">
          <span className="w-6 text-right">#</span>
          <span className="w-16 text-right">Price</span>
          <span className="w-20 text-right">USDT</span>
          <span className="flex-1 pl-3">Merchant</span>
          <span className="w-10 text-right">Rate</span>
          <span className="w-12 text-right">Orders</span>
        </div>
        {entries.map((e) => {
          const isYou = e.nickName === 'joseR' || e.nickName === 'YOU';
          return (
            <div
              key={`${e.rank}-${e.price}-${e.nickName}`}
              className={`flex items-baseline gap-1 py-0.5 ${
                isYou
                  ? 'bg-surface-subtle/60 -mx-2 px-2 rounded'
                  : 'hover:bg-surface-subtle/30 -mx-2 px-2'
              }`}
            >
              <span className="w-6 text-right font-num text-text-faint">{e.rank}</span>
              <span className={`w-16 text-right font-num ${isYou ? accentColor + ' font-semibold' : ''}`}>
                {e.price.toFixed(3)}
              </span>
              <span className="w-20 text-right font-num text-text-muted">
                {e.quantity >= 1000
                  ? `${(e.quantity / 1000).toFixed(1)}k`
                  : e.quantity.toFixed(0)}
              </span>
              <span className={`flex-1 pl-3 truncate ${isYou ? accentColor + ' font-semibold' : 'text-text-muted'}`}>
                {isYou ? `${e.nickName} (you)` : e.nickName}
              </span>
              <span className={`w-10 text-right font-num ${e.completionRate >= 98 ? 'text-green-400/70' : e.completionRate >= 90 ? 'text-text-muted' : 'text-amber-400/70'}`}>
                {e.completionRate}%
              </span>
              <span className="w-12 text-right font-num text-text-faint">
                {e.orders}
              </span>
            </div>
          );
        })}
        {entries.length === 0 && (
          <div className="text-text-faint py-3">No ads pass filters</div>
        )}
      </div>
    </div>
  );
}

export default function Market() {
  const { data: book, isLoading } = useRepricingOrderbook();
  const { data: status } = useRepricingStatus();

  if (isLoading || !book) {
    return <div className="text-text-faint">Loading order book...</div>;
  }

  const bestAsk = book.sell[0]?.price ?? 0;
  const bestBid = book.buy[0]?.price ?? 0;
  const spread = bestAsk - bestBid;

  return (
    <div>
      <div className="flex items-baseline gap-6 mb-6">
        <div>
          <span className="text-text-faint text-xs uppercase mr-2">Best Ask</span>
          <span className="font-num text-lg">{bestAsk.toFixed(3)}</span>
        </div>
        <div>
          <span className="text-text-faint text-xs uppercase mr-2">Best Bid</span>
          <span className="font-num text-lg">{bestBid.toFixed(3)}</span>
        </div>
        <div>
          <span className="text-text-faint text-xs uppercase mr-2">Spread</span>
          <span className={`font-num text-lg font-semibold ${
            spread >= 0.015 ? 'text-green-400' : spread > 0 ? 'text-amber-400' : 'text-red-400'
          }`}>
            {spread.toFixed(4)}
          </span>
          <span className="text-text-faint text-xs ml-1">BOB</span>
        </div>
        {status && (
          <div>
            <span className="text-text-faint text-xs uppercase mr-2">Engine</span>
            <span className={`text-xs font-semibold uppercase ${
              status.action === 'reprice' ? 'text-green-400'
                : status.action === 'hold' ? 'text-text-muted'
                : 'text-amber-400'
            }`}>{status.action}</span>
          </div>
        )}
      </div>

      <div className="grid gap-8" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <BookTable
          title="Sellers"
          entries={book.sell}
          side="sell"
          accentColor="text-amber-400"
        />
        <BookTable
          title="Buyers"
          entries={book.buy}
          side="buy"
          accentColor="text-blue-400"
        />
      </div>

      {book.excludedAggressive.length > 0 && (
        <div className="mt-6">
          <h3 className="text-xs uppercase text-text-faint tracking-wide mb-2">
            Excluded — Aggressive Pricing
          </h3>
          {book.excludedAggressive.map((ex, i) => (
            <div key={i} className="text-xs text-red-400/70 py-0.5">
              {ex.nickName} — {ex.price.toFixed(3)} BOB ({ex.side}, gap: {ex.gap.toFixed(4)})
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
