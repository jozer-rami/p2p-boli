import type { Side } from '../../event-bus.js';
import type { EmergencyTrigger } from '../emergency-stop/types.js';

// ---------------------------------------------------------------------------
// Data types for each alert
// ---------------------------------------------------------------------------

export interface OrderNewData {
  orderId: string;
  side: Side;
  amount: number;
  price: number;
  counterparty: string;
}

export interface PaymentClaimedData {
  orderId: string;
  amount: number;
  bankAccount: string;
}

export interface OrderReleasedData {
  orderId: string;
  side: Side;
  amount: number;
  price: number;
  totalBob: number;
  profit: number;
}

export interface OrderCancelledData {
  orderId: string;
  reason: string;
}

export interface AdPausedData {
  side: Side;
  reason: string;
}

export interface LowBalanceData {
  accountId: number;
  balance: number;
  threshold: number;
}

export interface EmergencyData {
  trigger: EmergencyTrigger;
  reason: string;
  exposure: { usdt: number; bob: number };
  marketState: { ask: number; bid: number };
  pendingOrders: number;
}

export interface BotStartedData {
  minSpread: number;
  maxSpread: number;
  tradeAmountUsdt: number;
  activeSides: string;
  testnet: boolean;
}

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

export function formatOrderNew(data: OrderNewData): string {
  const sideLabel = data.side.toUpperCase();
  return [
    `New ${sideLabel} Order #${data.orderId}`,
    `Amount: ${data.amount} USDT @ ${data.price} BOB`,
    `Counterparty: ${data.counterparty}`,
  ].join('\n');
}

export function formatPaymentClaimed(data: PaymentClaimedData): string {
  return [
    `Payment Claimed — Order #${data.orderId}`,
    `Amount: ${data.amount} USDT`,
    `Bank Account: ${data.bankAccount}`,
  ].join('\n');
}

export function formatOrderReleased(data: OrderReleasedData): string {
  const sideLabel = data.side.toUpperCase();
  const bobFlow = data.side === 'sell' ? `+${data.totalBob.toFixed(2)}` : `-${data.totalBob.toFixed(2)}`;
  const usdtFlow = data.side === 'sell' ? `-${data.amount}` : `+${data.amount}`;
  const lines = [
    `Order #${data.orderId} Completed (${sideLabel})`,
    `${usdtFlow} USDT @ ${data.price} BOB`,
    `${bobFlow} BOB`,
  ];
  if (data.profit > 0) {
    lines.push(`Spread profit: ${data.profit.toFixed(2)} BOB`);
  }
  return lines.join('\n');
}

export function formatOrderCancelled(data: OrderCancelledData): string {
  return [
    `Order #${data.orderId} Cancelled`,
    `Reason: ${data.reason}`,
  ].join('\n');
}

export function formatAdPaused(data: AdPausedData): string {
  return `Ad paused (${data.side}): ${data.reason}`;
}

export function formatLowBalance(data: LowBalanceData): string {
  return [
    `Low balance on account: ${data.balance.toFixed(2)} BOB`,
    `Account ID: ${data.accountId}`,
    `Threshold: ${data.threshold} BOB`,
  ].join('\n');
}

export function formatEmergency(data: EmergencyData): string {
  return [
    `EMERGENCY STOP`,
    `Trigger: ${data.trigger}`,
    `Reason: ${data.reason}`,
    ``,
    `Exposure:`,
    `  USDT: ${data.exposure.usdt.toFixed(2)}`,
    `  BOB:  ${data.exposure.bob.toFixed(2)}`,
    ``,
    `Market State:`,
    `  Ask: ${data.marketState.ask}`,
    `  Bid: ${data.marketState.bid}`,
    ``,
    `Pending Orders: ${data.pendingOrders}`,
  ].join('\n');
}

export function formatBotStarted(data: BotStartedData): string {
  return [
    `Bot Started`,
    `Min Spread: ${(data.minSpread * 100).toFixed(2)}%`,
    `Max Spread: ${(data.maxSpread * 100).toFixed(2)}%`,
    `Trade Amount: ${data.tradeAmountUsdt} USDT`,
    `Active Sides: ${data.activeSides}`,
    `Network: ${data.testnet ? 'testnet' : 'mainnet'}`,
  ].join('\n');
}

export function formatBotStopping(pendingOrders: number): string {
  return [
    `Bot Stopping`,
    `Pending Orders: ${pendingOrders}`,
  ].join('\n');
}
