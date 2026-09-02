import assert from "node:assert/strict";
import { test } from "node:test";

import { classifyIncident, countConsecutiveFailures, type MarketPriceRunRecord } from "./market-price-notifications";

const BEFORE_DEADLINE = new Date("2026-09-02T20:00:00Z");
const AFTER_DEADLINE = new Date("2026-09-03T03:00:00Z");
const DEADLINE = new Date("2026-09-03T02:00:00Z");

function run(status: MarketPriceRunRecord["status"], startedAt: Date): MarketPriceRunRecord {
  return { status, startedAt };
}

test("1. a primary failure with no prior incident opens one", () => {
  assert.equal(classifyIncident([], run("FAILED", BEFORE_DEADLINE), DEADLINE), "opened");
  assert.equal(
    classifyIncident([run("SUCCESS", BEFORE_DEADLINE)], run("FAILED", BEFORE_DEADLINE), DEADLINE),
    "opened",
  );
});

test("2. recovery keeps retrying silently through repeated transient failures before the deadline (no spam)", () => {
  const history = [run("FAILED", BEFORE_DEADLINE), run("FAILED", BEFORE_DEADLINE), run("SUCCESS", BEFORE_DEADLINE)];

  assert.equal(classifyIncident(history, run("FAILED", BEFORE_DEADLINE), DEADLINE), "none");
  assert.equal(classifyIncident(history, run("SKIPPED", BEFORE_DEADLINE), DEADLINE), "none");
});

test("3 & 5. recovery stops immediately and generates a recovery event once a complete dataset is obtained", () => {
  const history = [run("FAILED", BEFORE_DEADLINE), run("FAILED", BEFORE_DEADLINE)];

  assert.equal(classifyIncident(history, run("SUCCESS", BEFORE_DEADLINE), DEADLINE), "closed");
});

test("4. an incomplete (still-FAILED) result never closes the incident", () => {
  const history = [run("FAILED", BEFORE_DEADLINE)];

  assert.notEqual(classifyIncident(history, run("FAILED", BEFORE_DEADLINE), DEADLINE), "closed");
  assert.equal(classifyIncident(history, run("FAILED", BEFORE_DEADLINE), DEADLINE), "none");
});

test("6. an incident still open once the hard deadline passes escalates exactly once", () => {
  const history = [run("FAILED", BEFORE_DEADLINE), run("FAILED", BEFORE_DEADLINE)];

  assert.equal(classifyIncident(history, run("FAILED", AFTER_DEADLINE), DEADLINE), "escalated");
});

test("7. escalation does not repeat on every retry after the deadline (no spam)", () => {
  const history = [
    run("FAILED", AFTER_DEADLINE), // already escalated on this run
    run("FAILED", BEFORE_DEADLINE),
    run("FAILED", BEFORE_DEADLINE),
  ];

  assert.equal(classifyIncident(history, run("FAILED", AFTER_DEADLINE), DEADLINE), "none");
});

test("a routine 'not published yet' before the deadline never opens or closes an incident", () => {
  assert.equal(classifyIncident([], run("SKIPPED", BEFORE_DEADLINE), DEADLINE), "none");
  assert.equal(
    classifyIncident([run("SUCCESS", BEFORE_DEADLINE)], run("SKIPPED", BEFORE_DEADLINE), DEADLINE),
    "none",
  );
});

test("a 'not published yet' result still escalates once the deadline passes", () => {
  const history = [run("SKIPPED", BEFORE_DEADLINE), run("SKIPPED", BEFORE_DEADLINE)];

  assert.equal(classifyIncident(history, run("SKIPPED", AFTER_DEADLINE), DEADLINE), "escalated");
});

test("a healthy day (SUCCESS after SUCCESS) never alerts", () => {
  assert.equal(classifyIncident([run("SUCCESS", BEFORE_DEADLINE)], run("SUCCESS", BEFORE_DEADLINE), DEADLINE), "none");
  assert.equal(classifyIncident([], run("SUCCESS", BEFORE_DEADLINE), DEADLINE), "none");
});

test("countConsecutiveFailures counts the leading run of FAILED/SKIPPED statuses", () => {
  assert.equal(countConsecutiveFailures(["FAILED", "SKIPPED", "FAILED", "SUCCESS", "FAILED"]), 3);
  assert.equal(countConsecutiveFailures(["SUCCESS", "FAILED"]), 0);
  assert.equal(countConsecutiveFailures([]), 0);
});
