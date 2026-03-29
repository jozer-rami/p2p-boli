import { useState, useRef, useCallback } from 'react';
import { useBanks, useUploadQr, useDeleteQr, useUpdateBank, useCreateBank } from '../hooks/useApi';

function QrDropZone({ onFile }: { onFile: (f: File) => void }) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) onFile(file);
  }, [onFile]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onFile(file);
  }, [onFile]);

  return (
    <button
      type="button"
      className={`w-full py-6 border-2 border-dashed rounded transition-colors cursor-pointer text-center ${
        dragging
          ? 'border-green-500 bg-green-500/5'
          : 'border-surface-muted/40 hover:border-text-faint'
      }`}
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileChange}
      />
      <span className="text-text-faint text-sm">
        {dragging ? 'Drop image' : 'Drop QR image here or click to browse'}
      </span>
    </button>
  );
}

function QrPreview({ bankId, qrPath }: { bankId: number; qrPath: string }) {
  const deleteQr = useDeleteQr();

  return (
    <div className="flex items-start gap-4">
      <div className="bg-white rounded p-2 shrink-0">
        <img
          src={`/api/banks/${bankId}/qr/preview`}
          alt="QR code"
          className="w-28 h-28 object-contain"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = 'none';
          }}
        />
      </div>
      <div className="flex flex-col gap-2 min-w-0">
        <span className="text-xs text-text-faint truncate" title={qrPath}>
          {qrPath.split('/').pop()}
        </span>
        <button
          type="button"
          className="text-xs text-red-400 hover:text-red-300 transition-colors text-left w-fit"
          onClick={() => deleteQr.mutate(bankId)}
          disabled={deleteQr.isPending}
        >
          {deleteQr.isPending ? 'Removing...' : 'Remove QR'}
        </button>
      </div>
    </div>
  );
}

const fieldClass = 'bg-surface-subtle border border-surface-muted/40 rounded px-2 py-1 text-sm text-text w-full focus:outline-none focus:border-text-faint';
const labelClass = 'text-xs text-text-faint';

type BankData = {
  id: number;
  name: string;
  bank: string;
  accountHint: string;
  balanceBob: number;
  dailyLimit: number;
  priority: number;
  status: string;
  qrCodePath: string | null;
  paymentMessage: string | null;
};

function BankEditForm({ bank, onSave, saving }: {
  bank: BankData;
  onSave: (fields: Record<string, any>) => void;
  saving: boolean;
}) {
  const [name, setName] = useState(bank.name);
  const [bankSlug, setBankSlug] = useState(bank.bank);
  const [hint, setHint] = useState(bank.accountHint);
  const [balance, setBalance] = useState(bank.balanceBob.toString());
  const [limit, setLimit] = useState(bank.dailyLimit.toString());
  const [priority, setPriority] = useState(bank.priority.toString());
  const [message, setMessage] = useState(bank.paymentMessage ?? '');

  const dirty =
    name !== bank.name ||
    bankSlug !== bank.bank ||
    hint !== bank.accountHint ||
    balance !== bank.balanceBob.toString() ||
    limit !== bank.dailyLimit.toString() ||
    priority !== bank.priority.toString() ||
    message !== (bank.paymentMessage ?? '');

  const handleSave = () => {
    const fields: Record<string, any> = {};
    if (name !== bank.name) fields.name = name;
    if (bankSlug !== bank.bank) fields.bank = bankSlug;
    if (hint !== bank.accountHint) fields.accountHint = hint;
    if (balance !== bank.balanceBob.toString()) fields.balanceBob = parseFloat(balance);
    if (limit !== bank.dailyLimit.toString()) fields.dailyLimit = parseFloat(limit);
    if (priority !== bank.priority.toString()) fields.priority = parseInt(priority, 10);
    if (message !== (bank.paymentMessage ?? '')) fields.paymentMessage = message || null;
    onSave(fields);
  };

  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-2 mt-3">
      <div>
        <div className={labelClass}>Name</div>
        <input className={fieldClass} value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div>
        <div className={labelClass}>Bank slug</div>
        <input className={fieldClass} value={bankSlug} onChange={(e) => setBankSlug(e.target.value)} />
      </div>
      <div>
        <div className={labelClass}>Account hint</div>
        <input className={fieldClass} value={hint} onChange={(e) => setHint(e.target.value)} />
      </div>
      <div>
        <div className={labelClass}>Priority</div>
        <input className={fieldClass} type="number" value={priority} onChange={(e) => setPriority(e.target.value)} />
      </div>
      <div>
        <div className={labelClass}>Balance BOB</div>
        <input className={fieldClass} type="number" step="0.01" value={balance} onChange={(e) => setBalance(e.target.value)} />
      </div>
      <div>
        <div className={labelClass}>Daily limit</div>
        <input className={fieldClass} type="number" value={limit} onChange={(e) => setLimit(e.target.value)} />
      </div>
      <div className="col-span-2">
        <div className={labelClass}>Payment message</div>
        <input className={fieldClass} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Optional" />
      </div>
      <div className="col-span-2 flex justify-end pt-1">
        <button
          type="button"
          className="text-xs px-3 py-1 rounded bg-green-600 text-white hover:bg-green-500 transition-colors disabled:opacity-40"
          disabled={!dirty || saving}
          onClick={handleSave}
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>
    </div>
  );
}

function BankRow({ bank }: { bank: BankData }) {
  const [expanded, setExpanded] = useState(false);
  const uploadQr = useUploadQr();
  const updateBank = useUpdateBank();

  const hasQr = !!bank.qrCodePath;
  const isInactive = bank.status === 'inactive';

  return (
    <div className={`border-b border-surface-muted/20 last:border-0 ${isInactive ? 'opacity-50' : ''}`}>
      <button
        type="button"
        className="w-full flex items-center justify-between py-2.5 text-sm hover:bg-surface-subtle/30 transition-colors -mx-2 px-2 rounded"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2.5">
          <span
            className={`w-1.5 h-1.5 rounded-full shrink-0 ${hasQr ? 'bg-green-500' : 'bg-surface-muted'}`}
            title={hasQr ? 'QR uploaded' : 'No QR'}
          />
          <span className="text-text-muted">{bank.name}</span>
          {isInactive && (
            <span className="text-[10px] uppercase tracking-wider text-red-400/70 font-semibold">Inactive</span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className="font-num text-text">
            {bank.balanceBob.toFixed(2)}
            <span className="text-text-faint text-xs ml-1">BOB</span>
          </span>
          <svg
            className={`w-3.5 h-3.5 text-text-faint transition-transform ${expanded ? 'rotate-180' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      <div
        className="grid transition-[grid-template-rows] duration-200 ease-out"
        style={{ gridTemplateRows: expanded ? '1fr' : '0fr' }}
      >
        <div className="overflow-hidden">
          <div className="py-3 pl-5">
            {/* Status toggle */}
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs text-text-faint">Status</span>
              <button
                type="button"
                className={`text-xs px-2 py-0.5 rounded transition-colors ${
                  isInactive
                    ? 'bg-surface-muted/40 text-text-faint hover:text-green-400'
                    : 'bg-green-600/20 text-green-400 hover:text-red-400'
                }`}
                onClick={() => updateBank.mutate({
                  bankId: bank.id,
                  status: isInactive ? 'active' : 'inactive',
                })}
                disabled={updateBank.isPending}
              >
                {isInactive ? 'Activate' : 'Deactivate'}
              </button>
            </div>

            {/* QR section */}
            {uploadQr.isPending ? (
              <div className="text-sm text-text-faint py-4 text-center">Uploading...</div>
            ) : hasQr ? (
              <QrPreview bankId={bank.id} qrPath={bank.qrCodePath!} />
            ) : (
              <QrDropZone onFile={(file) => uploadQr.mutate({ bankId: bank.id, file })} />
            )}
            {uploadQr.isError && (
              <div className="text-red-400 text-xs mt-2">Upload failed. Try again.</div>
            )}

            {/* Edit fields */}
            <BankEditForm
              bank={bank}
              onSave={(fields) => updateBank.mutate({ bankId: bank.id, ...fields })}
              saving={updateBank.isPending}
            />
            {updateBank.isError && (
              <div className="text-red-400 text-xs mt-2">Update failed. Try again.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function AddBankForm({ onClose }: { onClose: () => void }) {
  const createBank = useCreateBank();
  const [name, setName] = useState('');
  const [bankSlug, setBankSlug] = useState('');
  const [hint, setHint] = useState('');
  const [balance, setBalance] = useState('0');
  const [limit, setLimit] = useState('50000');

  const valid = name.trim() && bankSlug.trim() && hint.trim();

  const handleCreate = () => {
    createBank.mutate(
      {
        name: name.trim(),
        bank: bankSlug.trim(),
        accountHint: hint.trim(),
        balanceBob: parseFloat(balance) || 0,
        dailyLimit: parseFloat(limit) || 0,
      },
      { onSuccess: onClose },
    );
  };

  return (
    <div className="border border-surface-muted/30 rounded p-3 mt-2">
      <div className="grid grid-cols-2 gap-x-3 gap-y-2">
        <div>
          <div className={labelClass}>Name *</div>
          <input className={fieldClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="Banco Union Personal" />
        </div>
        <div>
          <div className={labelClass}>Bank slug *</div>
          <input className={fieldClass} value={bankSlug} onChange={(e) => setBankSlug(e.target.value)} placeholder="banco-union" />
        </div>
        <div>
          <div className={labelClass}>Account hint *</div>
          <input className={fieldClass} value={hint} onChange={(e) => setHint(e.target.value)} placeholder="4521" />
        </div>
        <div>
          <div className={labelClass}>Balance BOB</div>
          <input className={fieldClass} type="number" step="0.01" value={balance} onChange={(e) => setBalance(e.target.value)} />
        </div>
        <div>
          <div className={labelClass}>Daily limit</div>
          <input className={fieldClass} type="number" value={limit} onChange={(e) => setLimit(e.target.value)} />
        </div>
        <div className="flex items-end">
          <div className="flex gap-2">
            <button
              type="button"
              className="text-xs px-3 py-1 rounded bg-green-600 text-white hover:bg-green-500 transition-colors disabled:opacity-40"
              disabled={!valid || createBank.isPending}
              onClick={handleCreate}
            >
              {createBank.isPending ? 'Creating...' : 'Create'}
            </button>
            <button
              type="button"
              className="text-xs px-3 py-1 rounded text-text-faint hover:text-text transition-colors"
              onClick={onClose}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
      {createBank.isError && (
        <div className="text-red-400 text-xs mt-2">Failed to create account. Try again.</div>
      )}
    </div>
  );
}

export default function BankQrManager() {
  const { data: banks, isLoading } = useBanks();
  const [showAdd, setShowAdd] = useState(false);

  if (isLoading) return <div className="text-text-faint text-sm">Loading banks...</div>;

  return (
    <div>
      {banks && banks.length > 0 ? (
        banks.map((bank) => (
          <BankRow key={bank.id} bank={bank as BankData} />
        ))
      ) : (
        <div className="text-text-faint text-sm py-2">No bank accounts configured.</div>
      )}

      {showAdd ? (
        <AddBankForm onClose={() => setShowAdd(false)} />
      ) : (
        <button
          type="button"
          className="text-xs text-text-faint hover:text-text-muted transition-colors mt-3"
          onClick={() => setShowAdd(true)}
        >
          + Add account
        </button>
      )}
    </div>
  );
}
