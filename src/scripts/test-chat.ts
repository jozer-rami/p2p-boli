import { RestClientV5 } from 'bybit-api';
import 'dotenv/config';

const client = new RestClientV5({
  key: process.env.BYBIT_API_KEY!,
  secret: process.env.BYBIT_API_SECRET!,
  testnet: false,
});

const ORDER_ID = '2038023696851128320';

async function main() {
  // Try different param combos
  const paramSets = [
    { orderId: ORDER_ID, page: '1', size: '50' },
    { orderId: ORDER_ID, page: 1, size: 50 },
    { orderId: ORDER_ID, pageNo: '1', pageSize: '50' },
  ];

  for (const params of paramSets) {
    console.log(`\n--- getOrderMessages(${JSON.stringify(params)}) ---`);
    const res = await client.getP2POrderMessages(params as any);
    const r = res as any;
    const messages = r.result?.result ?? r.result?.items ?? r.result?.messages ?? [];
    console.log(`ret_code: ${r.ret_code}, totalRows: ${r.result?.totalRows}, messages: ${messages.length}`);

    if (messages.length > 0) {
      for (const msg of messages) {
        const from = msg.userId === '139499611' ? 'YOU' : msg.nickName || msg.userId;
        const type = msg.contentType === '1' ? 'TEXT' : msg.contentType === '2' ? 'IMAGE' : `TYPE_${msg.contentType}`;
        console.log(`  [${from}] (${type}): ${msg.content || msg.message || '[no content]'}`);
      }
    }

    // Also dump first message raw if found
    if (messages.length > 0) {
      console.log('\nRaw first message:', JSON.stringify(messages[0], null, 2));
    }

    // If still empty but totalRows > 0, dump full result
    if (messages.length === 0 && r.result?.totalRows > 0) {
      console.log('Full result keys:', Object.keys(r.result));
      console.log('Full result:', JSON.stringify(r.result, null, 2));
    }
  }
}

main().catch(console.error);
