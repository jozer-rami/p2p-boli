import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

interface ChatSidebarState {
  openOrderId: string | null;
  openChat: (orderId: string) => void;
  closeChat: () => void;
}

const ChatSidebarContext = createContext<ChatSidebarState>({
  openOrderId: null,
  openChat: () => {},
  closeChat: () => {},
});

export function ChatSidebarProvider({ children }: { children: ReactNode }) {
  const [openOrderId, setOpenOrderId] = useState<string | null>(null);

  const openChat = useCallback((orderId: string) => {
    setOpenOrderId(orderId);
  }, []);

  const closeChat = useCallback(() => {
    setOpenOrderId(null);
  }, []);

  return (
    <ChatSidebarContext.Provider value={{ openOrderId, openChat, closeChat }}>
      {children}
    </ChatSidebarContext.Provider>
  );
}

export function useChatSidebar() {
  return useContext(ChatSidebarContext);
}
