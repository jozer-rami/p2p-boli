import { useState, useEffect } from 'react';
import { useBotConfig, useUpdateBotConfig, type BotConfigData } from '../hooks/useApi';
import Tip from './Tooltip';

interface LocalState {
  activeSides: string;
  tradeAmountUsdt: number;
  repriceEnabled: boolean;
  autoCancelMinutes: number;
  sleepStartHour: number;
  sleepEndHour: number;
  volatilityThreshold: number;
  volatilityWindow: number;
  qrPreMessage: string;
  ordersMs: number;
  adsMs: number;
  pricesMs: number;
}

function dataToLocal(d: BotConfigData): LocalState {
  return {
    activeSides: d.trading.activeSides,
    tradeAmountUsdt: d.trading.tradeAmountUsdt,
    repriceEnabled: d.trading.repriceEnabled,
    autoCancelMinutes: d.trading.autoCancelTimeoutMs / 60_000,
    sleepStartHour: d.schedule.sleepStartHour,
    sleepEndHour: d.schedule.sleepEndHour,
    volatilityThreshold: d.volatility.thresholdPercent,
    volatilityWindow: d.volatility.windowMinutes,
    qrPreMessage: d.messaging.qrPreMessage,
    ordersMs: d.polling.ordersMs,
    adsMs: d.polling.adsMs,
    pricesMs: d.polling.pricesMs,
  };
}

function localToUpdates(local: LocalState): Record<string, any> {
  return {
    activeSides: local.activeSides,
    tradeAmountUsdt: local.tradeAmountUsdt,
    repriceEnabled: local.repriceEnabled,
    autoCancelTimeoutMs: local.autoCancelMinutes * 60_000,
    sleepStartHour: local.sleepStartHour,
    sleepEndHour: local.sleepEndHour,
    volatilityThresholdPercent: local.volatilityThreshold,
    volatilityWindowMinutes: local.volatilityWindow,
    qrPreMessage: local.qrPreMessage,
    ordersPollingMs: local.ordersMs,
    adsPollingMs: local.adsMs,
    pricesPollingMs: local.pricesMs,
  };
}

function isDirtyCheck(local: LocalState, data: BotConfigData): boolean {
  return (
    local.activeSides !== data.trading.activeSides ||
    local.tradeAmountUsdt !== data.trading.tradeAmountUsdt ||
    local.repriceEnabled !== data.trading.repriceEnabled ||
    local.autoCancelMinutes !== data.trading.autoCancelTimeoutMs / 60_000 ||
    local.sleepStartHour !== data.schedule.sleepStartHour ||
    local.sleepEndHour !== data.schedule.sleepEndHour ||
    local.volatilityThreshold !== data.volatility.thresholdPercent ||
    local.volatilityWindow !== data.volatility.windowMinutes ||
    local.qrPreMessage !== data.messaging.qrPreMessage ||
    local.ordersMs !== data.polling.ordersMs ||
    local.adsMs !== data.polling.adsMs ||
    local.pricesMs !== data.polling.pricesMs
  );
}

export default function BotSettingsPanel() {
  const { data, isLoading } = useBotConfig();
  const updateConfig = useUpdateBotConfig();

  const [local, setLocal] = useState<LocalState | null>(null);
  const [messagingOpen, setMessagingOpen] = useState(false);
  const [pollingOpen, setPollingOpen] = useState(false);

  useEffect(() => {
    if (data && !local) {
      setLocal(dataToLocal(data));
    }
  }, [data, local]);

  if (isLoading || !local) {
    return <div className="text-text-faint text-xs">Loading bot config...</div>;
  }

  const isDirty = data ? isDirtyCheck(local, data) : false;

  const update = (patch: Partial<LocalState>) => setLocal((prev) => ({ ...prev!, ...patch }));

  const handleSave = () => {
    if (!local) return;
    updateConfig.mutate(localToUpdates(local), {
      onSuccess: (res: any) => {
        if (res.updated && data) {
          setLocal(dataToLocal({ ...data, ...res.updated }));
        }
      },
    });
  };

  const handleBotState = (state: 'running' | 'paused') => {
    updateConfig.mutate({ botState: state });
  };

  const botState = data?.botState ?? 'unknown';

  const sidesOptions: Array<{ value: string; label: string; activeClass: string }> = [
    { value: 'buy', label: 'BUY', activeClass: 'bg-blue-600/20 text-blue-400' },
    { value: 'sell', label: 'SELL', activeClass: 'bg-amber-600/20 text-amber-400' },
    { value: 'both', label: 'BOTH', activeClass: 'bg-green-600/20 text-green-400' },
  ];

  const inputCls =
    'bg-surface-subtle border border-surface-muted/40 rounded px-2 py-0.5 text-xs text-text w-16 font-num focus:outline-none focus:border-text-faint';
  const inputWide =
    'bg-surface-subtle border border-surface-muted/40 rounded px-2 py-0.5 text-xs text-text w-full font-num focus:outline-none focus:border-text-faint';

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs uppercase text-text-faint tracking-wide">Bot Settings</h2>
        {isDirty && (
          <button
            className="text-xs px-3 py-1 rounded bg-green-600 text-white hover:bg-green-500 transition-colors disabled:opacity-40"
            onClick={handleSave}
            disabled={updateConfig.isPending}
          >
            {updateConfig.isPending ? 'Saving...' : 'Save'}
          </button>
        )}
      </div>

      <div className="flex flex-col gap-2">
        {/* Trading Controls */}
        <div className="border border-surface-muted/30 rounded px-4 py-3 bg-surface-subtle/40">
          <span className="text-sm font-medium">Trading Controls</span>

          {/* Active sides */}
          <div className="flex items-center gap-3 mt-3">
            <span className="text-xs text-text-faint w-24">Active sides<Tip text="Which sides to post ads on. BUY = buy USDT (pay BOB). SELL = sell USDT (receive BOB). BOTH = market making." /></span>
            <div className="flex gap-1">
              {sidesOptions.map((opt) => (
                <button
                  key={opt.value}
                  className={`text-xs px-2.5 py-1 rounded transition-colors ${
                    local.activeSides === opt.value
                      ? opt.activeClass
                      : 'bg-surface-muted/40 text-text-faint hover:text-text'
                  }`}
                  onClick={() => update({ activeSides: opt.value })}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Trade amount */}
          <div className="flex items-center gap-3 mt-2">
            <span className="text-xs text-text-faint w-24">Trade amount<Tip text="USDT amount per ad. When quantity drops below 50%, the bot refills to this amount." /></span>
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                step="any"
                className={inputCls}
                value={local.tradeAmountUsdt}
                onChange={(e) => update({ tradeAmountUsdt: parseFloat(e.target.value) || 0 })}
              />
              <span className="text-xs text-text-faint">USDT</span>
            </div>
          </div>

          {/* Auto-reprice */}
          <div className="flex items-center gap-3 mt-2">
            <span className="text-xs text-text-faint w-24">Auto-reprice<Tip text="When ON, the repricing engine adjusts ad prices every 30s based on order book analysis. When OFF, prices stay fixed." /></span>
            <button
              className={`text-xs px-3 py-1 rounded transition-colors ${
                local.repriceEnabled
                  ? 'bg-green-600/20 text-green-400 hover:bg-red-600/20 hover:text-red-400'
                  : 'bg-surface-muted/40 text-text-faint hover:text-green-400'
              }`}
              onClick={() => update({ repriceEnabled: !local.repriceEnabled })}
            >
              {local.repriceEnabled ? 'ON' : 'OFF'}
            </button>
          </div>

          {/* Auto-cancel */}
          <div className="flex items-center gap-3 mt-2">
            <span className="text-xs text-text-faint w-24">Auto-cancel<Tip text="Automatically cancel orders if counterparty doesn't pay within this time. Prevents capital lockup." /></span>
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                step="any"
                className={inputCls}
                value={local.autoCancelMinutes}
                onChange={(e) => update({ autoCancelMinutes: parseFloat(e.target.value) || 0 })}
              />
              <span className="text-xs text-text-faint">min</span>
            </div>
          </div>
        </div>

        {/* Bot State */}
        <div className="border border-surface-muted/30 rounded px-4 py-3 bg-surface-subtle/40">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium">Bot State</span>
              <span
                className={`text-xs font-semibold ${
                  botState === 'running'
                    ? 'text-green-400'
                    : botState === 'emergency'
                    ? 'text-red-400'
                    : 'text-amber-400'
                }`}
              >
                {botState.toUpperCase()}
              </span>
            </div>
            <div className="flex gap-1">
              {botState === 'running' && (
                <button
                  className="text-xs px-3 py-1 rounded bg-amber-600/20 text-amber-400 hover:bg-amber-600/30 transition-colors disabled:opacity-40"
                  onClick={() => handleBotState('paused')}
                  disabled={updateConfig.isPending}
                >
                  Pause
                </button>
              )}
              {(botState === 'paused' || botState === 'emergency') && (
                <button
                  className="text-xs px-3 py-1 rounded bg-green-600/20 text-green-400 hover:bg-green-600/30 transition-colors disabled:opacity-40"
                  onClick={() => handleBotState('running')}
                  disabled={updateConfig.isPending}
                >
                  Resume
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Schedule */}
        <div className="border border-surface-muted/30 rounded px-4 py-3 bg-surface-subtle/40">
          <span className="text-sm font-medium">Schedule</span>
          <span className="text-text-faint text-xs ml-2">BOT (UTC-4)</span>
          <div className="flex gap-6 mt-3">
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-text-faint">Sleep start<Tip text="Hour to pause trading and remove ads. Bolivia time (UTC-4)." /></span>
              <input
                type="number"
                min={0}
                max={23}
                className={inputCls}
                value={local.sleepStartHour}
                onChange={(e) => update({ sleepStartHour: parseInt(e.target.value, 10) || 0 })}
              />
              <span className="text-xs text-text-faint">:00</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-text-faint">Sleep end<Tip text="Hour to resume trading and recreate ads. Bolivia time (UTC-4)." /></span>
              <input
                type="number"
                min={0}
                max={23}
                className={inputCls}
                value={local.sleepEndHour}
                onChange={(e) => update({ sleepEndHour: parseInt(e.target.value, 10) || 0 })}
              />
              <span className="text-xs text-text-faint">:00</span>
            </div>
          </div>
        </div>

        {/* Volatility */}
        <div className="border border-surface-muted/30 rounded px-4 py-3 bg-surface-subtle/40">
          <span className="text-sm font-medium">Volatility</span>
          <div className="flex gap-6 mt-3">
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-text-faint">Threshold<Tip text="Price change % that triggers emergency stop. If price moves more than this within the window, all ads are removed." /></span>
              <input
                type="number"
                step="any"
                className={inputCls}
                value={local.volatilityThreshold}
                onChange={(e) => update({ volatilityThreshold: parseFloat(e.target.value) || 0 })}
              />
              <span className="text-xs text-text-faint">%</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-text-faint">Window<Tip text="Rolling time window for volatility detection. Price change is measured over this period." /></span>
              <input
                type="number"
                step="any"
                className={inputCls}
                value={local.volatilityWindow}
                onChange={(e) => update({ volatilityWindow: parseFloat(e.target.value) || 0 })}
              />
              <span className="text-xs text-text-faint">min</span>
            </div>
          </div>
        </div>

        {/* Messaging (collapsible) */}
        <div className="border border-surface-muted/30 rounded px-4 py-3 bg-surface-subtle/40">
          <button
            className="flex items-center gap-2 w-full text-left"
            onClick={() => setMessagingOpen((v) => !v)}
          >
            <span className="text-sm font-medium">Messaging</span>
            <span className="text-text-faint text-xs">{messagingOpen ? '▲' : '▼'}</span>
          </button>
          {messagingOpen && (
            <div className="mt-3">
              <div className="flex flex-col gap-1.5">
                <span className="text-xs text-text-faint">QR pre-message<Tip text="Text sent to counterparty in Bybit chat before the QR code image on sell orders." /></span>
                <input
                  type="text"
                  className={inputWide}
                  value={local.qrPreMessage}
                  onChange={(e) => update({ qrPreMessage: e.target.value })}
                />
              </div>
            </div>
          )}
        </div>

        {/* Polling (collapsible) */}
        <div className="border border-surface-muted/30 rounded px-4 py-3 bg-surface-subtle/40">
          <button
            className="flex items-center gap-2 w-full text-left"
            onClick={() => setPollingOpen((v) => !v)}
          >
            <span className="text-sm font-medium">Polling</span>
            <span className="text-text-faint text-xs">{pollingOpen ? '▲' : '▼'}</span>
          </button>
          {pollingOpen && (
            <div className="flex flex-wrap gap-4 mt-3">
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-text-faint">Orders<Tip text="How often to check Bybit for new/updated orders. Lower = faster response but more API calls." /></span>
                <input
                  type="number"
                  className={inputCls}
                  value={local.ordersMs}
                  onChange={(e) => update({ ordersMs: parseInt(e.target.value, 10) || 0 })}
                />
                <span className="text-xs text-text-faint">ms</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-text-faint">Ads<Tip text="How often to run the repricing engine and update ad prices. 30s is standard." /></span>
                <input
                  type="number"
                  className={inputCls}
                  value={local.adsMs}
                  onChange={(e) => update({ adsMs: parseInt(e.target.value, 10) || 0 })}
                />
                <span className="text-xs text-text-faint">ms</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-text-faint">Prices<Tip text="How often to fetch market prices from CriptoYa and Bybit. Also drives volatility detection." /></span>
                <input
                  type="number"
                  className={inputCls}
                  value={local.pricesMs}
                  onChange={(e) => update({ pricesMs: parseInt(e.target.value, 10) || 0 })}
                />
                <span className="text-xs text-text-faint">ms</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {updateConfig.isError && (
        <div className="text-red-400 text-xs mt-2">Failed to update bot config.</div>
      )}
    </div>
  );
}
