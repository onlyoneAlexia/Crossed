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
  type ModuleInterface,
} from "@creit.tech/stellar-wallets-kit/types";
import type { xdr } from "@stellar/stellar-sdk";

import { CONFIG } from "./config";

let connectedAddress: string | null = null;
let kitStarted = false;
let kitStartPromise: Promise<void> | null = null;
let disconnectSubscription: (() => void) | null = null;

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
    disconnectSubscription = StellarWalletsKit.on(KitEventType.DISCONNECT, () => {
      connectedAddress = null;
    });
    kitStarted = true;
  })().catch((error) => {
    kitStartPromise = null;
    throw error;
  });
  return kitStartPromise;
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
  return connectedAddress;
}

export function requireWalletAddress() {
  if (!connectedAddress) throw new Error("Connect a Stellar wallet first.");
  return connectedAddress;
}

export async function restoreWallet(): Promise<string | null> {
  await ensureKitStarted();
  try {
    if (!hasSelectedWallet()) return null;
    const { address } = await StellarWalletsKit.getAddress();
    await assertTestnetIfWalletReportsNetwork();
    connectedAddress = address;
    return connectedAddress;
  } catch {
    connectedAddress = null;
    return null;
  }
}

export async function connectWallet(): Promise<string> {
  await ensureKitStarted();
  try {
    const { address } = await StellarWalletsKit.authModal();
    connectedAddress = address;
    await assertTestnetIfWalletReportsNetwork();
    return connectedAddress;
  } catch (error) {
    connectedAddress = null;
    await StellarWalletsKit.disconnect().catch(() => undefined);
    throw new Error(walletError(error, "Wallet connection was rejected."), { cause: error });
  }
}

export function disconnectWallet() {
  connectedAddress = null;
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
    return {
      signature: Buffer.from(signed.signedAuthEntry, "base64"),
      publicKey: signed.signerAddress || address,
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
  disconnectSubscription?.();
  disconnectSubscription = null;
  kitStartPromise = null;
  kitStarted = false;
}
