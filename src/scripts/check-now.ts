import { BybitClient } from '../bybit/client.js';
import 'dotenv/config';

const client = new BybitClient(
  process.env.BYBIT_API_KEY!,
  process.env.BYBIT_API_SECRET!,
  false,
);

async function main() {
  console.log('=== Testing our BybitClient.getPendingOrders() ===');
  try {
    const orders = await client.getPendingOrders();
    console.log(`Found ${orders.length} pending orders:`);
    for (const o of orders) {
      console.log(`  ${o.id} | ${o.side} | status=${o.status} | ${o.amount} USDT @ ${o.price} | ${o.counterpartyName}`);
    }
  } catch (err) {
    console.error('Error:', err);
  }
}

main().catch(console.error);
