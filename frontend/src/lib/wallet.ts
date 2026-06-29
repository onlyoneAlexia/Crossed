import { Buffer } from "buffer";
import {
  StellarWalletsKit,
} from "@creit.tech/stellar-wallets-kit/sdk";
import {
  defaultModules,
} from "@creit.tech/stellar-wallets-kit/modules/utils";
import {
  CACTUSLINK_ID,
} from "@creit.tech/stellar-wallets-kit/modules/cactuslink";
import {
  FREIGHTER_ID,
} from "@creit.tech/stellar-wallets-kit/modules/freighter";
import {
  HANA_ID,
} from "@creit.tech/stellar-wallets-kit/modules/hana";
import {
  KLEVER_ID,
} from "@creit.tech/stellar-wallets-kit/modules/klever";
import {
  ONEKEY_ID,
} from "@creit.tech/stellar-wallets-kit/modules/onekey";
import {
  KitEventType,
  Networks,
  SwkAppDarkTheme,
  type KitEventStateUpdated,
  type ModuleInterface,
} from "@creit.tech/stellar-wallets-kit/types";
import type { xdr } from "@stellar/stellar-sdk";

import { CONFIG } from "./config";
import { passiveWalletAddressUpdate } from "./wallet-events";
import { createWalletStateStore, type WalletStateListener } from "./wallet-state";

const walletState = createWalletStateStore();
let kitStarted = false;
let kitStartPromise: Promise<void> | null = null;
let kitSubscriptions: (() => void)[] = [];
let walletPollTimer: number | null = null;
const WALLET_ADDRESS_POLL_MS = 1500;

const AUTH_ENTRY_WALLET_IDS = new Set([
  FREIGHTER_ID,
  HANA_ID,
  KLEVER_ID,
  ONEKEY_ID,
  CACTUSLINK_ID,
]);

const crossedWalletTheme = {
  ...SwkAppDarkTheme,
  background: "#141A47",
  "background-secondary": "#1B2356",
  "foreground-strong": "#FFFFFF",
  foreground: "#FFFFFF",
  "foreground-secondary": "#CDD1F0",
  primary: "#FFD23F",
  "primary-foreground": "#1A1206",
  border: "#3A2E7A",
  shadow: "4px 4px 0 #05060F",
  "border-radius": "4px",
  "font-family": "VT323, ui-monospace, monospace",
};

async function buildModules(): Promise<ModuleInterface[]> {
  const modules = defaultModules({
    filterBy: (module) => AUTH_ENTRY_WALLET_IDS.has(module.productId),
  });
  const walletConnectProjectId = import.meta.env.VITE_WC_PROJECT_ID || import.meta.env.VITE_WALLETCONNECT_PROJECT_ID;

  if (walletConnectProjectId) {
    const { WalletConnectModule, WalletConnectTargetChain } = await import("@creit.tech/stellar-wallets-kit/modules/wallet-connect");
    modules.push(new WalletConnectModule({
      projectId: walletConnectProjectId,
      metadata: {
        name: "Crossed",
        description: "Private sealed-batch swaps on Stellar testnet.",
        url: window.location.origin,
        icons: [new URL("/crossed-logo.svg", window.location.origin).toString()],
      },
      allowedChains: [WalletConnectTargetChain.TESTNET],
    }));
  }

  return modules;
}

async function ensureKitStarted() {
  if (kitStarted) return;
  if (kitStartPromise) return kitStartPromise;
  kitStartPromise = (async () => {
    StellarWalletsKit.init({
      modules: await buildModules(),
      network: Networks.TESTNET,
      theme: crossedWalletTheme,
      authModal: { showInstallLabel: true, hideUnsupportedWallets: false },
    });
    kitSubscriptions = [
      StellarWalletsKit.on(KitEventType.DISCONNECT, () => {
        walletState.setAddress(null);
      }),
      StellarWalletsKit.on(KitEventType.STATE_UPDATED, (event: KitEventStateUpdated) => {
        const payload = event.payload;
        const update = passiveWalletAddressUpdate({
          currentAddress: walletState.getAddress(),
          observedAddress: payload.address || null,
          observedNetworkPassphrase: payload.networkPassphrase,
          expectedNetworkPassphrase: CONFIG.NETWORK_PASSPHRASE,
        });
        if (update.shouldUpdate) {
          walletState.setAddress(update.address ?? null, update.networkPassphrase);
        }
      }),
    ];
    startWalletAddressPolling();
    kitStarted = true;
  })().catch((error) => {
    kitStartPromise = null;
    throw error;
  });
  return kitStartPromise;
}

async function syncSelectedWalletAddress() {
  if (!hasSelectedWallet()) return;
  try {
    const [{ address }, network] = await Promise.all([
      StellarWalletsKit.selectedModule.getAddress({ skipRequestAccess: true }),
      StellarWalletsKit.getNetwork().catch(() => ({ networkPassphrase: CONFIG.NETWORK_PASSPHRASE })),
    ]);
    const update = passiveWalletAddressUpdate({
      currentAddress: walletState.getAddress(),
      observedAddress: address || null,
      observedNetworkPassphrase: network.networkPassphrase,
      expectedNetworkPassphrase: CONFIG.NETWORK_PASSPHRASE,
    });
    if (update.shouldUpdate) {
      walletState.setAddress(update.address ?? null, update.networkPassphrase);
    }
  } catch {
    // Freighter returns an error here before the app has permission. Ignore it so polling
    // never creates connection noise or forces a disconnect.
  }
}

function startWalletAddressPolling() {
  if (typeof window === "undefined" || walletPollTimer) return;
  const syncVisible = () => {
    if (typeof document === "undefined" || document.visibilityState === "visible") {
      void syncSelectedWalletAddress();
    }
  };
  walletPollTimer = window.setInterval(syncVisible, WALLET_ADDRESS_POLL_MS);
  window.addEventListener("focus", syncVisible);
  document.addEventListener("visibilitychange", syncVisible);
  kitSubscriptions.push(() => {
    if (walletPollTimer) window.clearInterval(walletPollTimer);
    walletPollTimer = null;
    window.removeEventListener("focus", syncVisible);
    document.removeEventListener("visibilitychange", syncVisible);
  });
  void syncSelectedWalletAddress();
}

function walletError(error: unknown, fallback: string) {
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.length > 0) return message;
  }
  if (error && typeof error === "object" && "ext" in error) {
    const ext = (error as { ext?: unknown }).ext;
    if (typeof ext === "string" && ext.length > 0) return ext;
  }
  return fallback;
}

function selectedWalletName() {
  try {
    return StellarWalletsKit.selectedModule.productName;
  } catch {
    return "Selected wallet";
  }
}

function hasSelectedWallet() {
  try {
    return !!StellarWalletsKit.selectedModule;
  } catch {
    return false;
  }
}

async function assertTestnetIfWalletReportsNetwork() {
  try {
    const details = await StellarWalletsKit.getNetwork();
    if (details.networkPassphrase !== CONFIG.NETWORK_PASSPHRASE) {
      throw new Error(`Switch ${selectedWalletName()} to Stellar Testnet before using Crossed.`);
    }
  } catch (error) {
    const message = walletError(error, "");
    if (/does not support.*getNetwork/i.test(message)) return;
    throw error;
  }
}

export function currentWalletAddress() {
  return walletState.getAddress();
}

export function subscribeWalletChanges(listener: WalletStateListener) {
  return walletState.subscribe(listener);
}

export function requireWalletAddress() {
  const address = currentWalletAddress();
  if (!address) throw new Error("Connect a Stellar wallet first.");
  return address;
}

export async function restoreWallet(): Promise<string | null> {
  await ensureKitStarted();
  try {
    if (!hasSelectedWallet()) return null;
    const { address } = await StellarWalletsKit.getAddress();
    if (!address) return null;
    await assertTestnetIfWalletReportsNetwork();
    walletState.setAddress(address, CONFIG.NETWORK_PASSPHRASE);
    return address;
  } catch {
    walletState.setAddress(null);
    return null;
  }
}

export async function connectWallet(): Promise<string> {
  await ensureKitStarted();
  try {
    const { address } = await StellarWalletsKit.authModal();
    walletState.setAddress(address, CONFIG.NETWORK_PASSPHRASE);
    await assertTestnetIfWalletReportsNetwork();
    return address;
  } catch (error) {
    walletState.setAddress(null);
    await StellarWalletsKit.disconnect().catch(() => undefined);
    throw new Error(walletError(error, "Wallet connection was rejected."), { cause: error });
  }
}

export function disconnectWallet() {
  walletState.setAddress(null);
  void ensureKitStarted()
    .then(() => StellarWalletsKit.disconnect())
    .catch(() => undefined);
}

export async function signTransactionXdr(txXdr: string): Promise<string> {
  await ensureKitStarted();
  const address = requireWalletAddress();
  try {
    const signed = await StellarWalletsKit.signTransaction(txXdr, {
      address,
      networkPassphrase: CONFIG.NETWORK_PASSPHRASE,
    });
    if (!signed.signedTxXdr) throw new Error("Wallet did not return a signed transaction.");
    if (signed.signerAddress && signed.signerAddress !== address) {
      throw new Error(`Wallet signed with ${signed.signerAddress}, but Crossed is connected as ${address}.`);
    }
    return signed.signedTxXdr;
  } catch (error) {
    throw new Error(walletError(error, "Wallet did not sign the transaction."), { cause: error });
  }
}

export async function signWalletMessage(message: string): Promise<string> {
  await ensureKitStarted();
  const address = requireWalletAddress();
  try {
    const signed = await StellarWalletsKit.signMessage(message, {
      address,
      networkPassphrase: CONFIG.NETWORK_PASSPHRASE,
    });
    if (!signed.signedMessage) throw new Error("Wallet did not return a signed message.");
    return signed.signedMessage;
  } catch (error) {
    throw new Error(walletError(error, "Wallet did not sign the message."), { cause: error });
  }
}

export async function walletSigningCallback(preimage: xdr.HashIdPreimage) {
  await ensureKitStarted();
  const address = requireWalletAddress();
  try {
    const signed = await StellarWalletsKit.signAuthEntry(preimage.toXDR("base64"), {
      address,
      networkPassphrase: CONFIG.NETWORK_PASSPHRASE,
    });
    if (!signed.signedAuthEntry) throw new Error("Wallet did not return a signed authorization entry.");
    if (signed.signerAddress && signed.signerAddress !== address) {
      throw new Error(`Wallet signed with ${signed.signerAddress}, but Crossed is connected as ${address}.`);
    }
    return {
      signature: Buffer.from(signed.signedAuthEntry, "base64"),
      publicKey: address,
    };
  } catch (error) {
    const message = walletError(error, "Wallet did not sign the authorization entry.");
    if (/signAuthEntry|authorization entry/i.test(message)) {
      throw new Error(`${selectedWalletName()} cannot sign the Soroban authorization entries Crossed needs.`, { cause: error });
    }
    throw new Error(message, { cause: error });
  }
}

export function disposeWalletKit() {
  for (const unsubscribe of kitSubscriptions) unsubscribe();
  kitSubscriptions = [];
  walletPollTimer = null;
  kitStartPromise = null;
  kitStarted = false;
}
