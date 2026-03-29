// tests/integration/setup.ts
import 'dotenv/config';
import { BybitClient } from '../../src/bybit/client.js';

const apiKey = process.env.BYBIT_API_KEY;
const apiSecret = process.env.BYBIT_API_SECRET;

export const hasCredentials = !!(apiKey && apiSecret);

export function createTestClient(): BybitClient {
  if (!hasCredentials) {
    throw new Error('BYBIT_API_KEY and BYBIT_API_SECRET must be set in .env');
  }
  return new BybitClient(apiKey!, apiSecret!, true); // testnet = true
}
