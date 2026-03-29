import { BybitClient } from '../bybit/client.js';
import 'dotenv/config';

const client = new BybitClient(
  process.env.BYBIT_API_KEY!,
  process.env.BYBIT_API_SECRET!,
  false,
);

async function main() {
  console.log('=== getPendingOrders ===');
  const pending = await client.getPendingOrders();
  console.log(`Pending: ${pending.length}`);
  for (const o of pending) {
    console.log(`  ${o.id} | ${o.side} | ${o.amount} USDT @ ${o.price} | ${o.counterpartyName}`);
  }

  console.log('\n=== getPaymentMethods ===');
  const payments = await client.getPaymentMethods();
  console.log(`Methods: ${payments.length}`);
  for (const p of payments) {
    console.log(`  ${p.id} | ${p.bankName} | ${p.accountNo}`);
  }

  console.log('\n=== getBalance ===');
  const bal = await client.getBalance('USDT');
  console.log(`USDT: ${bal.available} available, ${bal.frozen} frozen`);
}

main().catch(console.error);
