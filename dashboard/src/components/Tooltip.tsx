export default function Tip({ text }: { text: string }) {
  return (
    <span className="relative inline-flex ml-1 group" title={text}>
      <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full border border-surface-muted/60 text-[9px] font-semibold text-text-faint cursor-help group-hover:border-text-muted group-hover:text-text-muted">
        ?
      </span>
      <span className="hidden group-hover:block absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 w-52 px-2.5 py-1.5 text-xs text-text-muted bg-surface-subtle border border-surface-muted/40 rounded shadow-lg z-50 leading-snug pointer-events-none">
        {text}
      </span>
    </span>
  );
}
