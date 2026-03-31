import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

export function useStatus() {
  return useQuery({
    queryKey: ['status'],
    queryFn: () => fetchJson('/api/status'),
    refetchInterval: 10_000,
  });
}

export function useOrders() {
  return useQuery({
    queryKey: ['orders'],
    queryFn: () => fetchJson('/api/orders'),
    refetchInterval: 5_000,
  });
}

export function useOrder(id: string) {
  return useQuery({
    queryKey: ['orders', id],
    queryFn: () => fetchJson(`/api/orders/${id}`),
    refetchInterval: 5_000,
  });
}

export function useOrderChat(id: string) {
  return useQuery({
    queryKey: ['orders', id, 'chat'],
    queryFn: () => fetchJson(`/api/orders/${id}/chat`),
    refetchInterval: 10_000,
  });
}

export function useTrades(range: string = 'today') {
  return useQuery({
    queryKey: ['trades', range],
    queryFn: () => fetchJson(`/api/trades?range=${range}`),
  });
}

export function usePrices() {
  return useQuery({
    queryKey: ['prices'],
    queryFn: () => fetchJson('/api/prices'),
    refetchInterval: 30_000,
  });
}

export function useSendChatMessage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ orderId, message }: { orderId: string; message: string }) => {
      const res = await fetch(`/api/orders/${orderId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      });
      if (!res.ok) throw new Error('Failed to send message');
      return res.json();
    },
    onSuccess: (_data, { orderId }) => {
      queryClient.invalidateQueries({ queryKey: ['orders', orderId, 'chat'] });
    },
  });
}

export function useSendChatImage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ orderId, file }: { orderId: string; file: File }) => {
      const res = await fetch(`/api/orders/${orderId}/chat/image`, {
        method: 'POST',
        headers: { 'Content-Type': file.type },
        body: file,
      });
      if (!res.ok) throw new Error('Failed to upload image');
      return res.json();
    },
    onSuccess: (_data, { orderId }) => {
      queryClient.invalidateQueries({ queryKey: ['orders', orderId, 'chat'] });
    },
  });
}

export function useBanks() {
  return useQuery({
    queryKey: ['banks'],
    queryFn: () => fetchJson<Array<{
      id: number;
      name: string;
      bank: string;
      accountHint: string;
      balanceBob: number;
      dailyVolume: number;
      dailyLimit: number;
      monthlyVolume: number;
      status: string;
      priority: number;
      qrCodePath: string | null;
      paymentMessage: string | null;
    }>>('/api/banks'),
  });
}

export function useUploadQr() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ bankId, file }: { bankId: number; file: File }) => {
      const res = await fetch(`/api/banks/${bankId}/qr`, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      });
      if (!res.ok) throw new Error('Failed to upload QR');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['banks'] });
    },
  });
}

export function useDeleteQr() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (bankId: number) => {
      const res = await fetch(`/api/banks/${bankId}/qr`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete QR');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['banks'] });
    },
  });
}

export function useCreateBank() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: {
      name: string;
      bank: string;
      accountHint: string;
      balanceBob: number;
      dailyLimit: number;
      priority?: number;
      paymentMessage?: string;
    }) => {
      const res = await fetch('/api/banks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error('Failed to create bank');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['banks'] });
    },
  });
}

export function useUpdateBank() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ bankId, ...data }: {
      bankId: number;
      name?: string;
      bank?: string;
      accountHint?: string;
      balanceBob?: number;
      dailyLimit?: number;
      priority?: number;
      paymentMessage?: string;
      status?: string;
    }) => {
      const res = await fetch(`/api/banks/${bankId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error('Failed to update bank');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['banks'] });
    },
  });
}

export function useReleaseOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (orderId: string) => {
      const res = await fetch(`/api/orders/${orderId}/release`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: true }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Release failed');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['status'] });
    },
  });
}

// Guard config
export interface GuardConfig {
  gapGuardEnabled: boolean;
  gapGuardThresholdPercent: number;
  depthGuardEnabled: boolean;
  depthGuardMinUsdt: number;
  sessionDriftGuardEnabled: boolean;
  sessionDriftThresholdPercent: number;
}

export function useGuardConfig() {
  return useQuery({
    queryKey: ['guardConfig'],
    queryFn: () => fetchJson<GuardConfig>('/api/config/guards'),
  });
}

export function useUpdateGuardConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (updates: Partial<GuardConfig>) => {
      const res = await fetch('/api/config/guards', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error('Failed to update guard config');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['guardConfig'] });
      queryClient.invalidateQueries({ queryKey: ['status'] });
    },
  });
}

export function useDisputeOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (orderId: string) => {
      const res = await fetch(`/api/orders/${orderId}/dispute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) throw new Error('Dispute failed');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
    },
  });
}
