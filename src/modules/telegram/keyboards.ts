import { InlineKeyboard } from 'grammy';

export function confirmReleaseKeyboard(orderId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text('Confirm & Release', `release:${orderId}`)
    .text('Dispute', `dispute:${orderId}`);
}

export function markAsPaidKeyboard(orderId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text('Mark as Paid', `paid:${orderId}`);
}
