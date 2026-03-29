/**
 * Backfill trades from Bybit P2P order history into the local trades table.
 * Usage: npx tsx scripts/backfill-trades.ts
 */
import 'dotenv/config';
import { RestClientV5 } from 'bybit-api';
import { createDB, schema } from '../src/db/index.js';
import { envConfig } from '../src/config.js';
import { eq } from 'drizzle-orm';

const db = createDB(envConfig.db.path);

const client = new RestClientV5({
  key: envConfig.bybit.apiKey,
  secret: envConfig.bybit.apiSecret,
  testnet: false,
});

async function fetchAllOrders(): Promise<any[]> {
  const allOrders: any[] = [];
  let page = 1;

  while (true) {
    console.log(`Requesting page ${page}...`);
    const res = await (client as any).getP2POrders({ page, size: 20 });
    console.log('Raw response keys:', Object.keys(res));
    console.log('ret_code:', res.ret_code, 'retCode:', res.retCode);
    const retCode = res.ret_code ?? res.retCode ?? -1;
    if (retCode !== 0) {
      console.error(`API error on page ${page}: ${res.ret_msg ?? res.retMsg} (code ${retCode})`);
      break;
    }

    const items = res.result?.items ?? [];
    if (items.length === 0) break;

    allOrders.push(...items);
    console.log(`Page ${page}: ${items.length} orders (total: ${allOrders.length})`);

    if (items.length < 20) break;
    page++;
  }

  return allOrders;
}

async function backfill() {
  console.log('Fetching orders from Bybit...\n');
  const orders = await fetchAllOrders();
  console.log(`\nFound ${orders.length} orders\n`);

  let inserted = 0;
  let skipped = 0;

  for (const order of orders) {
    const orderId = String(order.id);

    const existing = await db
      .select()
      .from(schema.trades)
      .where(eq(schema.trades.bybitOrderId, orderId))
      .get();

    if (existing) {
      skipped++;
      continue;
    }

    const bybitStatus = Number(order.status);
    let tradeStatus = 'pending';
    if (bybitStatus === 40 || bybitStatus === 50) tradeStatus = 'completed';
    if (bybitStatus === 60) tradeStatus = 'disputed';

    const side = order.side === 1 || order.side === '1' ? 'sell' : 'buy';
    const amountUsdt = parseFloat(order.notifyTokenQuantity || '0');
    const priceBob = parseFloat(order.price || '0');
    const totalBob = parseFloat(order.amount || '0');
    const createdAt = order.createDate
      ? new Date(parseInt(order.createDate)).toISOString()
      : new Date().toISOString();
    const completedAt = tradeStatus === 'completed' ? createdAt : null;

    await db.insert(schema.trades).values({
      bybitOrderId: orderId,
      side,
      amountUsdt,
      priceBob,
      totalBob,
      counterpartyId: order.targetUserId || null,
      counterpartyName: order.targetNickName || null,
      status: tradeStatus,
      createdAt,
      completedAt,
    });

    inserted++;
    console.log(`  + ${side.toUpperCase()} ${amountUsdt} USDT @ ${priceBob} BOB — ${order.targetNickName} (${tradeStatus})`);
  }

  console.log(`\nDone: ${inserted} inserted, ${skipped} already existed`);
}

backfill().catch(console.error);
