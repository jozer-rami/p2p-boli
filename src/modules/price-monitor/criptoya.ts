import { createModuleLogger } from '../../utils/logger.js';
import type { PlatformPrices } from '../../event-bus.js';
import type { CriptoYaPrices } from './types.js';

const log = createModuleLogger('criptoya-client');

const BASE_URL = 'https://criptoya.com/api';

export class CriptoYaClient {
  async getUsdtBobPrices(): Promise<PlatformPrices[]> {
    const url = `${BASE_URL}/usdt/bob`;
    log.debug({ url }, 'Fetching USDT/BOB prices');

    const res = await fetch(url);

    if (!res.ok) {
      throw new Error(`CriptoYa request failed: ${res.status}`);
    }

    const data = (await res.json()) as CriptoYaPrices;

    return Object.entries(data).map(([platform, values]) => ({
      platform,
      ask: values.ask,
      totalAsk: values.totalAsk,
      bid: values.bid,
      totalBid: values.totalBid,
      time: values.time,
    }));
  }

  async getFees(): Promise<unknown> {
    const url = `${BASE_URL}/fees`;
    log.debug({ url }, 'Fetching fees');

    const res = await fetch(url);

    if (!res.ok) {
      throw new Error(`CriptoYa request failed: ${res.status}`);
    }

    return res.json();
  }
}
