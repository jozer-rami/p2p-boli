import 'dotenv/config';
import { RestClientV5 } from 'bybit-api';

const c = new RestClientV5({
  key: process.env.BYBIT_API_KEY!,
  secret: process.env.BYBIT_API_SECRET!,
  testnet: false,
});

async function main() {
  console.log('Testing getP2POrders...');
  const r = await (c as any).getP2POrders({ page: 1, size: 10 });
  console.log('retCode:', r.ret_code ?? r.retCode);
  console.log('count:', r.result?.count);

  const items = r.result?.items ?? [];
  for (const i of items) {
    console.log(`  ${i.side === 1 ? 'SELL' : 'BUY'} ${i.notifyTokenQuantity} USDT @ ${i.price} BOB — ${i.targetNickName} (status: ${i.status})`);
  }
}

main().catch(console.error);
