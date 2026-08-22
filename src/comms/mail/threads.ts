const PREFIX = /^(re|fwd|fw|enc|res|aw|sv|rif)\s*:\s*/i;

export function normalizeSubject(subject: string): string {
  let s = subject.normalize("NFD").replace(/\p{M}/gu, "").trim();
  for (let i = 0; i < 8; i++) {
    const next = s.replace(PREFIX, "").trim();
    if (next === s) break;
    s = next;
  }
  return s.toLowerCase();
}

export function normalizeMessageId(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = raw.trim().match(/<?([^<>\s]+@[^<>\s]+)>?/);
  if (m?.[1]) return m[1].toLowerCase();
  const t = raw.trim().replace(/^<|>$/g, "");
  return t ? t.toLowerCase() : null;
}

export function parseAddressList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const emails = raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [];
  return [...new Set(emails.map((e) => e.toLowerCase()))].sort();
}

export function isFromMe(fromHeader: string, myAddresses: string[]): boolean {
  const mine = new Set(myAddresses.map((a) => a.toLowerCase()));
  return parseAddressList(fromHeader).some((e) => mine.has(e));
}

export function participantKey(fromHeader: string, toHeader: string): string {
  return [...new Set([...parseAddressList(fromHeader), ...parseAddressList(toHeader)])]
    .sort()
    .join(",");
}

export function parseReferences(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[\s,]+/)
    .map((p) => normalizeMessageId(p))
    .filter((x): x is string => Boolean(x));
}

export interface ThreadSeed {
  messageId: string | null;
  inReplyTo: string | null;
  references: string[];
  fromHeader: string;
  toHeader: string;
  subject: string;
}

/**
 * Prefer existing thread via In-Reply-To / References lookup.
 * Fallback: first reference, else own Message-ID, else subject+participants.
 */
export function resolveThreadKey(
  seed: ThreadSeed,
  lookupByMessageId: (messageId: string) => string | undefined
): string {
  const reply = normalizeMessageId(seed.inReplyTo);
  if (reply) {
    const existing = lookupByMessageId(reply);
    if (existing) return existing;
  }
  for (const ref of seed.references) {
    const existing = lookupByMessageId(ref);
    if (existing) return existing;
  }
  if (seed.references[0]) return `mid:${seed.references[0]}`;
  if (reply) return `mid:${reply}`;
  const mid = normalizeMessageId(seed.messageId);
  if (mid) return `mid:${mid}`;
  const subj = normalizeSubject(seed.subject);
  const people = participantKey(seed.fromHeader, seed.toHeader);
  return `subj:${people}:${subj}`;
}

export interface ThreadMessage {
  fromMe: boolean;
  dateMs: number;
}

export function computeUnanswered(messages: ThreadMessage[]): {
  lastInboundAt: number | null;
  lastOutboundAt: number | null;
  unanswered: boolean;
} {
  let lastInboundAt: number | null = null;
  let lastOutboundAt: number | null = null;
  for (const m of messages) {
    if (m.fromMe) {
      if (lastOutboundAt === null || m.dateMs > lastOutboundAt) lastOutboundAt = m.dateMs;
    } else if (lastInboundAt === null || m.dateMs > lastInboundAt) {
      lastInboundAt = m.dateMs;
    }
  }
  const unanswered =
    lastInboundAt !== null && (lastOutboundAt === null || lastInboundAt > lastOutboundAt);
  return { lastInboundAt, lastOutboundAt, unanswered };
}
