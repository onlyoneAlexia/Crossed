export type WalletState = {
  address: string | null;
  networkPassphrase?: string | null;
};

export type WalletStateListener = (state: WalletState) => void;

export function createWalletStateStore(initialAddress: string | null = null) {
  let state: WalletState = { address: initialAddress, networkPassphrase: null };
  const listeners = new Set<WalletStateListener>();

  const emit = () => {
    const snapshot = { ...state };
    for (const listener of listeners) listener(snapshot);
  };

  return {
    getAddress: () => state.address,
    getState: () => ({ ...state }),
    setAddress: (address: string | null, networkPassphrase?: string | null) => {
      const normalizedAddress = address || null;
      const normalizedNetwork = networkPassphrase ?? state.networkPassphrase ?? null;
      if (state.address === normalizedAddress && state.networkPassphrase === normalizedNetwork) return false;
      state = { address: normalizedAddress, networkPassphrase: normalizedNetwork };
      emit();
      return true;
    },
    subscribe: (listener: WalletStateListener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
