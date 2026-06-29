import test from "node:test";
import assert from "node:assert/strict";

import { assertCoordinatorReady } from "./coordinator-health.ts";

test("assertCoordinatorReady fails before deposits when the coordinator is unreachable", async () => {
  await assert.rejects(
    () => assertCoordinatorReady({
      fetchImpl: async () => { throw new TypeError("fetch failed"); },
      requireDpOrderV2: true,
    }),
    /Coordinator is not reachable/,
  );
});

test("assertCoordinatorReady requires v2 order mode when requested", async () => {
  await assert.rejects(
    () => assertCoordinatorReady({
      fetchImpl: async () => new Response(JSON.stringify({ ok: true, dp_order_v2: false })),
      requireDpOrderV2: true,
    }),
    /DP_ORDER_V2=1/,
  );
});

test("assertCoordinatorReady accepts a healthy v2 coordinator", async () => {
  const health = await assertCoordinatorReady({
    fetchImpl: async (input) => (
      input.endsWith("/auth/check")
        ? new Response(JSON.stringify({ ok: true }))
        : new Response(JSON.stringify({ ok: true, dp_order_v2: true, dp_contract: "C123" }))
    ),
    expectedDpContractId: "C123",
    requireDpOrderV2: true,
  });

  assert.equal(health.dp_contract, "C123");
});

test("assertCoordinatorReady checks coordinator API auth before deposits", async () => {
  const calls: { input: string; authorization?: string }[] = [];
  await assertCoordinatorReady({
    coordinatorUrl: "http://coordinator.test",
    coordinatorApiToken: "local-secret",
    requireDpOrderV2: true,
    fetchImpl: async (input, init) => {
      calls.push({
        input,
        authorization: init?.headers instanceof Headers
          ? init.headers.get("authorization") ?? undefined
          : (init?.headers as Record<string, string> | undefined)?.authorization,
      });
      return input.endsWith("/auth/check")
        ? new Response(JSON.stringify({ ok: true }))
        : new Response(JSON.stringify({ ok: true, dp_order_v2: true }));
    },
  });

  assert.deepEqual(calls, [
    { input: "http://coordinator.test/health", authorization: undefined },
    { input: "http://coordinator.test/auth/check", authorization: "Bearer local-secret" },
  ]);
});

test("assertCoordinatorReady rejects a bad coordinator API token before deposits", async () => {
  await assert.rejects(
    () => assertCoordinatorReady({
      coordinatorApiToken: "wrong-secret",
      fetchImpl: async (input) => (
        input.endsWith("/auth/check")
          ? new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 })
          : new Response(JSON.stringify({ ok: true, dp_order_v2: true }))
      ),
      requireDpOrderV2: true,
    }),
    /Coordinator API auth check failed \(401\).*No funds were moved/,
  );
});
