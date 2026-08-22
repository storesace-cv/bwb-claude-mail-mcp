import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { filterAllowedJids } from "./store.js";

describe("filterAllowedJids", () => {
  it("drops JIDs outside the allowlist", () => {
    const kept = filterAllowedJids(
      new Set(["120363@g.us"]),
      [
        { chat_jid: "120363@g.us", msg_id: "1" },
        { chat_jid: "other@g.us", msg_id: "2" },
      ]
    );
    assert.equal(kept.length, 1);
    assert.equal(kept[0].msg_id, "1");
  });
});
