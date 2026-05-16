/**
 * SSRF regression tests for url-safety.ts.
 *
 * Covers four bypass vectors:
 *  1. IPv4-mapped IPv6 (::ffff:127.0.0.1 form)
 *  2. IPv4-mapped IPv6 (::ffff:hex form)
 *  3. IPv6 private ranges (fc00::/7, fe80::/10, ::1)
 *  4. isPrivateIp handles bracket-wrapped URL literals ([::1])
 *
 * DNS-resolution-level tests (AAAA-only hostname, redirect chain) require
 * a live network or mock DNS and are documented here as manual/integration
 * tests rather than unit tests to keep CI hermetic.
 */

import { describe, test, expect } from "bun:test";
import { isPrivateIp, validateUrlSafety } from "../../src/helpers/url-safety.js";

// ---------------------------------------------------------------------------
// isPrivateIp — unit tests (no I/O)
// ---------------------------------------------------------------------------

describe("isPrivateIp", () => {
  describe("IPv4 private ranges", () => {
    test("127.0.0.1 loopback", () => expect(isPrivateIp("127.0.0.1")).toBe(true));
    test("127.255.255.255 loopback", () => expect(isPrivateIp("127.255.255.255")).toBe(true));
    test("10.0.0.1 class-A private", () => expect(isPrivateIp("10.0.0.1")).toBe(true));
    test("10.255.255.255 class-A private", () => expect(isPrivateIp("10.255.255.255")).toBe(true));
    test("172.16.0.1 class-B private", () => expect(isPrivateIp("172.16.0.1")).toBe(true));
    test("172.31.255.255 class-B private", () => expect(isPrivateIp("172.31.255.255")).toBe(true));
    test("172.15.255.255 NOT class-B private", () => expect(isPrivateIp("172.15.255.255")).toBe(false));
    test("172.32.0.1 NOT class-B private", () => expect(isPrivateIp("172.32.0.1")).toBe(false));
    test("192.168.1.1 class-C private", () => expect(isPrivateIp("192.168.1.1")).toBe(true));
    test("169.254.0.1 link-local", () => expect(isPrivateIp("169.254.0.1")).toBe(true));
    test("169.254.169.254 AWS metadata", () => expect(isPrivateIp("169.254.169.254")).toBe(true));
    test("100.64.0.1 CGNAT", () => expect(isPrivateIp("100.64.0.1")).toBe(true));
    test("100.127.255.255 CGNAT", () => expect(isPrivateIp("100.127.255.255")).toBe(true));
    test("100.63.255.255 NOT CGNAT", () => expect(isPrivateIp("100.63.255.255")).toBe(false));
    test("100.128.0.0 NOT CGNAT", () => expect(isPrivateIp("100.128.0.0")).toBe(false));
    test("8.8.8.8 public", () => expect(isPrivateIp("8.8.8.8")).toBe(false));
    test("1.1.1.1 public", () => expect(isPrivateIp("1.1.1.1")).toBe(false));
  });

  describe("IPv6 private ranges", () => {
    test("::1 loopback", () => expect(isPrivateIp("::1")).toBe(true));
    test(":: unspecified", () => expect(isPrivateIp("::")).toBe(true));
    test("fe80::1 link-local", () => expect(isPrivateIp("fe80::1")).toBe(true));
    test("fe80::dead:beef link-local", () => expect(isPrivateIp("fe80::dead:beef")).toBe(true));
    test("fc00::1 unique-local", () => expect(isPrivateIp("fc00::1")).toBe(true));
    test("fd00::1 unique-local (fd prefix)", () => expect(isPrivateIp("fd00::1")).toBe(true));
    test("ff02::1 multicast", () => expect(isPrivateIp("ff02::1")).toBe(true));
    test("2001:db8::1 public (documentation)", () => expect(isPrivateIp("2001:db8::1")).toBe(false));
    test("2606:4700::1 public (Cloudflare)", () => expect(isPrivateIp("2606:4700::1")).toBe(false));
  });

  describe("IPv4-mapped IPv6", () => {
    test("::ffff:127.0.0.1 dotted form blocked", () => expect(isPrivateIp("::ffff:127.0.0.1")).toBe(true));
    test("::ffff:10.0.0.1 dotted form blocked", () => expect(isPrivateIp("::ffff:10.0.0.1")).toBe(true));
    test("::ffff:169.254.169.254 AWS metadata blocked", () => expect(isPrivateIp("::ffff:169.254.169.254")).toBe(true));
    test("::ffff:192.168.1.1 private blocked", () => expect(isPrivateIp("::ffff:192.168.1.1")).toBe(true));
    // ::ffff:7f00:0001 == ::ffff:127.0.0.1 in hex form
    test("::ffff:7f00:0001 hex form blocked", () => expect(isPrivateIp("::ffff:7f00:0001")).toBe(true));
    // ::ffff:0808:0808 == ::ffff:8.8.8.8 — public
    test("::ffff:0808:0808 mapped public IP allowed", () => expect(isPrivateIp("::ffff:0808:0808")).toBe(false));
  });

  describe("bracket-wrapped URL literals", () => {
    test("[::1] blocked", () => expect(isPrivateIp("[::1]")).toBe(true));
    test("[::ffff:127.0.0.1] blocked", () => expect(isPrivateIp("[::ffff:127.0.0.1]")).toBe(true));
    test("[fe80::1] blocked", () => expect(isPrivateIp("[fe80::1]")).toBe(true));
    test("[2606:4700::1] public allowed", () => expect(isPrivateIp("[2606:4700::1]")).toBe(false));
  });
});

// ---------------------------------------------------------------------------
// validateUrlSafety — URL-level checks (no DNS I/O needed for IP literals)
// ---------------------------------------------------------------------------

describe("validateUrlSafety — IP literal rejection", () => {
  test("rejects http://127.0.0.1/", async () => {
    await expect(validateUrlSafety("http://127.0.0.1/")).rejects.toThrow(/[Bb]locked|private/);
  });

  test("rejects http://[::1]/", async () => {
    await expect(validateUrlSafety("http://[::1]/")).rejects.toThrow(/[Bb]locked|private/);
  });

  test("rejects http://[::ffff:127.0.0.1]/ (IPv4-mapped IPv6)", async () => {
    await expect(validateUrlSafety("http://[::ffff:127.0.0.1]/")).rejects.toThrow(/[Bb]locked|private/);
  });

  test("rejects http://[fe80::1]/", async () => {
    await expect(validateUrlSafety("http://[fe80::1]/")).rejects.toThrow(/[Bb]locked|private/);
  });

  test("rejects http://169.254.169.254/ (AWS metadata)", async () => {
    await expect(validateUrlSafety("http://169.254.169.254/")).rejects.toThrow(/[Bb]locked|private/);
  });

  test("rejects ftp:// scheme", async () => {
    await expect(validateUrlSafety("ftp://example.com")).rejects.toThrow(/scheme/i);
  });

  test("rejects localhost", async () => {
    await expect(validateUrlSafety("http://localhost/")).rejects.toThrow(/[Bb]locked|private/);
  });
});

/*
 * DNS-level tests (AAAA-only hostname, redirect-to-metadata) require either
 * a live network or a mock DNS resolver. They are documented here as a
 * reference for future integration test work:
 *
 *   - A hostname that resolves ONLY via AAAA to fc00::1 should be rejected.
 *   - A redirect chain from a public URL to http://169.254.169.254/ should
 *     be rejected (tested via the manual redirect walker in web-fetch.ts).
 *   - A hostname with mixed A (public) + AAAA (private) records should still
 *     be rejected if any resolved address is private.
 */
