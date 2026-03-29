import { useNavigate } from 'react-router-dom';

interface Props {
  id: string;
  side: string;
  amount: number;
  price: number;
  totalBob: number;
  status: string;
  counterpartyName: string;
}

const STATUS_COLOR: Record<string, string> = {
  payment_marked: 'text-amber-400',
  awaiting_payment: 'text-blue-400',
  new: 'text-text-faint',
  disputed: 'text-red-400',
};

export default function OrderRow({ id, side, amount, price, totalBob, status, counterpartyName }: Props) {
  const navigate = useNavigate();

  return (
    <div
      onClick={() => navigate(`/order/${id}`)}
      className="flex items-baseline justify-between py-2.5 border-b border-surface-muted/20 cursor-pointer hover:bg-surface-subtle/50 -mx-2 px-2 transition-colors"
    >
      <div className="flex items-baseline gap-3">
        <span className={`text-xs font-semibold uppercase ${side === 'sell' ? 'text-amber-400' : 'text-blue-400'}`}>
          {side}
        </span>
        <span className="font-num text-sm">{amount}</span>
        <span className="text-text-faint text-xs">@</span>
        <span className="font-num text-sm">{price.toFixed(3)}</span>
        <span className="text-text-faint text-xs">=</span>
        <span className="font-num text-sm font-semibold">{totalBob.toFixed(2)}</span>
        <span className="text-text-faint text-xs">BOB</span>
      </div>
      <div className="flex items-baseline gap-3">
        <span className="text-text-muted text-xs">{counterpartyName}</span>
        <span className={`text-xs ${STATUS_COLOR[status] ?? 'text-text-faint'}`}>
          {status.replace('_', ' ')}
        </span>
      </div>
    </div>
  );
}
