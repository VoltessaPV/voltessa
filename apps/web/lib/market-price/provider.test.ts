import assert from "node:assert/strict";
import { test } from "node:test";

import { floorToInterval } from "./provider";

test("floorToInterval floors to the start of the current 15-minute interval", () => {
  assert.equal(
    floorToInterval(new Date("2026-09-02T14:07:33.000Z"), 15).toISOString(),
    "2026-09-02T14:00:00.000Z",
  );
});

test("floorToInterval leaves an exact interval boundary unchanged", () => {
  assert.equal(
    floorToInterval(new Date("2026-09-02T14:15:00.000Z"), 15).toISOString(),
    "2026-09-02T14:15:00.000Z",
  );
});

test("floorToInterval floors the last second of an interval down, not up", () => {
  assert.equal(
    floorToInterval(new Date("2026-09-02T14:29:59.999Z"), 15).toISOString(),
    "2026-09-02T14:15:00.000Z",
  );
});
