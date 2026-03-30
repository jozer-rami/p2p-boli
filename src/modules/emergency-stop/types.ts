export type EmergencyTrigger = 'volatility' | 'spread_inversion' | 'stale_data' | 'manual' | 'gap_alert' | 'low_depth' | 'session_drift';
export type BotState = 'running' | 'paused' | 'emergency';
