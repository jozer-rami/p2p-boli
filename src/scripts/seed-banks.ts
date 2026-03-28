import 'dotenv/config';
import { existsSync, mkdirSync } from 'fs';
import { createDB, schema } from '../db/index.js';
import { eq } from 'drizzle-orm';
import { createModuleLogger } from '../utils/logger.js';

const log = createModuleLogger('seed-banks');

// ---------------------------------------------------------------------------
// Edit this array with your bank accounts
// ---------------------------------------------------------------------------

const BANK_ACCOUNTS = [
  {
    name: 'Banco Union Personal',
    bank: 'banco-union',
    accountHint: '4521',
    balanceBob: 15000,
    dailyLimit: 50000,
    priority: 10,
    qrCodePath: './data/qr/banco-union-4521.png',
    paymentMessage: 'Escanea el QR para pagar. Banco Union cuenta ****4521',
  },
  // Add more accounts here
];

// ---------------------------------------------------------------------------
// Seed logic
// ---------------------------------------------------------------------------

const dbPath = process.env.DB_PATH || './data/bot.db';

// Ensure data directories exist
mkdirSync('./data/qr', { recursive: true });
mkdirSync('./data/tmp', { recursive: true });

const db = createDB(dbPath);

for (const account of BANK_ACCOUNTS) {
  // Warn if QR code file is missing
  if (account.qrCodePath && !existsSync(account.qrCodePath)) {
    log.warn({ path: account.qrCodePath, name: account.name }, 'QR code file not found — add it before going live');
  }

  // Upsert: insert or update by name
  const existing = db
    .select()
    .from(schema.bankAccounts)
    .where(eq(schema.bankAccounts.name, account.name))
    .get();

  if (existing) {
    db.update(schema.bankAccounts)
      .set({
        bank: account.bank,
        accountHint: account.accountHint,
        balanceBob: account.balanceBob,
        dailyLimit: account.dailyLimit,
        priority: account.priority,
        qrCodePath: account.qrCodePath,
        paymentMessage: account.paymentMessage,
      })
      .where(eq(schema.bankAccounts.name, account.name))
      .run();
    log.info({ name: account.name }, 'Updated existing bank account');
  } else {
    db.insert(schema.bankAccounts)
      .values({
        name: account.name,
        bank: account.bank,
        accountHint: account.accountHint,
        balanceBob: account.balanceBob,
        dailyLimit: account.dailyLimit,
        priority: account.priority,
        qrCodePath: account.qrCodePath,
        paymentMessage: account.paymentMessage,
      })
      .run();
    log.info({ name: account.name }, 'Inserted new bank account');
  }
}

// Print summary
const allAccounts = db.select().from(schema.bankAccounts).all();
log.info({ count: allAccounts.length }, 'Bank accounts in database:');
for (const acct of allAccounts) {
  const qrStatus = acct.qrCodePath && existsSync(acct.qrCodePath) ? 'QR found' : 'no QR';
  log.info({ id: acct.id, name: acct.name, bank: acct.bank, balance: acct.balanceBob, qrStatus }, `  ${acct.name}`);
}
