import { RestClientV5 } from 'bybit-api';
import 'dotenv/config';

const client = new RestClientV5({
  key: process.env.BYBIT_API_KEY!,
  secret: process.env.BYBIT_API_SECRET!,
  testnet: process.env.BYBIT_TESTNET === 'true',
});

async function main() {
  console.log('--- getPendingOrders (empty params) ---');
  try {
    const res = await client.getP2PPendingOrders({} as any);
    console.log('ret_code:', (res as any).ret_code);
    console.log('result:', JSON.stringify((res as any).result, null, 2));
  } catch (err) {
    console.error('Error:', err);
  }
}

main().catch(console.error);
