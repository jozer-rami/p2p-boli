import { Router } from 'express';
import { buildSellOrderMessages } from '../../modules/qr-flow/build-messages.js';

export interface SimulateDeps {
  bankManager: {
    getAccountById: (id: number) => {
      id: number;
      name: string;
      bank: string;
      accountHint: string;
      status: string;
      qrCodePath: string | null;
      paymentMessage: string | null;
    } | undefined;
  };
  qrPreMessage: string;
}

export function createSimulateRouter(deps: SimulateDeps): Router {
  const router = Router();

  router.get('/simulate/sell-order', (req, res) => {
    const bankAccountId = parseInt(req.query.bankAccountId as string, 10);
    if (!bankAccountId || isNaN(bankAccountId)) {
      res.status(400).json({ error: 'Missing required query param: bankAccountId' });
      return;
    }

    const account = deps.bankManager.getAccountById(bankAccountId);
    if (!account) {
      res.status(404).json({ error: 'Bank account not found' });
      return;
    }

    const amount = parseFloat(req.query.amount as string) || 100;
    const price = parseFloat(req.query.price as string) || 6.96;

    const result = buildSellOrderMessages({
      account,
      config: { qrPreMessage: deps.qrPreMessage },
      orderParams: { amount, price },
    });

    // Add account-level warnings
    if (account.status !== 'active') {
      result.warnings.push('Account is inactive');
    }

    res.json({
      bankAccount: {
        name: account.name,
        bank: account.bank,
        accountHint: account.accountHint,
      },
      messages: result.messages,
      warnings: result.warnings,
    });
  });

  return router;
}
