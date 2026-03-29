import { BybitClient } from '../bybit/client.js';
import 'dotenv/config';

const client = new BybitClient(
  process.env.BYBIT_API_KEY!,
  process.env.BYBIT_API_SECRET!,
  false,
);

const AD_ID = '2038045496222253056';
const PRICE = 9.335;
const AMOUNT = 300;
const PAYMENT_IDS = ['22058487', '20197358'];

async function main() {
  await client.updateAd(AD_ID, PRICE, AMOUNT, PAYMENT_IDS);
  console.log(`Ad updated: ${AMOUNT} USDT @ ${PRICE} BOB/USDT`);
}

main().catch(console.error);
