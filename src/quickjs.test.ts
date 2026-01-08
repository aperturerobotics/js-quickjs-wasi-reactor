import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createQuickJS, buildFileSystem } from "./quickjs.js";
import { PollableStdin } from "./fs-mem.js";

// Load the WASM module once for all tests
const wasmPath = join(import.meta.dirname, "..", "qjs-wasi.wasm");
const wasmBuffer = readFileSync(wasmPath);
const wasmModule = new WebAssembly.Module(wasmBuffer);

describe("QuickJS", () => {
  it("should initialize and destroy", () => {
    const qjs = createQuickJS(wasmModule);
    qjs.init();
    qjs.destroy();
  });

  it("should evaluate simple JavaScript", () => {
    const output: string[] = [];
    const qjs = createQuickJS(wasmModule, {
      stdout: (line) => output.push(line),
    });
    qjs.init();
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
    qjs.init(["qjs", "--std"]);
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
    qjs.init();
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
    qjs.init(["qjs", "--std"]);
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
    qjs.init(["qjs", "--std"]);
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
    qjs.init();
    qjs.eval(`
      Promise.resolve().then(() => console.log("promise resolved"));
      console.log("sync");
    `);
    qjs.runLoopSync();
    qjs.destroy();

    expect(output).toContain("sync");
    expect(output).toContain("promise resolved");
  });

  it("should support dynamic import()", async () => {
    const output: string[] = [];
    const fs = buildFileSystem(
      new Map([
        ["lib.js", `export const greeting = "Hello from dynamic import!";`],
      ]),
    );

    const qjs = createQuickJS(wasmModule, {
      stdout: (line) => output.push(line),
      fs,
    });
    qjs.init(["qjs", "--std"]);
    qjs.eval(
      `
      async function main() {
        const lib = await import('./lib.js');
        console.log(lib.greeting);
      }
      main();
    `,
      true,
    );
    await qjs.runLoop();
    qjs.destroy();

    expect(output).toContain("Hello from dynamic import!");
  });

  it("should support static import from filesystem", () => {
    const output: string[] = [];
    const fs = buildFileSystem(
      new Map([
        ["utils.js", `export function greet(name) { return "Hi " + name; }`],
      ]),
    );

    const qjs = createQuickJS(wasmModule, {
      stdout: (line) => output.push(line),
      fs,
    });
    qjs.init(["qjs", "--std"]);
    qjs.eval(
      `
      import { greet } from './utils.js';
      console.log(greet("World"));
    `,
      true,
    );
    qjs.runLoopSync();
    qjs.destroy();

    expect(output).toContain("Hi World");
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

describe("PollableStdin", () => {
  it("should invoke wakeCallback when data is pushed", () => {
    const stdin = new PollableStdin();
    const wakeCallback = vi.fn();

    stdin.onWake(wakeCallback);
    expect(wakeCallback).not.toHaveBeenCalled();

    stdin.push(new TextEncoder().encode("hello"));
    expect(wakeCallback).toHaveBeenCalledTimes(1);

    stdin.push(new TextEncoder().encode("world"));
    expect(wakeCallback).toHaveBeenCalledTimes(2);
  });

  it("should invoke wakeCallback when stdin is closed", () => {
    const stdin = new PollableStdin();
    const wakeCallback = vi.fn();

    stdin.onWake(wakeCallback);
    expect(wakeCallback).not.toHaveBeenCalled();

    stdin.close();
    expect(wakeCallback).toHaveBeenCalledTimes(1);
  });

  it("should allow clearing the wakeCallback", () => {
    const stdin = new PollableStdin();
    const wakeCallback = vi.fn();

    stdin.onWake(wakeCallback);
    stdin.push(new TextEncoder().encode("hello"));
    expect(wakeCallback).toHaveBeenCalledTimes(1);

    stdin.onWake(null);
    stdin.push(new TextEncoder().encode("world"));
    expect(wakeCallback).toHaveBeenCalledTimes(1); // still 1, not called again
  });

  it("should not invoke wakeCallback when pushing to closed stdin", () => {
    const stdin = new PollableStdin();
    const wakeCallback = vi.fn();

    stdin.close();
    stdin.onWake(wakeCallback);

    stdin.push(new TextEncoder().encode("ignored"));
    expect(wakeCallback).not.toHaveBeenCalled();
  });
});

describe("QuickJS.onStdinWake", () => {
  it("should invoke callback when stdin data is pushed", () => {
    const wakeCallback = vi.fn();
    const qjs = createQuickJS(wasmModule);
    qjs.init();

    qjs.onStdinWake(wakeCallback);
    expect(wakeCallback).not.toHaveBeenCalled();

    qjs.pushStdin(new TextEncoder().encode("input data"));
    expect(wakeCallback).toHaveBeenCalledTimes(1);

    qjs.destroy();
  });

  it("should invoke callback when instance is destroyed (stdin closed)", () => {
    const wakeCallback = vi.fn();
    const qjs = createQuickJS(wasmModule);
    qjs.init();

    qjs.onStdinWake(wakeCallback);
    expect(wakeCallback).not.toHaveBeenCalled();

    // destroy() internally closes stdin, which should trigger the callback
    qjs.destroy();
    expect(wakeCallback).toHaveBeenCalledTimes(1);
  });

  it("should allow clearing the callback", () => {
    const wakeCallback = vi.fn();
    const qjs = createQuickJS(wasmModule);
    qjs.init();

    qjs.onStdinWake(wakeCallback);
    qjs.pushStdin(new TextEncoder().encode("first"));
    expect(wakeCallback).toHaveBeenCalledTimes(1);

    qjs.onStdinWake(null);
    qjs.pushStdin(new TextEncoder().encode("second"));
    expect(wakeCallback).toHaveBeenCalledTimes(1); // still 1

    qjs.destroy();
  });
});
