import { useState, useEffect } from 'react';
import { useRepricingConfig, useUpdateRepricingConfig, type RepricingConfigData } from '../hooks/useApi';

export default function RepricingConfigPanel() {
  const { data, isLoading } = useRepricingConfig();
  const update = useUpdateRepricingConfig();
  const [local, setLocal] = useState<RepricingConfigData | null>(null);

  useEffect(() => {
    if (data && !local) setLocal(data);
  }, [data, local]);

  if (isLoading || !local) {
    return <div className="text-text-faint text-xs">Loading repricing config...</div>;
  }

  const isDirty = data && JSON.stringify(local) !== JSON.stringify(data);

  const handleSave = () => {
    if (!local) return;
    update.mutate(local, {
      onSuccess: (res: any) => {
        if (res.config) setLocal(res.config);
      },
    });
  };

  const patch = (p: Partial<RepricingConfigData>) => setLocal({ ...local, ...p });
  const patchFilter = (p: Partial<RepricingConfigData['filters']>) =>
    setLocal({ ...local, filters: { ...local.filters, ...p } });

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs uppercase text-text-faint tracking-wide">Repricing Engine</h2>
        {isDirty && (
          <button
            className="text-xs px-3 py-1 rounded bg-green-600 text-white hover:bg-green-500 transition-colors disabled:opacity-40"
            onClick={handleSave}
            disabled={update.isPending}
          >
            {update.isPending ? 'Saving...' : 'Save'}
          </button>
        )}
      </div>

      <div className="flex flex-col gap-2">
        {/* Mode selector */}
        <div className="border border-surface-muted/30 rounded px-4 py-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">Mode</span>
            <div className="flex">
              {(['conservative', 'aggressive'] as const).map((m) => (
                <button
                  key={m}
                  className={`text-xs px-3 py-1 transition-colors first:rounded-l last:rounded-r ${
                    local.mode === m
                      ? m === 'aggressive'
                        ? 'bg-red-600/30 text-red-400'
                        : 'bg-green-600/20 text-green-400'
                      : 'bg-surface-muted/40 text-text-faint hover:text-text-muted'
                  }`}
                  onClick={() => patch({ mode: m })}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-4 mt-1">
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-text-faint">Position</span>
              <input
                type="number"
                min={1}
                max={10}
                className="bg-surface-subtle border border-surface-muted/40 rounded px-2 py-0.5 text-xs text-text w-12 font-num focus:outline-none focus:border-text-faint"
                value={local.targetPosition}
                onChange={(e) => patch({ targetPosition: parseInt(e.target.value) || 1 })}
              />
              <span className="text-xs text-text-faint">#</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-text-faint">Anti-osc</span>
              <input
                type="number"
                step={0.001}
                className="bg-surface-subtle border border-surface-muted/40 rounded px-2 py-0.5 text-xs text-text w-16 font-num focus:outline-none focus:border-text-faint"
                value={local.antiOscillationThreshold}
                onChange={(e) => patch({ antiOscillationThreshold: parseFloat(e.target.value) || 0 })}
              />
              <span className="text-xs text-text-faint">BOB</span>
            </div>
          </div>
        </div>

        {/* Spread bounds */}
        <div className="border border-surface-muted/30 rounded px-4 py-3">
          <span className="text-sm font-medium">Spread Bounds</span>
          <div className="flex gap-4 mt-2">
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-text-faint">Min</span>
              <input
                type="number"
                step={0.001}
                className="bg-surface-subtle border border-surface-muted/40 rounded px-2 py-0.5 text-xs text-text w-16 font-num focus:outline-none focus:border-text-faint"
                value={local.minSpread}
                onChange={(e) => patch({ minSpread: parseFloat(e.target.value) || 0 })}
              />
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-text-faint">Max</span>
              <input
                type="number"
                step={0.001}
                className="bg-surface-subtle border border-surface-muted/40 rounded px-2 py-0.5 text-xs text-text w-16 font-num focus:outline-none focus:border-text-faint"
                value={local.maxSpread}
                onChange={(e) => patch({ maxSpread: parseFloat(e.target.value) || 0 })}
              />
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="border border-surface-muted/30 rounded px-4 py-3">
          <span className="text-sm font-medium">Competitor Filters</span>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 mt-2">
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-text-faint">Min amount</span>
              <input
                type="number"
                className="bg-surface-subtle border border-surface-muted/40 rounded px-2 py-0.5 text-xs text-text w-16 font-num focus:outline-none focus:border-text-faint"
                value={local.filters.minOrderAmount}
                onChange={(e) => patchFilter({ minOrderAmount: parseInt(e.target.value) || 0 })}
              />
              <span className="text-xs text-text-faint">BOB</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-text-faint">Min rate</span>
              <input
                type="number"
                className="bg-surface-subtle border border-surface-muted/40 rounded px-2 py-0.5 text-xs text-text w-12 font-num focus:outline-none focus:border-text-faint"
                value={local.filters.minCompletionRate}
                onChange={(e) => patchFilter({ minCompletionRate: parseInt(e.target.value) || 0 })}
              />
              <span className="text-xs text-text-faint">%</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-text-faint">Min orders</span>
              <input
                type="number"
                className="bg-surface-subtle border border-surface-muted/40 rounded px-2 py-0.5 text-xs text-text w-12 font-num focus:outline-none focus:border-text-faint"
                value={local.filters.minOrderCount}
                onChange={(e) => patchFilter({ minOrderCount: parseInt(e.target.value) || 0 })}
              />
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-text-faint">Verified</span>
              <button
                className={`text-xs px-3 py-0.5 rounded transition-colors ${
                  local.filters.verifiedOnly
                    ? 'bg-green-600/20 text-green-400'
                    : 'bg-surface-muted/40 text-text-faint'
                }`}
                onClick={() => patchFilter({ verifiedOnly: !local.filters.verifiedOnly })}
              >
                {local.filters.verifiedOnly ? 'ON' : 'OFF'}
              </button>
            </div>
            <div className="col-span-2 flex items-center gap-1.5">
              <span className="text-xs text-text-faint">Levels</span>
              <input
                type="text"
                className="bg-surface-subtle border border-surface-muted/40 rounded px-2 py-0.5 text-xs text-text w-24 focus:outline-none focus:border-text-faint"
                value={local.filters.merchantLevels.join(',')}
                onChange={(e) => patchFilter({ merchantLevels: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
              />
              <span className="text-xs text-text-faint">GA,VA</span>
            </div>
          </div>
        </div>
      </div>

      {update.isError && (
        <div className="text-red-400 text-xs mt-2">Failed to update config.</div>
      )}
    </div>
  );
}
