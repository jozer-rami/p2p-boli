import { Routes, Route, NavLink } from 'react-router-dom';

function Placeholder({ name }: { name: string }) {
  return <div className="p-8 text-text-muted">TODO: {name}</div>;
}

export default function App() {
  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `px-3 py-1.5 text-sm ${isActive ? 'text-text' : 'text-text-faint hover:text-text-muted'}`;

  return (
    <div className="min-h-screen">
      <nav className="flex items-center justify-between border-b border-surface-muted/30 px-6 py-3">
        <div className="flex items-center gap-4">
          <span className="text-sm font-semibold tracking-wide uppercase text-text-muted mr-2">Boli</span>
          <NavLink to="/" className={linkClass} end>Overview</NavLink>
          <NavLink to="/trades" className={linkClass}>Trades</NavLink>
        </div>
        <div className="text-xs text-text-faint">connecting...</div>
      </nav>
      <main className="px-6 py-5">
        <Routes>
          <Route path="/" element={<Placeholder name="Overview" />} />
          <Route path="/order/:id" element={<Placeholder name="Release Panel" />} />
          <Route path="/trades" element={<Placeholder name="Trade History" />} />
        </Routes>
      </main>
    </div>
  );
}
