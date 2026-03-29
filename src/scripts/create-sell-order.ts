import { RestClientV5 } from 'bybit-api';
import 'dotenv/config';

const client = new RestClientV5({
  key: process.env.BYBIT_API_KEY!,
  secret: process.env.BYBIT_API_SECRET!,
  testnet: false,
});

async function main() {
  const price = '9.345';
  const quantity = '150';
  const side = '1'; // try 1 for sell (Bybit convention: 1=sell from maker perspective)

  console.log(`Creating SELL ad: ${quantity} USDT @ ${price} BOB/USDT`);
  console.log(`Total: ${(parseFloat(price) * parseFloat(quantity)).toFixed(2)} BOB`);

  try {
    // First check balance
    const bal = await client.getP2PAccountCoinsBalance({ accountType: 'FUND', coin: 'USDT' });
    const available = (bal as any).result?.balance?.[0]?.transferBalance;
    console.log(`\nAvailable USDT: ${available}`);

    // Get payment methods
    const payments = await (client as any).getP2PUserPayments({});
    const paymentItems = (payments as any).result ?? [];
    console.log(`\nPayment methods: ${paymentItems.length}`);
    for (const p of paymentItems) {
      console.log(`  ID: ${p.id} | ${p.paymentConfigVo?.paymentName || p.paymentType} | ${p.realName} | ${p.bankName || ''} ****${p.accountNo?.slice(-4) || ''}`);
    }

    // Create the ad
    const res = await client.createP2PAd({
      tokenId: 'USDT',
      currencyId: 'BOB',
      side,
      priceType: '0', // fixed price
      premium: '0',
      price,
      quantity,
      minAmount: '100',
      maxAmount: String(parseFloat(price) * parseFloat(quantity)),
      paymentIds: paymentItems.filter((p: any) => p.id > 0).map((p: any) => String(p.id)),
      remark: 'Pago instantaneo por QR o transferencia bancaria. Liberacion rapida.',
      paymentPeriod: '15',
    } as any);

    const r = res as any;
    const retCode = r.retCode ?? r.ret_code ?? -1;
    const retMsg = r.retMsg ?? r.ret_msg ?? 'unknown';

    if (retCode !== 0) {
      console.error(`\nFailed: ${retMsg} (code ${retCode})`);
      console.error('Full response:', JSON.stringify(r, null, 2));
    } else {
      const adId = r.result?.itemId ?? r.result?.id ?? 'unknown';
      console.log(`\nAd created successfully!`);
      console.log(`Ad ID: ${adId}`);
    }
  } catch (err) {
    console.error('Error:', err);
  }
}

main().catch(console.error);
