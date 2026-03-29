import { useState, useRef, useCallback } from 'react';
import { useBanks, useUploadQr, useDeleteQr } from '../hooks/useApi';

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
            // If preview endpoint doesn't exist, show path
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

function BankRow({ bank }: { bank: {
  id: number;
  name: string;
  bank: string;
  accountHint: string;
  balanceBob: number;
  status: string;
  qrCodePath: string | null;
} }) {
  const [expanded, setExpanded] = useState(false);
  const uploadQr = useUploadQr();

  const hasQr = !!bank.qrCodePath;

  return (
    <div className="border-b border-surface-muted/20 last:border-0">
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
          </div>
        </div>
      </div>
    </div>
  );
}

export default function BankQrManager() {
  const { data: banks, isLoading } = useBanks();

  if (isLoading) return <div className="text-text-faint text-sm">Loading banks...</div>;
  if (!banks || banks.length === 0) return <div className="text-text-faint text-sm">No bank accounts configured.</div>;

  return (
    <div>
      {banks.map((bank) => (
        <BankRow key={bank.id} bank={bank} />
      ))}
    </div>
  );
}
