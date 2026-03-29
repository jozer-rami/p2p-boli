import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { writeFileSync, mkdirSync, unlinkSync, existsSync, readFileSync } from 'fs';
import { join, extname } from 'path';
import { bankAccounts } from '../../db/schema.js';
import type { DB } from '../../db/index.js';
import { createModuleLogger } from '../../utils/logger.js';

const log = createModuleLogger('api-banks');

const QR_DIR = './data/qr';

export interface BanksDeps {
  bankManager: {
    getAccountById: (id: number) => { id: number; name: string; bank: string; accountHint: string; qrCodePath: string | null } | undefined;
    getAccounts: () => Array<{
      id: number;
      name: string;
      bank: string;
      accountHint: string;
      balanceBob: number;
      dailyVolume: number;
      dailyLimit: number;
      monthlyVolume: number;
      status: string;
      priority: number;
      qrCodePath: string | null;
      paymentMessage: string | null;
    }>;
    loadAccounts: () => Promise<void>;
  };
  db: DB;
}

export function createBanksRouter(deps: BanksDeps): Router {
  const router = Router();

  // List all bank accounts
  router.get('/banks', (_req, res) => {
    const accounts = deps.bankManager.getAccounts();
    res.json(accounts);
  });

  // Create a new bank account
  router.post('/banks', async (req, res) => {
    const { name, bank, accountHint, balanceBob, dailyLimit, priority, paymentMessage } = req.body ?? {};

    if (!name || !bank || !accountHint || balanceBob == null || dailyLimit == null) {
      res.status(400).json({ error: 'Missing required fields: name, bank, accountHint, balanceBob, dailyLimit' });
      return;
    }

    try {
      const [inserted] = await deps.db
        .insert(bankAccounts)
        .values({
          name,
          bank,
          accountHint,
          balanceBob,
          dailyLimit,
          priority: priority ?? 0,
          paymentMessage: paymentMessage ?? null,
        })
        .returning({ id: bankAccounts.id });

      await deps.bankManager.loadAccounts();

      log.info({ id: inserted.id, name }, 'Bank account created');
      res.json({ success: true, id: inserted.id });
    } catch (err) {
      log.error({ err }, 'Failed to create bank account');
      res.status(500).json({ error: 'Failed to create bank account' });
    }
  });

  // Update bank account fields
  router.patch('/banks/:id', async (req, res) => {
    const accountId = parseInt(req.params.id, 10);
    const account = deps.bankManager.getAccountById(accountId);
    if (!account) {
      res.status(404).json({ error: 'Bank account not found' });
      return;
    }

    const allowedFields = ['name', 'bank', 'accountHint', 'balanceBob', 'dailyLimit', 'priority', 'paymentMessage', 'status'] as const;
    const updates: Record<string, any> = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    }

    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: 'No valid fields to update' });
      return;
    }

    try {
      await deps.db
        .update(bankAccounts)
        .set(updates)
        .where(eq(bankAccounts.id, accountId));

      await deps.bankManager.loadAccounts();

      log.info({ accountId, updates: Object.keys(updates) }, 'Bank account updated');
      res.json({ success: true });
    } catch (err) {
      log.error({ err, accountId }, 'Failed to update bank account');
      res.status(500).json({ error: 'Failed to update bank account' });
    }
  });

  // Serve QR code image for preview
  router.get('/banks/:id/qr/preview', (req, res) => {
    const accountId = parseInt(req.params.id, 10);
    const account = deps.bankManager.getAccountById(accountId);
    if (!account || !account.qrCodePath || !existsSync(account.qrCodePath)) {
      res.status(404).json({ error: 'QR code not found' });
      return;
    }
    const ext = extname(account.qrCodePath).toLowerCase();
    const mime = ext === '.png' ? 'image/png' : 'image/jpeg';
    res.setHeader('Content-Type', mime);
    res.send(readFileSync(account.qrCodePath));
  });

  // Upload QR code image for a bank account
  router.put('/banks/:id/qr', async (req, res) => {
    const accountId = parseInt(req.params.id, 10);
    const account = deps.bankManager.getAccountById(accountId);
    if (!account) {
      res.status(404).json({ error: 'Bank account not found' });
      return;
    }

    try {
      // Read raw body as buffer
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const buffer = Buffer.concat(chunks);

      if (buffer.length === 0) {
        res.status(400).json({ error: 'No image data' });
        return;
      }

      // Save file
      mkdirSync(QR_DIR, { recursive: true });
      const ext = (req.headers['content-type'] ?? '').includes('png') ? 'png' : 'jpg';
      const filename = `${account.bank}-${account.accountHint}.${ext}`;
      const filePath = join(QR_DIR, filename);
      writeFileSync(filePath, buffer);

      // Update DB
      await deps.db
        .update(bankAccounts)
        .set({ qrCodePath: filePath })
        .where(eq(bankAccounts.id, accountId));

      // Reload in-memory cache
      await deps.bankManager.loadAccounts();

      log.info({ accountId, filePath }, 'QR code uploaded');
      res.json({ success: true, qrCodePath: filePath });
    } catch (err) {
      log.error({ err, accountId }, 'Failed to upload QR code');
      res.status(500).json({ error: 'Failed to upload QR code' });
    }
  });

  // Delete QR code for a bank account
  router.delete('/banks/:id/qr', async (req, res) => {
    const accountId = parseInt(req.params.id, 10);
    const account = deps.bankManager.getAccountById(accountId);
    if (!account) {
      res.status(404).json({ error: 'Bank account not found' });
      return;
    }

    try {
      // Delete file from disk if it exists
      if (account.qrCodePath && existsSync(account.qrCodePath)) {
        unlinkSync(account.qrCodePath);
      }

      // Clear in DB
      await deps.db
        .update(bankAccounts)
        .set({ qrCodePath: null })
        .where(eq(bankAccounts.id, accountId));

      // Reload in-memory cache
      await deps.bankManager.loadAccounts();

      log.info({ accountId }, 'QR code deleted');
      res.json({ success: true });
    } catch (err) {
      log.error({ err, accountId }, 'Failed to delete QR code');
      res.status(500).json({ error: 'Failed to delete QR code' });
    }
  });

  return router;
}
