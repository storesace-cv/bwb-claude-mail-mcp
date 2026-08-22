import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { shouldFireDaily } from "./lisbon.js";

describe("shouldFireDaily", () => {
  it("fires weekday after hour if not yet run", () => {
    const now = new Date("2026-08-21T07:05:00+01:00");
    assert.equal(
      shouldFireDaily({ lastDateKey: null, hour: 7, weekdaysOnly: true, now }),
      true
    );
  });

  it("does not fire twice the same Lisbon day", () => {
    const now = new Date("2026-08-21T10:00:00+01:00");
    assert.equal(
      shouldFireDaily({ lastDateKey: "2026-08-21", hour: 7, weekdaysOnly: true, now }),
      false
    );
  });

  it("skips Saturday", () => {
    const now = new Date("2026-08-22T10:00:00+01:00");
    assert.equal(
      shouldFireDaily({ lastDateKey: null, hour: 7, weekdaysOnly: true, now }),
      false
    );
  });
});
