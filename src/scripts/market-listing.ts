import { RestClientV5 } from 'bybit-api';
import 'dotenv/config';

const client = new RestClientV5({
  key: process.env.BYBIT_API_KEY!,
  secret: process.env.BYBIT_API_SECRET!,
  testnet: false,
});

async function main() {
  // Try SDK method
  for (const side of ['0', '1']) {
    console.log(`\n=== getP2POnlineAds(side=${side}) ===`);
    try {
      const res = await client.getP2POnlineAds({
        tokenId: 'USDT',
        currencyId: 'BOB',
        side,
      } as any);
      const r = res as any;
      const items = r.result?.items ?? [];
      console.log(`ret_code: ${r.ret_code ?? r.retCode}, items: ${items.length}`);
      for (const item of items.slice(0, 5)) {
        console.log(`  ${item.price} BOB | ${parseFloat(item.lastQuantity).toFixed(2)} USDT | ${item.nickName} | side=${item.side}`);
      }
      if (items.length === 0 && r.result) {
        console.log('Full result:', JSON.stringify(r.result).slice(0, 200));
      }
    } catch (err: any) {
      console.log('Error:', err.message);
    }
  }
}

main().catch(console.error);
