import { useStatus, useOrders } from '../hooks/useApi';
import OrderRow from '../components/OrderRow';

export default function Overview() {
  const { data: status, isLoading } = useStatus();
  const { data: orders } = useOrders();

  if (isLoading || !status) {
    return <div className="text-text-faint">Loading...</div>;
  }

  const s = status as any;
  const orderList = (orders ?? []) as any[];

  return (
    <div>
      <div className="flex items-baseline gap-8 mb-8">
        <div>
          <span className={`text-sm font-semibold ${s.botState === 'running' ? 'text-green-500' : 'text-red-500'}`}>
            {s.botState.toUpperCase()}
          </span>
        </div>
        <div>
          <span className="text-text-faint text-xs uppercase mr-2">Orders</span>
          <span className="font-num">{s.pendingOrders}</span>
        </div>
        <div>
          <span className="text-text-faint text-xs uppercase mr-2">Profit today</span>
          <span className="font-num text-lg font-semibold">{s.todayProfit.profitBob.toFixed(2)}</span>
          <span className="text-text-faint text-xs ml-1">BOB</span>
        </div>
        <div>
          <span className="text-text-faint text-xs uppercase mr-2">Ask</span>
          <span className="font-num">{s.prices.ask.toFixed(2)}</span>
        </div>
        <div>
          <span className="text-text-faint text-xs uppercase mr-2">Bid</span>
          <span className="font-num">{s.prices.bid.toFixed(2)}</span>
        </div>
      </div>

      <div className="grid gap-10" style={{ gridTemplateColumns: '2fr 1fr' }}>
        <div>
          <h2 className="text-xs uppercase text-text-faint tracking-wide mb-3">Active Orders</h2>
          {orderList.length === 0 ? (
            <div className="text-text-faint text-sm py-4">
              No pending orders. Watching for incoming trades...
            </div>
          ) : (
            <div>
              {orderList.map((o: any) => (
                <OrderRow
                  key={o.id}
                  id={o.id}
                  side={o.side}
                  amount={o.amount}
                  price={o.price}
                  totalBob={o.totalBob}
                  status={o.status}
                  counterpartyName={o.counterpartyName}
                />
              ))}
            </div>
          )}
        </div>

        <div>
          <h2 className="text-xs uppercase text-text-faint tracking-wide mb-3">Bank Accounts</h2>
          {s.bankAccounts.map((a: any) => (
            <div key={a.id} className="flex justify-between py-2 border-b border-surface-muted/20 last:border-0 text-sm">
              <span className="text-text-muted">{a.name}</span>
              <span className="font-num">{a.balanceBob.toFixed(2)} <span className="text-text-faint text-xs">BOB</span></span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
