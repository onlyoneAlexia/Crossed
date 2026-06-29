export type PassiveWalletAddressUpdate = {
  shouldUpdate: boolean;
  address?: string | null;
  networkPassphrase?: string | null;
};

export function passiveWalletAddressUpdate({
  currentAddress,
  observedAddress,
  observedNetworkPassphrase,
  expectedNetworkPassphrase,
}: {
  currentAddress: string | null;
  observedAddress?: string | null;
  observedNetworkPassphrase?: string | null;
  expectedNetworkPassphrase: string;
}): PassiveWalletAddressUpdate {
  if (observedNetworkPassphrase && observedNetworkPassphrase !== expectedNetworkPassphrase) {
    return {
      shouldUpdate: true,
      address: null,
      networkPassphrase: observedNetworkPassphrase,
    };
  }

  if (!currentAddress || !observedAddress) return { shouldUpdate: false };
  if (observedAddress !== currentAddress) return { shouldUpdate: false };

  return {
    shouldUpdate: true,
    address: currentAddress,
    networkPassphrase: observedNetworkPassphrase ?? expectedNetworkPassphrase,
  };
}
