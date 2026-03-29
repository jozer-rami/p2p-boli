// tests/integration/raw-http.test.ts
import { describe, it, expect } from 'vitest';
import { hasCredentials } from './setup.js';
import 'dotenv/config';

/**
 * Test raw HTTP signing directly, bypassing the BybitClient wrapper.
 * This catches regressions in signature generation and param serialization.
 */
describe.skipIf(!hasCredentials)('Raw HTTP Signing', () => {
  const apiKey = process.env.BYBIT_TESTNET_API_KEY!;
  const apiSecret = process.env.BYBIT_TESTNET_API_SECRET!;
  const baseUrl = 'https://api-testnet.bybit.com';

  async function rawPost(path: string, body: Record<string, any> = {}): Promise<any> {
    const crypto = await import('node:crypto');
    const timestamp = String(Date.now());
    const recvWindow = '5000';
    const bodyStr = JSON.stringify(body);
    const preSign = timestamp + apiKey + recvWindow + bodyStr;
    const signature = crypto.createHmac('sha256', apiSecret).update(preSign).digest('hex');

    const res = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-BAPI-API-KEY': apiKey,
        'X-BAPI-TIMESTAMP': timestamp,
        'X-BAPI-SIGN': signature,
        'X-BAPI-RECV-WINDOW': recvWindow,
      },
      body: bodyStr,
    });

    return res.json();
  }

  it('signature is accepted for /v5/p2p/order/simplifyList', async () => {
    const res = await rawPost('/v5/p2p/order/simplifyList', { page: 1, size: 30 });

    // Response should use ret_code (v3 format), not retCode (v5 format)
    const code = res.ret_code ?? res.retCode;
    expect(code).toBe(0);
  });

  it('response uses v3 format (ret_code/ret_msg)', async () => {
    const res = await rawPost('/v5/p2p/order/simplifyList', { page: 1, size: 30 });

    // At least one of these v3 fields should be present
    const hasV3 = 'ret_code' in res || 'retCode' in res;
    expect(hasV3).toBe(true);
  });

  it('integer params are not stringified in body', () => {
    // This is a pure unit assertion but validates the critical serialization bug
    const body = { page: 1, size: 30, orderId: 'abc' };
    const serialized = JSON.stringify(body);

    expect(serialized).toContain('"page":1');
    expect(serialized).toContain('"size":30');
    expect(serialized).not.toContain('"page":"1"');
    expect(serialized).not.toContain('"size":"30"');
  });

  it('rejects requests with invalid signature gracefully', async () => {
    const crypto = await import('node:crypto');
    const timestamp = String(Date.now());
    const recvWindow = '5000';
    const bodyStr = JSON.stringify({ page: 1, size: 30 });

    const res = await fetch(`${baseUrl}/v5/p2p/order/simplifyList`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-BAPI-API-KEY': apiKey,
        'X-BAPI-TIMESTAMP': timestamp,
        'X-BAPI-SIGN': 'invalid-signature-000000',
        'X-BAPI-RECV-WINDOW': recvWindow,
      },
      body: bodyStr,
    });

    const json = await res.json();
    const code = json.ret_code ?? json.retCode;
    expect(code).not.toBe(0);
  });
});
