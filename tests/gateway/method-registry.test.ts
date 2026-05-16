import { describe, test, expect } from "bun:test";
import { MethodRegistry, MethodNotFoundError, type MethodContext } from "../../src/gateway/method-registry.js";

function makeCtx(): MethodContext {
  return { clientId: "c1", sessionId: "s1", broadcast: () => {}, emit: () => {} };
}

describe("MethodRegistry", () => {
  test("register and dispatch a method", async () => {
    const reg = new MethodRegistry();
    reg.register("health", async () => ({ status: "ok" }));
    const result = await reg.dispatch("health", makeCtx(), {});
    expect(result).toEqual({ status: "ok" });
  });

  test("dispatch passes context and payload", async () => {
    const reg = new MethodRegistry();
    reg.register("echo", async (ctx, payload) => ({ clientId: ctx.clientId, payload }));
    const result = await reg.dispatch("echo", makeCtx(), { msg: "hi" });
    expect(result).toEqual({ clientId: "c1", payload: { msg: "hi" } });
  });

  test("dispatch throws MethodNotFoundError for unknown method", async () => {
    const reg = new MethodRegistry();
    try {
      await reg.dispatch("nope", makeCtx(), {});
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(MethodNotFoundError);
    }
  });

  test("has() checks method existence", () => {
    const reg = new MethodRegistry();
    reg.register("foo", async () => ({}));
    expect(reg.has("foo")).toBe(true);
    expect(reg.has("bar")).toBe(false);
  });

  test("methods() lists registered methods", () => {
    const reg = new MethodRegistry();
    reg.register("a", async () => ({}));
    reg.register("b", async () => ({}));
    expect(reg.methods().sort()).toEqual(["a", "b"]);
  });
});
