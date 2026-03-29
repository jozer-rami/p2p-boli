interface Props {
  connected: boolean;
}

export default function ConnectionStatus({ connected }: Props) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <div className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500 animate-pulse'}`} />
      <span className="text-text-faint">
        {connected ? 'Connected' : 'Reconnecting...'}
      </span>
    </div>
  );
}
