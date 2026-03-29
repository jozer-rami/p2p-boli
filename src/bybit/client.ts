import { RestClientV5 } from 'bybit-api';
import { withRetry } from '../utils/retry.js';
import { createModuleLogger } from '../utils/logger.js';
import type { Side } from '../event-bus.js';
import type { BybitAdParams, BybitAd, BybitOrder, BybitBalance } from './types.js';

const log = createModuleLogger('bybit-client');

const RETRY_OPTIONS = {
  maxRetries: 3,
  baseDelayMs: 1_000,
  shouldRetry: (err: Error) => {
    const msg = err.message;
    return !msg.includes('401') && !msg.includes('403');
  },
};

/** P2P endpoints return ret_code/ret_msg (v3), not retCode/retMsg (v5) */
function getRetCode(res: any): number {
  return res.retCode ?? res.ret_code ?? -1;
}

function getRetMsg(res: any): string {
  return res.retMsg ?? res.ret_msg ?? 'unknown';
}

function getResult(res: any): any {
  return res.result ?? {};
}

export class BybitClient {
  private readonly client: RestClientV5;
  private readonly apiKey: string;
  private readonly apiSecret: string;
  private readonly baseUrl: string;

  constructor(apiKey: string, apiSecret: string, testnet = false) {
    this.client = new RestClientV5({ key: apiKey, secret: apiSecret, testnet });
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.baseUrl = testnet ? 'https://api-testnet.bybit.com' : 'https://api.bybit.com';
  }

  /** Raw signed POST for P2P endpoints where the SDK has pagination bugs */
  private async rawPost(path: string, body: Record<string, any> = {}): Promise<any> {
    const crypto = await import('node:crypto');
    const timestamp = String(Date.now());
    const recvWindow = '5000';
    const bodyStr = JSON.stringify(body);
    const preSign = timestamp + this.apiKey + recvWindow + bodyStr;
    const signature = crypto.createHmac('sha256', this.apiSecret).update(preSign).digest('hex');

    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-BAPI-API-KEY': this.apiKey,
        'X-BAPI-TIMESTAMP': timestamp,
        'X-BAPI-SIGN': signature,
        'X-BAPI-RECV-WINDOW': recvWindow,
      },
      body: bodyStr,
    });

    return res.json();
  }

  /**
   * Get public online ads for a given side/currency pair.
   * side: 'buy' maps to '1' (buy ads), 'sell' maps to '0' (sell ads)
   */
  async getOnlineAds(side: Side, currencyId: string, fiatId: string): Promise<BybitAd[]> {
    return withRetry(async () => {
      const res = await this.client.getP2POnlineAds({
        tokenId: currencyId,
        currencyId: fiatId,
        side: side === 'buy' ? '1' : '0',
      });

      if (getRetCode(res) !== 0) {
        throw new Error(`getOnlineAds failed: ${getRetMsg(res)} (code ${getRetCode(res)})`);
      }

      const items = getResult(res)?.items ?? [];
      return items.map((ad: any) => ({
        id: ad.id,
        side: ad.side === '1' ? 'buy' : 'sell' as Side,
        price: parseFloat(ad.price),
        amount: parseFloat(ad.lastQuantity),
        status: String(ad.status),
      }));
    }, RETRY_OPTIONS);
  }

  /**
   * Get your own personal P2P ads.
   */
  async getPersonalAds(): Promise<BybitAd[]> {
    return withRetry(async () => {
      const res = await this.client.getP2PPersonalAds({} as any);

      if (getRetCode(res) !== 0) {
        throw new Error(`getPersonalAds failed: ${getRetMsg(res)} (code ${getRetCode(res)})`);
      }

      const items = getResult(res)?.items ?? [];
      return items.map((ad: any) => ({
        id: ad.id,
        side: ad.side === 1 || ad.side === '1' ? 'sell' : 'buy' as Side,  // 1=sell, 0=buy (maker perspective)
        price: parseFloat(ad.price),
        amount: parseFloat(ad.lastQuantity),
        status: String(ad.status),
      }));
    }, RETRY_OPTIONS);
  }

  /**
   * Create a new P2P advertisement.
   */
  async createAd(params: BybitAdParams): Promise<string> {
    return withRetry(async () => {
      const maxAmountBob = String(Math.round(params.amount * params.price * 100) / 100);
      const minAmountBob = String(Math.min(100, Math.round(params.amount * params.price * 100) / 100));
      const res = await this.client.createP2PAd({
        tokenId: params.currencyId,
        currencyId: params.fiatCurrencyId,
        side: params.side === 'sell' ? '1' : '0',  // 1=sell, 0=buy (maker perspective)
        priceType: '0',
        premium: '0',
        price: String(params.price),
        minAmount: minAmountBob,
        maxAmount: maxAmountBob,
        remark: params.remark ?? '',
        tradingPreferenceSet: {},
        paymentIds: params.paymentMethodIds,
        quantity: String(params.amount),
        paymentPeriod: '15',
      } as any);

      if (getRetCode(res) !== 0) {
        throw new Error(`createAd failed: ${getRetMsg(res)} (code ${getRetCode(res)})`);
      }

      const adId = getResult(res)?.itemId;
      if (!adId) {
        throw new Error('createAd: no itemId in response');
      }

      log.info({ adId, side: params.side, price: params.price }, 'P2P ad created');
      return adId;
    }, RETRY_OPTIONS);
  }

  /**
   * Update (reprice) an existing P2P ad.
   */
  async updateAd(adId: string, price: number, amount: number, paymentIds?: string[]): Promise<void> {
    return withRetry(async () => {
      const maxAmountBob = String(Math.round(amount * price * 100) / 100);
      const minAmountBob = String(Math.min(100, Math.round(amount * price * 100) / 100));
      const res = await this.client.updateP2PAd({
        id: adId,
        priceType: '0',
        premium: '0',
        price: String(price),
        minAmount: minAmountBob,
        maxAmount: maxAmountBob,
        remark: 'Pago instantaneo por QR o transferencia bancaria. Liberacion rapida.',
        tradingPreferenceSet: {},
        paymentIds: paymentIds ?? [],
        actionType: 'MODIFY',
        quantity: String(amount),
        paymentPeriod: '15',
      } as any);

      if (getRetCode(res) !== 0) {
        throw new Error(`updateAd failed: ${getRetMsg(res)} (code ${getRetCode(res)})`);
      }

      log.info({ adId, price, amount }, 'P2P ad updated');
    }, RETRY_OPTIONS);
  }

  /**
   * Cancel (remove) a P2P advertisement.
   */
  async cancelAd(adId: string): Promise<void> {
    return withRetry(async () => {
      const res = await this.client.cancelP2PAd({ id: adId } as any);

      if (getRetCode(res) !== 0) {
        throw new Error(`cancelAd failed: ${getRetMsg(res)} (code ${getRetCode(res)})`);
      }

      log.info({ adId }, 'P2P ad cancelled');
    }, RETRY_OPTIONS);
  }

  /**
   * Get all pending P2P orders.
   * NOTE: /pending/simplifyList is broken (returns count but no items).
   * We use /simplifyList (all orders) with pagination and filter client-side.
   */
  async getPendingOrders(): Promise<BybitOrder[]> {
    const TERMINAL = [40, 50, '40', '50'];
    return withRetry(async () => {
      const res = await this.rawPost('/v5/p2p/order/simplifyList', { page: 1, size: 30 });
      if (getRetCode(res) !== 0) {
        throw new Error(`getPendingOrders failed: ${getRetMsg(res)} (code ${getRetCode(res)})`);
      }

      const items = getResult(res)?.items ?? [];
      return items
        .filter((order: any) => !TERMINAL.includes(order.status))
        .map((order: any) => ({
          id: order.id,
          side: order.side === 1 || order.side === '1' ? 'sell' : 'buy' as Side,
          amount: parseFloat(order.notifyTokenQuantity || order.amount),
          price: parseFloat(order.price),
          totalBob: parseFloat(order.amount),
          status: String(order.status),
          counterpartyId: order.targetUserId,
          counterpartyName: order.targetNickName,
          createdAt: parseInt(order.createDate) || Date.now(),
        }));
    }, RETRY_OPTIONS);
  }

  /**
   * Get the details of a single P2P order.
   */
  async getOrderDetail(orderId: string): Promise<BybitOrder> {
    return withRetry(async () => {
      const res = await this.client.getP2POrderDetail({ orderId } as any);

      if (getRetCode(res) !== 0) {
        throw new Error(`getOrderDetail failed: ${getRetMsg(res)} (code ${getRetCode(res)})`);
      }

      const order = getResult(res);
      if (!order) {
        throw new Error(`getOrderDetail: no result for orderId ${orderId}`);
      }

      return {
        id: order.id,
        side: order.side === 1 ? 'buy' : 'sell' as Side,
        amount: parseFloat(order.amount),
        price: parseFloat(order.price),
        totalBob: parseFloat(order.amount) * parseFloat(order.price),
        status: String(order.status),
        counterpartyId: order.targetUserId,
        counterpartyName: order.targetNickName,
        createdAt: new Date(order.createDate).getTime(),
      };
    }, RETRY_OPTIONS);
  }

  /**
   * Mark a P2P order as paid (payment sent).
   */
  async markOrderAsPaid(orderId: string): Promise<void> {
    return withRetry(async () => {
      const res = await this.client.markP2POrderAsPaid({
        orderId,
        paymentType: '0',
        paymentId: '',
      } as any);

      if (getRetCode(res) !== 0) {
        throw new Error(`markOrderAsPaid failed: ${getRetMsg(res)} (code ${getRetCode(res)})`);
      }

      log.info({ orderId }, 'P2P order marked as paid');
    }, RETRY_OPTIONS);
  }

  /**
   * Release crypto for a completed P2P order.
   * NO retry — releasing twice is dangerous.
   */
  async releaseOrder(orderId: string): Promise<void> {
    const res = await this.client.releaseP2POrder({ orderId } as any);

    if (getRetCode(res) !== 0) {
      throw new Error(`releaseOrder failed: ${getRetMsg(res)} (code ${getRetCode(res)})`);
    }

    log.info({ orderId }, 'P2P order released');
  }

  /**
   * Get P2P account balance for the given coin.
   */
  async getBalance(coin: string): Promise<BybitBalance> {
    return withRetry(async () => {
      const res = await this.client.getP2PAccountCoinsBalance({
        accountType: 'FUND',
        coin,
      });

      if (getRetCode(res) !== 0) {
        throw new Error(`getBalance failed: ${getRetMsg(res)} (code ${getRetCode(res)})`);
      }

      const balances = getResult(res)?.balance ?? [];
      const entry = balances.find((b: any) => b.coin === coin);

      if (!entry) {
        return { coin, available: 0, frozen: 0 };
      }

      return {
        coin: entry.coin,
        available: parseFloat(entry.transferBalance),
        frozen: parseFloat(entry.walletBalance) - parseFloat(entry.transferBalance),
      };
    }, RETRY_OPTIONS);
  }

  /**
   * Get user's configured payment methods (bank accounts).
   * Returns only real payment methods (id > 0), excludes "Balance" payment.
   */
  async getPaymentMethods(): Promise<Array<{ id: string; bankName: string; accountNo: string; realName: string }>> {
    return withRetry(async () => {
      const res = await (this.client as any).getP2PUserPayments({});

      if (getRetCode(res) !== 0) {
        throw new Error(`getPaymentMethods failed: ${getRetMsg(res)} (code ${getRetCode(res)})`);
      }

      const items = getResult(res) ?? [];
      return items
        .filter((p: any) => p.id > 0)
        .map((p: any) => ({
          id: String(p.id),
          bankName: p.bankName || p.paymentConfigVo?.paymentName || '',
          accountNo: p.accountNo || '',
          realName: p.realName || '',
        }));
    }, RETRY_OPTIONS);
  }

  // ─── Chat Methods ───

  /**
   * Send a text message in a P2P order chat.
   */
  async sendOrderMessage(orderId: string, message: string): Promise<void> {
    return withRetry(async () => {
      const res = await this.client.sendP2POrderMessage({
        orderId,
        contentType: '1', // 1 = text
        content: message,
      } as any);

      if (getRetCode(res) !== 0) {
        throw new Error(`sendOrderMessage failed: ${getRetMsg(res)} (code ${getRetCode(res)})`);
      }

      log.info({ orderId }, 'chat message sent');
    }, RETRY_OPTIONS);
  }

  /**
   * Upload a file (image/QR code) to a P2P order chat.
   * Returns the uploaded file URL.
   */
  async uploadChatFile(orderId: string, filePath: string): Promise<string> {
    return withRetry(async () => {
      const fs = await import('fs');
      const path = await import('path');

      if (!fs.existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`);
      }

      const res = await this.client.uploadP2PChatFile({
        orderId,
        file: fs.createReadStream(filePath),
      } as any);

      if (getRetCode(res) !== 0) {
        throw new Error(`uploadChatFile failed: ${getRetMsg(res)} (code ${getRetCode(res)})`);
      }

      const url = getResult(res)?.url || getResult(res)?.fileUrl || '';
      log.info({ orderId, filePath, url }, 'chat file uploaded');
      return url;
    }, RETRY_OPTIONS);
  }

  /**
   * Send an image message in a P2P order chat (upload + send as image content).
   */
  async sendOrderImage(orderId: string, filePath: string): Promise<void> {
    const url = await this.uploadChatFile(orderId, filePath);
    if (url) {
      await this.sendOrderMessage(orderId, url);
    }
  }

  /**
   * Get chat messages for a P2P order.
   */
  async getOrderMessages(orderId: string): Promise<Array<{ content: string; contentType: string; sendTime: number; fromUserId: string; roleType: string; nickName: string }>> {
    return withRetry(async () => {
      const res = await this.rawPost('/v5/p2p/order/message/listpage', {
        orderId,
        page: 1,
        size: 30,
      });

      if (getRetCode(res) !== 0) {
        throw new Error(`getOrderMessages failed: ${getRetMsg(res)} (code ${getRetCode(res)})`);
      }

      // Response nests messages in result.result (array)
      const raw = getResult(res);
      const items = raw?.result ?? raw?.items ?? raw?.messages ?? [];
      return items.map((msg: any) => ({
        content: msg.content || msg.message || '',
        contentType: String(msg.contentType || 'str'),  // 'str' = text, 'pic' = image
        sendTime: parseInt(msg.createDate || msg.sendTime || '0'),
        fromUserId: msg.userId || msg.fromUid || '',
        roleType: msg.roleType || 'user',  // 'sys' = system, 'user' = user
        nickName: msg.nickName || '',
      }));
    }, RETRY_OPTIONS);
  }
}
