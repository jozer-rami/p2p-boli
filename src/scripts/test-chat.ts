import { RestClientV5 } from 'bybit-api';
import 'dotenv/config';

const client = new RestClientV5({
  key: process.env.BYBIT_API_KEY!,
  secret: process.env.BYBIT_API_SECRET!,
  testnet: false,
});

const ORDER_ID = '2038023696851128320';

async function main() {
  // 1. Check pending orders
  console.log('=== Pending Orders ===');
  const pending = await client.getP2PPendingOrders({ page: '1', size: '50' } as any);
  const pendingItems = (pending as any).result?.items ?? [];
  console.log(`Pending: ${pendingItems.length}`);

  // 2. Check completed orders
  console.log('\n=== Recent Orders ===');
  const orders = await client.getP2POrders({ page: '1', size: '10' } as any);
  const orderItems = (orders as any).result?.items ?? [];
  console.log(`Total orders: ${orderItems.length}`);
  for (const o of orderItems) {
    const side = o.side === 1 ? 'SELL' : 'BUY';
    const statusMap: Record<number, string> = {
      10: 'NEW', 20: 'AWAITING_PAYMENT', 30: 'PAYMENT_MARKED',
      40: 'RELEASED', 50: 'CANCELLED', 60: 'DISPUTED',
    };
    const status = statusMap[o.status] || `STATUS_${o.status}`;
    console.log(`  #${o.id} | ${side} | ${o.notifyTokenQuantity} USDT @ ${o.price} BOB | ${status} | ${o.targetNickName}`);
  }

  // 3. Check specific order detail
  console.log(`\n=== Order Detail: ${ORDER_ID} ===`);
  try {
    const detail = await (client as any).getP2POrderDetail({ orderId: ORDER_ID });
    const r = detail as any;
    const d = r.result || r.ret_msg;
    console.log(JSON.stringify(d, null, 2));
  } catch (e: any) {
    console.log('Error:', e.message);
  }

  // 4. Balance check
  console.log('\n=== Balance ===');
  const bal = await client.getP2PAccountCoinsBalance({ accountType: 'FUND', coin: 'USDT' });
  const b = (bal as any).result?.balance?.[0];
  if (b) {
    console.log(`USDT: ${b.transferBalance} available, ${b.walletBalance} total`);
  }
}

main().catch(console.error);
