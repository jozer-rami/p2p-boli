import { describe, it, expect, vi } from 'vitest';
import { buildSellOrderMessages } from '../../../src/modules/qr-flow/build-messages.js';

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return { ...actual, existsSync: vi.fn(() => true) };
});

import { existsSync } from 'fs';

const baseAccount = {
  name: 'Banco Union Personal',
  bank: 'banco-union',
  accountHint: '4521',
  qrCodePath: './data/qr/banco-union-4521.png',
  paymentMessage: 'Pagar a Banco Union ****4521',
};

const baseConfig = {
  qrPreMessage: 'Hola! En breve te enviaremos el codigo QR para realizar el pago.',
};

describe('buildSellOrderMessages', () => {
  it('returns 3 steps when account has QR and payment message', () => {
    const result = buildSellOrderMessages({
      account: baseAccount,
      config: baseConfig,
      orderParams: { amount: 100, price: 6.96 },
    });

    expect(result.messages).toHaveLength(3);
    expect(result.messages[0]).toEqual({ step: 1, type: 'text', content: baseConfig.qrPreMessage });
    expect(result.messages[1]).toEqual({ step: 2, type: 'image', path: './data/qr/banco-union-4521.png', exists: true });
    expect(result.messages[2]).toEqual({ step: 3, type: 'text', content: 'Pagar a Banco Union ****4521' });
  });

  it('skips image step when qrCodePath is null', () => {
    const result = buildSellOrderMessages({
      account: { ...baseAccount, qrCodePath: null },
      config: baseConfig,
      orderParams: { amount: 100, price: 6.96 },
    });

    expect(result.messages).toHaveLength(2);
    expect(result.messages[0]).toEqual({ step: 1, type: 'text', content: baseConfig.qrPreMessage });
    expect(result.messages[1]).toEqual({ step: 2, type: 'text', content: 'Pagar a Banco Union ****4521' });
  });

  it('uses fallback payment message when paymentMessage is null', () => {
    const result = buildSellOrderMessages({
      account: { ...baseAccount, paymentMessage: null },
      config: baseConfig,
      orderParams: { amount: 100, price: 6.96 },
    });

    const lastMsg = result.messages[result.messages.length - 1];
    expect(lastMsg.type).toBe('text');
    expect((lastMsg as any).content).toBe(
      'Please pay 696.00 BOB to Banco Union Personal (banco-union) ****4521'
    );
  });

  it('uses default orderParams when omitted', () => {
    const result = buildSellOrderMessages({
      account: { ...baseAccount, paymentMessage: null },
      config: baseConfig,
    });

    const lastMsg = result.messages[result.messages.length - 1];
    expect((lastMsg as any).content).toContain('696.00 BOB');
  });

  it('marks exists: false when QR file is missing from disk', () => {
    vi.mocked(existsSync).mockReturnValueOnce(false);

    const result = buildSellOrderMessages({
      account: baseAccount,
      config: baseConfig,
    });

    const imageStep = result.messages.find((m) => m.type === 'image');
    expect(imageStep).toBeDefined();
    expect((imageStep as any).exists).toBe(false);
  });

  it('adds warning when QR file is missing from disk', () => {
    vi.mocked(existsSync).mockReturnValueOnce(false);

    const result = buildSellOrderMessages({
      account: baseAccount,
      config: baseConfig,
    });

    expect(result.warnings).toContain('QR file not found on disk');
  });

  it('adds warning when paymentMessage is null', () => {
    const result = buildSellOrderMessages({
      account: { ...baseAccount, paymentMessage: null },
      config: baseConfig,
    });

    expect(result.warnings).toContain('No custom payment message — using generated fallback');
  });
});
