import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createQuickJS, buildFileSystem } from "./quickjs.js";

// Load the WASM module once for all tests
const wasmPath = join(import.meta.dirname, "..", "qjs-wasi.wasm");
const wasmBuffer = readFileSync(wasmPath);
const wasmModule = new WebAssembly.Module(wasmBuffer);

describe("QuickJS", () => {
  it("should initialize and destroy", () => {
    const qjs = createQuickJS(wasmModule);
    qjs.initArgv();
    qjs.destroy();
  });

  it("should evaluate simple JavaScript", () => {
    const output: string[] = [];
    const qjs = createQuickJS(wasmModule, {
      stdout: (line) => output.push(line),
    });
    qjs.initArgv();
    qjs.eval(`console.log("Hello, World!")`);
    qjs.runLoopSync();
    qjs.destroy();

    expect(output).toContain("Hello, World!");
  });

  it("should handle timers", async () => {
    const output: string[] = [];
    const qjs = createQuickJS(wasmModule, {
      stdout: (line) => output.push(line),
    });
    qjs.initArgv();
    qjs.eval(`
      console.log("before");
      os.setTimeout(() => console.log("timer"), 10);
      console.log("after");
    `);

    // Run the async loop which handles timers properly
    await qjs.runLoop();
    qjs.destroy();

    expect(output).toContain("before");
    expect(output).toContain("after");
    expect(output).toContain("timer");
  });

  it("should evaluate ES modules", () => {
    const output: string[] = [];
    const qjs = createQuickJS(wasmModule, {
      stdout: (line) => output.push(line),
    });
    qjs.initArgv();
    qjs.eval(
      `
      const msg = "Module works!";
      console.log(msg);
    `,
      true,
    );
    qjs.runLoopSync();
    qjs.destroy();

    expect(output).toContain("Module works!");
  });

  it("should support virtual filesystem", () => {
    const output: string[] = [];
    const fs = buildFileSystem(new Map([["test.txt", "file content here"]]));

    const qjs = createQuickJS(wasmModule, {
      stdout: (line) => output.push(line),
      fs,
    });
    qjs.initArgv();
    qjs.eval(`
      const content = std.loadFile("test.txt");
      console.log("File:", content);
    `);
    qjs.runLoopSync();
    qjs.destroy();

    expect(output.some((line) => line.includes("file content here"))).toBe(
      true,
    );
  });

  it("should capture stderr separately", () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const qjs = createQuickJS(wasmModule, {
      stdout: (line) => stdout.push(line),
      stderr: (line) => stderr.push(line),
    });
    qjs.initArgv();
    // In QuickJS, console.error writes to stderr through std.err
    qjs.eval(`
      console.log("to stdout");
      std.err.puts("to stderr\\n");
      std.err.flush();
    `);
    qjs.runLoopSync();
    qjs.destroy();

    expect(stdout).toContain("to stdout");
    expect(stderr).toContain("to stderr");
  });

  it("should handle promises", () => {
    const output: string[] = [];
    const qjs = createQuickJS(wasmModule, {
      stdout: (line) => output.push(line),
    });
    qjs.initArgv();
    qjs.eval(`
      Promise.resolve().then(() => console.log("promise resolved"));
      console.log("sync");
    `);
    qjs.runLoopSync();
    qjs.destroy();

    expect(output).toContain("sync");
    expect(output).toContain("promise resolved");
  });
});

describe("buildFileSystem", () => {
  it("should create nested directories", () => {
    const fs = buildFileSystem(
      new Map([
        ["a/b/c.txt", "content"],
        ["a/d.txt", "other"],
      ]),
    );

    expect(fs.has("a")).toBe(true);
  });

  it("should handle empty paths", () => {
    const fs = buildFileSystem(new Map([["file.txt", "content"]]));
    expect(fs.has("file.txt")).toBe(true);
  });
});
