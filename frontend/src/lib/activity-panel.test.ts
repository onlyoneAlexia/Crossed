import assert from "node:assert/strict";
import test from "node:test";

import { ACTIVITY_DEFAULT_OPEN, activityStatusLabel, activitySummary } from "./activity-panel.ts";

test("activity panel is collapsed by default", () => {
  assert.equal(ACTIVITY_DEFAULT_OPEN, false);
});

test("activity summary counts pending orders and fills", () => {
  assert.equal(activitySummary(0, 0), "No swaps");
  assert.equal(activitySummary(1, 0), "1 pending");
  assert.equal(activitySummary(2, 0), "2 pending");
  assert.equal(activitySummary(0, 1), "1 fill");
  assert.equal(activitySummary(2, 3), "2 pending · 3 fills");
});

test("activity status trigger describes the modal state", () => {
  assert.equal(activityStatusLabel("1 pending · 5 fills"), "Open activity status: 1 pending · 5 fills");
  assert.equal(activityStatusLabel("No swaps"), "Open activity status: No swaps");
});
