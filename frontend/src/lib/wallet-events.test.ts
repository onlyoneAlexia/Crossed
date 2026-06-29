import assert from "node:assert/strict";
import test from "node:test";

import { passiveWalletAddressUpdate } from "./wallet-events.ts";

test("passive wallet observation does not switch the active app account", () => {
  const update = passiveWalletAddressUpdate({
    currentAddress: "GACTIVE",
    observedAddress: "GOTHER",
    observedNetworkPassphrase: "Test SDF Network ; September 2015",
    expectedNetworkPassphrase: "Test SDF Network ; September 2015",
  });

  assert.equal(update.shouldUpdate, false);
});

test("passive wallet observation clears the app account on network mismatch", () => {
  const update = passiveWalletAddressUpdate({
    currentAddress: "GACTIVE",
    observedAddress: "GACTIVE",
    observedNetworkPassphrase: "Public Global Stellar Network ; September 2015",
    expectedNetworkPassphrase: "Test SDF Network ; September 2015",
  });

  assert.deepEqual(update, {
    shouldUpdate: true,
    address: null,
    networkPassphrase: "Public Global Stellar Network ; September 2015",
  });
});

test("passive wallet observation can confirm the current active app account", () => {
  const update = passiveWalletAddressUpdate({
    currentAddress: "GACTIVE",
    observedAddress: "GACTIVE",
    observedNetworkPassphrase: "Test SDF Network ; September 2015",
    expectedNetworkPassphrase: "Test SDF Network ; September 2015",
  });

  assert.deepEqual(update, {
    shouldUpdate: true,
    address: "GACTIVE",
    networkPassphrase: "Test SDF Network ; September 2015",
  });
});
