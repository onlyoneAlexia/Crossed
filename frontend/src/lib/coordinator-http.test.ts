import test from "node:test";
import assert from "node:assert/strict";

import { coordinatorHttpError } from "./coordinator-http.ts";

test("coordinatorHttpError includes JSON error bodies", async () => {
  const error = await coordinatorHttpError("dp/activity", new Response(
    JSON.stringify({ error: "wallet signature is invalid" }),
    { status: 401 },
  ));

  assert.equal(error.message, "dp/activity: 401 wallet signature is invalid");
});

test("coordinatorHttpError falls back to status text", async () => {
  const error = await coordinatorHttpError("dp/activity", new Response("", {
    status: 503,
    statusText: "Service Unavailable",
  }));

  assert.equal(error.message, "dp/activity: 503 Service Unavailable");
});
