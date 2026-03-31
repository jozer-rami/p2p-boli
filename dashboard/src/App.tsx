import { Routes, Route, NavLink, Navigate } from 'react-router-dom';
import { useWebSocket } from './hooks/useWebSocket';
import { useOrders } from './hooks/useApi';
import { ChatSidebarProvider, useChatSidebar } from './hooks/useChatSidebar';
import ConnectionStatus from './components/ConnectionStatus';
import ChatSidebar from './components/ChatSidebar';
import Overview from './pages/Overview';
import ReleasePanel from './pages/ReleasePanel';
import TradeHistory from './pages/TradeHistory';
import Market from './pages/Market';

function SmartHome() {
  const { data: orders } = useOrders();
  const orderList = (orders ?? []) as any[];
  const urgentOrder = orderList.find((o: any) => o.status === 'payment_marked');
  if (urgentOrder) {
    return <Navigate to={`/order/${urgentOrder.id}`} replace />;
  }
  return <Overview />;
}

function AppContent() {
  const { connected } = useWebSocket();
  const { openOrderId, closeChat } = useChatSidebar();

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `px-3 py-1.5 text-sm ${isActive ? 'text-text' : 'text-text-faint hover:text-text-muted'}`;

  return (
    <div className="min-h-screen">
      <nav className="flex items-center justify-between border-b border-surface-muted/30 px-6 py-3">
        <div className="flex items-center gap-4">
          <span className="text-sm font-semibold tracking-wide uppercase text-text-muted mr-2">Boli</span>
          <NavLink to="/" className={linkClass} end>Overview</NavLink>
          <NavLink to="/market" className={linkClass}>Market</NavLink>
          <NavLink to="/trades" className={linkClass}>Trades</NavLink>
        </div>
        <ConnectionStatus connected={connected} />
      </nav>
      {!connected && (
        <div className="bg-amber-900/30 text-amber-200 text-sm px-6 py-2">
          Dashboard disconnected from bot — data may be stale. Reconnecting...
        </div>
      )}
      <main className={`px-6 py-5 transition-all ${openOrderId ? 'mr-[360px]' : ''}`}>
        <Routes>
          <Route path="/" element={<SmartHome />} />
          <Route path="/order/:id" element={<ReleasePanel />} />
          <Route path="/market" element={<Market />} />
          <Route path="/trades" element={<TradeHistory />} />
        </Routes>
      </main>

      {/* Chat sidebar — slides in from right */}
      {openOrderId && (
        <ChatSidebar orderId={openOrderId} onClose={closeChat} />
      )}
    </div>
  );
}

export default function App() {
  return (
    <ChatSidebarProvider>
      <AppContent />
    </ChatSidebarProvider>
  );
}
