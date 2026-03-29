import crypto from 'crypto';
import 'dotenv/config';

const API_KEY = process.env.BYBIT_API_KEY!;
const API_SECRET = process.env.BYBIT_API_SECRET!;

async function rawPost(path: string, body: Record<string, any> = {}) {
  const timestamp = String(Date.now());
  const recvWindow = '5000';
  const bodyStr = JSON.stringify(body);
  const preSign = timestamp + API_KEY + recvWindow + bodyStr;
  const signature = crypto.createHmac('sha256', API_SECRET).update(preSign).digest('hex');

  const res = await fetch(`https://api.bybit.com${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-BAPI-API-KEY': API_KEY,
      'X-BAPI-TIMESTAMP': timestamp,
      'X-BAPI-SIGN': signature,
      'X-BAPI-RECV-WINDOW': recvWindow,
    },
    body: bodyStr,
  });
  return res.json();
}

async function main() {
  // Integer params, size <= 30
  console.log('=== page:1, size:30 (integers) ===');
  const r1 = await rawPost('/v5/p2p/order/simplifyList', { page: 1, size: 30 });
  console.log(`ret_code: ${r1.ret_code}, count: ${r1.result?.count}, items: ${r1.result?.items?.length ?? 0}`);
  if (r1.result?.items?.length > 0) {
    for (const o of r1.result.items.slice(0, 5)) {
      const status: Record<number, string> = { 10: 'NEW', 20: 'AWAIT_PAY', 30: 'PAID', 40: 'RELEASED', 50: 'DONE' };
      console.log(`  ${o.id} | side=${o.side} | ${status[o.status] || o.status} | ${o.notifyTokenQuantity} USDT @ ${o.price} | ${o.targetNickName}`);
    }
  }
}

main();
