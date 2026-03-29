import { BybitClient } from '../bybit/client.js';
import { RestClientV5 } from 'bybit-api';
import 'dotenv/config';

const client = new BybitClient(
  process.env.BYBIT_API_KEY!,
  process.env.BYBIT_API_SECRET!,
  false,
);

const raw = new RestClientV5({
  key: process.env.BYBIT_API_KEY!,
  secret: process.env.BYBIT_API_SECRET!,
  testnet: false,
});

async function main() {
  console.log('=== Personal Ads ===');
  const res = await raw.getP2PPersonalAds({} as any);
  const r = res as any;
  const ads = r.result?.items ?? [];
  console.log(`Count: ${r.result?.count}, Items: ${ads.length}`);
  for (const a of ads) {
    const side = a.side === 1 ? 'SELL' : 'BUY';
    const status = a.status === 10 ? 'ACTIVE' : a.status === 20 ? 'PAUSED' : `STATUS_${a.status}`;
    console.log(`  Ad #${a.id}`);
    console.log(`    Side: ${side}`);
    console.log(`    Price: ${a.price} BOB/USDT`);
    console.log(`    Quantity: ${a.lastQuantity} / ${a.quantity} USDT`);
    console.log(`    Status: ${status}`);
    console.log(`    Remark: ${a.remark || '(none)'}`);
  }

  if (ads.length === 0) {
    console.log('No active ads found.');
  }

  console.log('\n=== Balance ===');
  const bal = await client.getBalance('USDT');
  console.log(`USDT: ${bal.available} available, ${bal.frozen} frozen`);
}

main().catch(console.error);
