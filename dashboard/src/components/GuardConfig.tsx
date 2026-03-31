import { useState, useEffect } from 'react';
import { useGuardConfig, useUpdateGuardConfig, type GuardConfig } from '../hooks/useApi';

interface GuardRowProps {
  label: string;
  description: string;
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  fields: Array<{
    label: string;
    value: number;
    onChange: (v: number) => void;
    suffix: string;
  }>;
  pending: boolean;
}

function GuardRow({ label, description, enabled, onToggle, fields, pending }: GuardRowProps) {
  return (
    <div className={`border border-surface-muted/30 rounded px-4 py-3 transition-colors ${enabled ? 'bg-surface-subtle/40' : ''}`}>
      <div className="flex items-center justify-between mb-1">
        <div>
          <span className="text-sm font-medium">{label}</span>
          <span className="text-text-faint text-xs ml-2">{description}</span>
        </div>
        <button
          className={`text-xs px-3 py-1 rounded transition-colors ${
            enabled
              ? 'bg-green-600/20 text-green-400 hover:bg-red-600/20 hover:text-red-400'
              : 'bg-surface-muted/40 text-text-faint hover:text-green-400'
          }`}
          onClick={() => onToggle(!enabled)}
          disabled={pending}
        >
          {enabled ? 'ON' : 'OFF'}
        </button>
      </div>
      {enabled && (
        <div className="flex gap-4 mt-2">
          {fields.map((f) => (
            <div key={f.label} className="flex items-center gap-1.5">
              <span className="text-xs text-text-faint">{f.label}</span>
              <input
                type="number"
                step="any"
                className="bg-surface-subtle border border-surface-muted/40 rounded px-2 py-0.5 text-xs text-text w-16 font-num focus:outline-none focus:border-text-faint"
                value={f.value}
                onChange={(e) => f.onChange(parseFloat(e.target.value) || 0)}
              />
              <span className="text-xs text-text-faint">{f.suffix}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function GuardConfigPanel() {
  const { data, isLoading } = useGuardConfig();
  const updateGuards = useUpdateGuardConfig();

  const [local, setLocal] = useState<GuardConfig | null>(null);

  useEffect(() => {
    if (data && !local) {
      setLocal(data);
    }
  }, [data, local]);

  if (isLoading || !local) {
    return <div className="text-text-faint text-xs">Loading guards...</div>;
  }

  const isDirty = data && (
    local.gapGuardEnabled !== data.gapGuardEnabled ||
    local.gapGuardThresholdPercent !== data.gapGuardThresholdPercent ||
    local.depthGuardEnabled !== data.depthGuardEnabled ||
    local.depthGuardMinUsdt !== data.depthGuardMinUsdt ||
    local.sessionDriftGuardEnabled !== data.sessionDriftGuardEnabled ||
    local.sessionDriftThresholdPercent !== data.sessionDriftThresholdPercent
  );

  const handleSave = () => {
    if (!local || !data) return;
    const updates: Partial<GuardConfig> = {};
    if (local.gapGuardEnabled !== data.gapGuardEnabled) updates.gapGuardEnabled = local.gapGuardEnabled;
    if (local.gapGuardThresholdPercent !== data.gapGuardThresholdPercent) updates.gapGuardThresholdPercent = local.gapGuardThresholdPercent;
    if (local.depthGuardEnabled !== data.depthGuardEnabled) updates.depthGuardEnabled = local.depthGuardEnabled;
    if (local.depthGuardMinUsdt !== data.depthGuardMinUsdt) updates.depthGuardMinUsdt = local.depthGuardMinUsdt;
    if (local.sessionDriftGuardEnabled !== data.sessionDriftGuardEnabled) updates.sessionDriftGuardEnabled = local.sessionDriftGuardEnabled;
    if (local.sessionDriftThresholdPercent !== data.sessionDriftThresholdPercent) updates.sessionDriftThresholdPercent = local.sessionDriftThresholdPercent;

    updateGuards.mutate(updates, {
      onSuccess: (res: any) => {
        if (res.updated) setLocal(res.updated);
      },
    });
  };

  const update = (patch: Partial<GuardConfig>) => setLocal({ ...local, ...patch });

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs uppercase text-text-faint tracking-wide">Safety Guards</h2>
        {isDirty && (
          <button
            className="text-xs px-3 py-1 rounded bg-green-600 text-white hover:bg-green-500 transition-colors disabled:opacity-40"
            onClick={handleSave}
            disabled={updateGuards.isPending}
          >
            {updateGuards.isPending ? 'Saving...' : 'Save'}
          </button>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <GuardRow
          label="Gap Guard"
          description="Detects price jumps after data outages"
          enabled={local.gapGuardEnabled}
          onToggle={(v) => update({ gapGuardEnabled: v })}
          pending={updateGuards.isPending}
          fields={[{
            label: 'Threshold',
            value: local.gapGuardThresholdPercent,
            onChange: (v) => update({ gapGuardThresholdPercent: v }),
            suffix: '%',
          }]}
        />

        <GuardRow
          label="Depth Guard"
          description="Pauses when order book is too thin"
          enabled={local.depthGuardEnabled}
          onToggle={(v) => update({ depthGuardEnabled: v })}
          pending={updateGuards.isPending}
          fields={[{
            label: 'Min depth',
            value: local.depthGuardMinUsdt,
            onChange: (v) => update({ depthGuardMinUsdt: v }),
            suffix: 'USDT',
          }]}
        />

        <GuardRow
          label="Session Drift"
          description="Catches gradual price drift from session start"
          enabled={local.sessionDriftGuardEnabled}
          onToggle={(v) => update({ sessionDriftGuardEnabled: v })}
          pending={updateGuards.isPending}
          fields={[{
            label: 'Threshold',
            value: local.sessionDriftThresholdPercent,
            onChange: (v) => update({ sessionDriftThresholdPercent: v }),
            suffix: '%',
          }]}
        />
      </div>

      {updateGuards.isError && (
        <div className="text-red-400 text-xs mt-2">Failed to update guards.</div>
      )}
    </div>
  );
}
