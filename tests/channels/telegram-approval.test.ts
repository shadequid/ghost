import { describe, it, expect, test } from "bun:test";
import {
  parseCallbackData,
  matchTextDecision,
  formatApprovalPreview,
  validateApprovalCallback,
  resolveApprovalCallback,
} from "../../src/channels/telegram/approval.js";

describe("parseCallbackData", () => {
  it("parses approve callback", () => {
    const id = "12345678-1234-1234-1234-123456789abc";
    expect(parseCallbackData(`approve:${id}`)).toEqual({ decision: "approved", approvalId: id });
  });
  it("parses reject callback", () => {
    const id = "12345678-1234-1234-1234-123456789abc";
    expect(parseCallbackData(`reject:${id}`)).toEqual({ decision: "rejected", approvalId: id });
  });
  it("returns null for malformed data", () => {
    expect(parseCallbackData("garbage")).toBeNull();
    expect(parseCallbackData("approve:not-a-uuid")).toBeNull();
  });
});

describe("matchTextDecision", () => {
  it.each(["yes", "YES", "y", "Y", "confirm"])("matches approved: %s", (t) => {
    expect(matchTextDecision(t)).toBe("approved");
  });
  it.each(["no", "N", "cancel"])("matches rejected: %s", (t) => {
    expect(matchTextDecision(t)).toBe("rejected");
  });
  it("does not match ambiguous words 'ok' or 'stop'", () => {
    expect(matchTextDecision("ok")).toBeNull();
    expect(matchTextDecision("OK")).toBeNull();
    expect(matchTextDecision("stop")).toBeNull();
    expect(matchTextDecision("STOP")).toBeNull();
  });
  it("returns null on other input", () => {
    expect(matchTextDecision("yeah maybe")).toBeNull();
    expect(matchTextDecision("")).toBeNull();
  });
});

describe("formatApprovalPreview", () => {
  it("escapes HTML in user-supplied fields", () => {
    const out = formatApprovalPreview({
      action: "place_order", actionLabel: "<script>", summary: "buy 1 <HYPE>",
      details: { size: "1" },
    });
    expect(out).toContain("&lt;script&gt;");
    expect(out).toContain("buy 1 &lt;HYPE&gt;");
  });
});

describe("validateApprovalCallback", () => {
  test("accepts telegram-origin", () => {
    expect(validateApprovalCallback({ channel: "telegram", chatId: "1" })).toEqual({ ok: true });
  });
  test("rejects web-origin with explicit reason", () => {
    const res = validateApprovalCallback({ channel: "web", chatId: "1" });
    expect(res).toEqual({ ok: false, reason: "approval belongs to another channel" });
  });
  test("rejects null origin as unknown/expired", () => {
    const res = validateApprovalCallback(null);
    expect(res).toEqual({ ok: false, reason: "unknown or expired approval" });
  });
});

describe("resolveApprovalCallback", () => {
  const telegramOrigin = { channel: "telegram", chatId: "1" };
  const webOrigin = { channel: "web", chatId: "2" };
  const validId = "12345678-1234-1234-1234-123456789abc";

  test("resolves when origin is telegram", () => {
    const res = resolveApprovalCallback(`approve:${validId}`, () => telegramOrigin);
    expect(res).toEqual({ kind: "resolve", approvalId: validId, decision: "approved" });
  });

  test("resolves reject decision correctly", () => {
    const res = resolveApprovalCallback(`reject:${validId}`, () => telegramOrigin);
    expect(res).toEqual({ kind: "resolve", approvalId: validId, decision: "rejected" });
  });

  test("rejects when origin is web (cross-channel leak)", () => {
    const res = resolveApprovalCallback(`approve:${validId}`, () => webOrigin);
    expect(res).toEqual({ kind: "reject", reply: "approval belongs to another channel" });
  });

  test("rejects when origin is unknown (expired or unseen id)", () => {
    const res = resolveApprovalCallback(`approve:${validId}`, () => null);
    expect(res).toEqual({ kind: "reject", reply: "unknown or expired approval" });
  });

  test("ignores malformed callback data", () => {
    const res = resolveApprovalCallback("garbage", () => telegramOrigin);
    expect(res).toEqual({ kind: "ignore" });
  });

  test("ignores approve with non-uuid approvalId", () => {
    const res = resolveApprovalCallback("approve:not-a-uuid", () => telegramOrigin);
    expect(res).toEqual({ kind: "ignore" });
  });
});
