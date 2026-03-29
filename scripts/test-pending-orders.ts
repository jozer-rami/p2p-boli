import 'dotenv/config';
import { RestClientV5 } from 'bybit-api';
import crypto from 'crypto';

const apiKey = process.env.BYBIT_API_KEY!;
const apiSecret = process.env.BYBIT_API_SECRET!;
const testnet = process.env.BYBIT_TESTNET === 'true';

console.log('Config:', { apiKey: apiKey.slice(0, 6) + '...', testnet });

// Test 1: Use SDK with different param combos
const client = new RestClientV5({ key: apiKey, secret: apiSecret, testnet });

async function test() {
  // Try getP2POrders (completed) to see if that endpoint works
  console.log('\n--- Test 1: getP2POrders (completed orders) ---');
  try {
    const res = await client.getP2POrders({ page: 1, size: 10 });
    console.log('Result:', JSON.stringify(res, null, 2).slice(0, 800));
  } catch (err: any) {
    console.log('Error:', err.message);
  }

  // Try pending with no optional params
  console.log('\n--- Test 2: getP2PPendingOrders { page: 1, size: 10 } ---');
  try {
    const res = await client.getP2PPendingOrders({ page: 1, size: 10 });
    console.log('Result:', JSON.stringify(res, null, 2).slice(0, 800));
  } catch (err: any) {
    console.log('Error:', err.message);
  }

  // Try with strings via any cast
  console.log('\n--- Test 3: getP2PPendingOrders { page: "1", size: "10" } ---');
  try {
    const res = await client.getP2PPendingOrders({ page: '1', size: '10' } as any);
    console.log('Result:', JSON.stringify(res, null, 2).slice(0, 800));
  } catch (err: any) {
    console.log('Error:', err.message);
  }

  // Try with empty object
  console.log('\n--- Test 4: getP2PPendingOrders {} ---');
  try {
    const res = await client.getP2PPendingOrders({} as any);
    console.log('Result:', JSON.stringify(res, null, 2).slice(0, 800));
  } catch (err: any) {
    console.log('Error:', err.message);
  }

  // Try raw HTTP call
  console.log('\n--- Test 5: Raw POST to /v5/p2p/order/pending/simplifyList ---');
  try {
    const timestamp = Date.now().toString();
    const recvWindow = '5000';
    const body = JSON.stringify({ page: 1, size: 10 });
    const signPayload = timestamp + apiKey + recvWindow + body;
    const signature = crypto.createHmac('sha256', apiSecret).update(signPayload).digest('hex');

    const baseUrl = testnet ? 'https://api-testnet.bybit.com' : 'https://api.bybit.com';
    const res = await fetch(`${baseUrl}/v5/p2p/order/pending/simplifyList`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-BAPI-API-KEY': apiKey,
        'X-BAPI-TIMESTAMP': timestamp,
        'X-BAPI-SIGN': signature,
        'X-BAPI-RECV-WINDOW': recvWindow,
      },
      body,
    });
    const data = await res.json();
    console.log('Result:', JSON.stringify(data, null, 2).slice(0, 800));
  } catch (err: any) {
    console.log('Error:', err.message);
  }
}

test().catch(console.error);
