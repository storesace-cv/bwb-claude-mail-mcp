import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeUnanswered,
  normalizeSubject,
  resolveThreadKey,
} from "./threads.js";

describe("normalizeSubject", () => {
  it("strips Re:/Fwd: prefixes", () => {
    assert.equal(normalizeSubject("Re: Re: Factura 12"), "factura 12");
    assert.equal(normalizeSubject("FWD: Hello"), "hello");
  });
});

describe("resolveThreadKey", () => {
  it("uses existing thread from In-Reply-To", () => {
    const key = resolveThreadKey(
      {
        messageId: "b@x",
        inReplyTo: "<a@x>",
        references: [],
        fromHeader: "a@x.com",
        toHeader: "me@x.com",
        subject: "Re: Hi",
      },
      (id) => (id === "a@x" ? "mid:a@x" : undefined)
    );
    assert.equal(key, "mid:a@x");
  });

  it("falls back to subject+participants", () => {
    const key = resolveThreadKey(
      {
        messageId: null,
        inReplyTo: null,
        references: [],
        fromHeader: "Bob <b@x.com>",
        toHeader: "me@x.com",
        subject: "Re: Hello",
      },
      () => undefined
    );
    assert.equal(key, "subj:b@x.com,me@x.com:hello");
  });
});

describe("computeUnanswered", () => {
  it("inbound after our reply is unanswered", () => {
    const r = computeUnanswered([
      { fromMe: false, dateMs: 1 },
      { fromMe: true, dateMs: 2 },
      { fromMe: false, dateMs: 3 },
    ]);
    assert.equal(r.unanswered, true);
  });

  it("our reply after inbound is answered", () => {
    const r = computeUnanswered([
      { fromMe: false, dateMs: 1 },
      { fromMe: true, dateMs: 2 },
    ]);
    assert.equal(r.unanswered, false);
  });

  it("inbound without reply is unanswered", () => {
    const r = computeUnanswered([{ fromMe: false, dateMs: 1 }]);
    assert.equal(r.unanswered, true);
  });
});
