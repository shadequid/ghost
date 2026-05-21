import { describe, test, expect } from "bun:test";
import type { TextContent } from "@earendil-works/pi-ai";
import { ExecTool } from "../../src/tools/exec.js";

const text = (r: { content: { type: string; text?: string }[] }) =>
  (r.content.filter((c): c is TextContent => c.type === "text")[0]?.text ?? "");

const ID = "test-id";

describe("ExecTool", () => {
  const exec = new ExecTool();

  test("name is exec", () => {
    expect(exec.name).toBe("exec");
  });

  test("executes echo and returns output", async () => {
    const result = await exec.execute(ID, { command: "echo hello" });
    expect(text(result)).toContain("hello");
  });

  test("captures stderr combined with stdout", async () => {
    const result = await exec.execute(ID, { command: "echo out && echo err >&2" });
    const out = text(result);
    expect(out).toContain("out");
    expect(out).toContain("err");
  });

  test("returns exit code", async () => {
    const result = await exec.execute(ID, { command: "echo ok" });
    expect(result.details.exitCode).toBe(0);
  });

  test("does not throw for non-zero exit code, includes in output", async () => {
    const result = await exec.execute(ID, { command: "exit 1" });
    expect(text(result)).toContain("exit code: 1");
    expect(result.details.exitCode).toBe(1);
  });

  test("denies rm -rf command", async () => {
    await expect(exec.execute(ID, { command: "rm -rf /" })).rejects.toThrow(/denied|blocked/i);
  });

  test("denies fork bomb", async () => {
    await expect(exec.execute(ID, { command: ":() { :|:& }; :" })).rejects.toThrow(/denied|blocked/i);
  });

  test("denies shutdown command", async () => {
    await expect(exec.execute(ID, { command: "shutdown -h now" })).rejects.toThrow(/denied|blocked/i);
  });

  test("truncates long output (head+tail)", async () => {
    const result = await exec.execute(ID, { command: "seq 1 50000" });
    const out = text(result);
    expect(out.length).toBeLessThanOrEqual(11_000);
    expect(out).toContain("truncated");
  });

  test("respects working_dir parameter", async () => {
    const result = await exec.execute(ID, { command: "pwd", working_dir: "/tmp" });
    expect(text(result)).toContain("/tmp");
  });

  test("does not leak API keys", async () => {
    process.env["OPENAI_API_KEY"] = "sk-secret12345";
    const result = await exec.execute(ID, { command: "env" });
    expect(text(result)).not.toContain("OPENAI_API_KEY");
    delete process.env["OPENAI_API_KEY"];
  });

  test("denies commands with internal URLs", async () => {
    await expect(exec.execute(ID, { command: "curl http://169.254.169.254/latest/meta-data/" })).rejects.toThrow(/denied.*internal|private/i);
    await expect(exec.execute(ID, { command: "wget http://10.0.0.1/admin" })).rejects.toThrow(/denied.*internal|private/i);
    await expect(exec.execute(ID, { command: "curl http://192.168.1.1/" })).rejects.toThrow(/denied.*internal|private/i);
  });

  test("denies rm --recursive --force", async () => {
    await expect(exec.execute(ID, { command: "rm --recursive --force /" })).rejects.toThrow(/denied|blocked/i);
    await expect(exec.execute(ID, { command: "rm --force /tmp/x" })).rejects.toThrow(/denied|blocked/i);
  });
});
