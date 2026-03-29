import { RestClientV5 } from 'bybit-api';
import 'dotenv/config';

const client = new RestClientV5({
  key: process.env.BYBIT_API_KEY!,
  secret: process.env.BYBIT_API_SECRET!,
  testnet: false,
});

async function main() {
  const res = await client.getP2POnlineAds({
    tokenId: 'USDT',
    currencyId: 'BOB',
    side: '1', // sell ads
  } as any);

  const items = (res as any).result?.items ?? [];
  if (items.length > 0) {
    console.log('=== FULL AD OBJECT (first ad) ===');
    console.log(JSON.stringify(items[0], null, 2));
    console.log('\n=== ALL FIELD NAMES ===');
    console.log(Object.keys(items[0]).join(', '));
  }
}

main().catch(console.error);
