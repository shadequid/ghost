import { describe, test, expect } from "bun:test";
import { WebFetchTool, isPrivateIp } from "../../src/tools/web-fetch.js";

const ID = "test-id";

describe("WebFetchTool", () => {
  const tool = new WebFetchTool();

  test("name is web_fetch", () => {
    expect(tool.name).toBe("web_fetch");
  });

  test("rejects non-http URLs", async () => {
    await expect(tool.execute(ID, { url: "ftp://example.com" })).rejects.toThrow(/http/i);
  });

  test("blocks localhost/internal IPs (SSRF)", async () => {
    await expect(tool.execute(ID, { url: "http://127.0.0.1/" })).rejects.toThrow(/blocked|internal|private/i);
    await expect(tool.execute(ID, { url: "http://localhost/" })).rejects.toThrow(/blocked|internal|private/i);
  });

  test("blocks private IP ranges", async () => {
    await expect(tool.execute(ID, { url: "http://10.0.0.1/" })).rejects.toThrow(/blocked|internal|private/i);
    await expect(tool.execute(ID, { url: "http://192.168.1.1/" })).rejects.toThrow(/blocked|internal|private/i);
    await expect(tool.execute(ID, { url: "http://172.16.0.1/" })).rejects.toThrow(/blocked|internal|private/i);
  });

  test("blocks carrier-grade NAT range (100.64.0.0/10)", () => {
    expect(isPrivateIp("100.64.0.1")).toBe(true);
    expect(isPrivateIp("100.100.0.1")).toBe(true);
    expect(isPrivateIp("100.127.255.255")).toBe(true);
    expect(isPrivateIp("100.63.0.1")).toBe(false);
    expect(isPrivateIp("100.128.0.1")).toBe(false);
  });

  test("has extractMode and maxChars parameters", () => {
    expect(tool.parameters.properties).toHaveProperty("url");
  });
});
