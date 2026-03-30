import { existsSync } from 'fs';

export interface AccountInput {
  name: string;
  bank: string;
  accountHint: string;
  qrCodePath: string | null;
  paymentMessage: string | null;
}

export interface BuildMessagesConfig {
  qrPreMessage: string;
}

export interface OrderParams {
  amount: number;
  price: number;
}

export type MessageStep =
  | { step: number; type: 'text'; content: string }
  | { step: number; type: 'image'; path: string; exists: boolean };

export interface BuildMessagesResult {
  messages: MessageStep[];
  warnings: string[];
}

const DEFAULT_ORDER_PARAMS: OrderParams = { amount: 100, price: 6.96 };

export function buildSellOrderMessages(input: {
  account: AccountInput;
  config: BuildMessagesConfig;
  orderParams?: OrderParams;
}): BuildMessagesResult {
  const { account, config, orderParams = DEFAULT_ORDER_PARAMS } = input;
  const messages: MessageStep[] = [];
  const warnings: string[] = [];
  let step = 1;

  // 1. Pre-QR greeting
  messages.push({ step: step++, type: 'text', content: config.qrPreMessage });

  // 2. QR image (if available)
  if (account.qrCodePath) {
    const fileExists = existsSync(account.qrCodePath);
    if (!fileExists) {
      warnings.push('QR file not found on disk');
    }
    messages.push({ step: step++, type: 'image', path: account.qrCodePath, exists: fileExists });
  }

  // 3. Payment instructions
  if (!account.paymentMessage) {
    warnings.push('No custom payment message — using generated fallback');
  }
  const paymentContent =
    account.paymentMessage ??
    `Please pay ${(orderParams.amount * orderParams.price).toFixed(2)} BOB to ${account.name} (${account.bank}) ****${account.accountHint}`;
  messages.push({ step: step++, type: 'text', content: paymentContent });

  return { messages, warnings };
}
