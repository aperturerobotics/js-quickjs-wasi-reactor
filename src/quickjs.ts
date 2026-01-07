// QuickJS WASI Reactor harness for JavaScript
// This module provides a high-level API for running QuickJS in reactor mode.

import { WASI, WASIProcExit } from "./wasi.js";
import {
  ConsoleStdout,
  PollableStdin,
  PreopenDirectory,
  File,
  Directory,
  DevOut,
  DevDirectory,
} from "./fs-mem.js";
import type { Fd } from "./fd.js";

/** Loop result constants from js_std_loop_once() */
export const LOOP_IDLE = -1;
export const LOOP_ERROR = -2;

/** JS_EVAL flags */
const JS_EVAL_TYPE_GLOBAL = 0;
const JS_EVAL_TYPE_MODULE = 1;

/** JSValue tag constants */
const JS_TAG_EXCEPTION = 6;

/** QuickJS reactor exports interface - raw C API */
export interface QuickJSReactorExports {
  /** Standard WASI reactor initialization */
  _initialize(): void;
  /** WebAssembly memory */
  memory: WebAssembly.Memory;

  // Memory management
  malloc(size: number): number;
  free(ptr: number): void;

  // Core runtime
  JS_NewRuntime(): number;
  JS_FreeRuntime(rt: number): void;
  JS_NewContext(rt: number): number;
  JS_FreeContext(ctx: number): void;

  // Evaluation - returns JSValue as bigint (i64)
  JS_Eval(
    ctx: number,
    input: number,
    input_len: number,
    filename: number,
    eval_flags: number,
  ): bigint;

  // Value management
  JS_FreeValue(ctx: number, val: bigint): void;

  // Standard library
  js_init_module_std(ctx: number, module_name: number): number;
  js_init_module_os(ctx: number, module_name: number): number;
  js_init_module_bjson(ctx: number, module_name: number): number;
  js_std_init_handlers(rt: number): void;
  js_std_free_handlers(rt: number): void;
  js_std_add_helpers(ctx: number, argc: number, argv: number): void;
  js_std_loop_once(ctx: number): number;
  js_std_poll_io(ctx: number, timeout_ms: number): number;
  js_std_dump_error(ctx: number): void;
}

/** Options for creating a QuickJS instance */
export interface QuickJSOptions {
  /** WASI arguments (default: ['qjs']) */
  args?: string[];
  /** Environment variables as key=value strings */
  env?: string[];
  /** Enable debug logging */
  debug?: boolean;
  /** Custom stdout handler (default: console.log) */
  stdout?: (line: string) => void;
  /** Custom stderr handler (default: console.error) */
  stderr?: (line: string) => void;
  /** Virtual filesystem root contents */
  fs?: Map<string, File | Directory>;
  /** Handler for data written to /dev/out */
  onDevOut?: (data: Uint8Array) => void;
  /** Custom stdin that data can be pushed to */
  stdin?: PollableStdin;
}

/**
 * QuickJS provides a high-level API for running JavaScript in QuickJS WASI reactor mode.
 */
export class QuickJS {
  private wasi: WASI;
  private instance: WebAssembly.Instance | null = null;
  private exports: QuickJSReactorExports | null = null;
  private running = false;
  private exitCode = 0;
  private stdin: PollableStdin;

  // Runtime state
  private rtPtr = 0;
  private ctxPtr = 0;

  constructor(wasmModule: WebAssembly.Module, options: QuickJSOptions = {}) {
    const args = options.args ?? ["qjs"];
    const env = options.env ?? [];
    const debug = options.debug ?? false;

    // Create stdin
    this.stdin = options.stdin ?? new PollableStdin();

    // Create stdout/stderr
    const stdout = ConsoleStdout.lineBuffered(
      options.stdout ?? ((line) => console.log("[QuickJS]", line)),
    );
    const stderr = ConsoleStdout.lineBuffered(
      options.stderr ?? ((line) => console.error("[QuickJS]", line)),
    );

    // Build filesystem
    const rootContents = options.fs ?? new Map<string, File | Directory>();
    const rootDir = new PreopenDirectory("/", rootContents);

    // Build file descriptors
    const fds: Fd[] = [
      this.stdin, // fd 0 - stdin
      stdout, // fd 1 - stdout
      stderr, // fd 2 - stderr
      rootDir, // fd 3 - preopened /
    ];

    // Add /dev directory with /dev/out if onDevOut is provided
    if (options.onDevOut) {
      const devOut = new DevOut(options.onDevOut);
      const devDir = new DevDirectory("/dev", new Map([["out", devOut]]));
      fds.push(devDir); // fd 4 - preopened /dev
    }

    this.wasi = new WASI(args, env, fds, { debug });

    // Instantiate the WASM module
    this.instance = new WebAssembly.Instance(wasmModule, {
      wasi_snapshot_preview1: this.wasi.wasiImport,
    });

    this.exports = this.instance.exports as unknown as QuickJSReactorExports;

    // Initialize the WASI reactor
    this.wasi.initialize(
      this.instance as { exports: { memory: WebAssembly.Memory } },
    );
  }

  /** Allocate a null-terminated string in WASM memory */
  private allocString(s: string): number {
    if (!this.exports) throw new Error("QuickJS not initialized");
    const bytes = new TextEncoder().encode(s);
    const ptr = this.exports.malloc(bytes.length + 1);
    if (ptr === 0) throw new Error("malloc failed");
    const memory = new Uint8Array(this.exports.memory.buffer);
    memory.set(bytes, ptr);
    memory[ptr + bytes.length] = 0;
    return ptr;
  }

  /** Free a pointer */
  private freePtr(ptr: number): void {
    if (ptr !== 0 && this.exports) {
      this.exports.free(ptr);
    }
  }

  /** Check if a JSValue is an exception */
  private isException(val: bigint): boolean {
    const tag = Number(val >> 32n);
    return tag === JS_TAG_EXCEPTION;
  }

  /**
   * Initialize QuickJS runtime and context.
   */
  init(): void {
    if (!this.exports) throw new Error("QuickJS not initialized");

    // Create runtime
    this.rtPtr = this.exports.JS_NewRuntime();
    if (this.rtPtr === 0) {
      throw new Error("JS_NewRuntime failed");
    }

    // Initialize std handlers
    this.exports.js_std_init_handlers(this.rtPtr);

    // Create context
    this.ctxPtr = this.exports.JS_NewContext(this.rtPtr);
    if (this.ctxPtr === 0) {
      this.exports.js_std_free_handlers(this.rtPtr);
      this.exports.JS_FreeRuntime(this.rtPtr);
      this.rtPtr = 0;
      throw new Error("JS_NewContext failed");
    }

    // Initialize std modules
    const stdName = this.allocString("qjs:std");
    this.exports.js_init_module_std(this.ctxPtr, stdName);
    this.freePtr(stdName);

    const osName = this.allocString("qjs:os");
    this.exports.js_init_module_os(this.ctxPtr, osName);
    this.freePtr(osName);

    const bjsonName = this.allocString("qjs:bjson");
    this.exports.js_init_module_bjson(this.ctxPtr, bjsonName);
    this.freePtr(bjsonName);

    // Add std helpers (console.log, print, etc.)
    this.exports.js_std_add_helpers(this.ctxPtr, 0, 0);
  }

  /**
   * Initialize QuickJS and import std modules as globals.
   * This makes std, os, and bjson available as global objects.
   */
  initStdModule(): void {
    this.init();

    // Import and expose std modules globally
    const code = `import * as bjson from 'qjs:bjson';
import * as std from 'qjs:std';
import * as os from 'qjs:os';
globalThis.bjson = bjson;
globalThis.std = std;
globalThis.os = os;
`;
    this.eval(code, true);
  }

  /**
   * Initialize QuickJS with command-line arguments.
   * Sets up scriptArgs for the JavaScript code.
   */
  initArgv(args: string[]): void {
    if (!this.exports) throw new Error("QuickJS not initialized");

    this.init();

    if (args.length > 0) {
      // Allocate argv strings
      const argPtrs: number[] = [];
      for (const arg of args) {
        argPtrs.push(this.allocString(arg));
      }

      // Allocate argv array
      const argvPtr = this.exports.malloc(args.length * 4);
      if (argvPtr === 0) {
        for (const ptr of argPtrs) {
          this.freePtr(ptr);
        }
        throw new Error("malloc failed for argv");
      }

      // Write argv pointers
      const view = new DataView(this.exports.memory.buffer);
      for (let i = 0; i < argPtrs.length; i++) {
        view.setUint32(argvPtr + i * 4, argPtrs[i], true);
      }

      // Call js_std_add_helpers with argv
      this.exports.js_std_add_helpers(this.ctxPtr, args.length, argvPtr);

      // Free argv
      this.freePtr(argvPtr);
      for (const ptr of argPtrs) {
        this.freePtr(ptr);
      }
    }
  }

  /**
   * Evaluate JavaScript code.
   * @param code The JavaScript code to evaluate
   * @param isModule Whether to treat the code as an ES module
   * @param filename Optional filename for error messages
   */
  eval(code: string, isModule = false, filename = "<eval>"): void {
    if (!this.exports || this.ctxPtr === 0) {
      throw new Error("QuickJS not initialized");
    }

    // Allocate code string (with null terminator)
    const codePtr = this.allocString(code);

    // Allocate filename string
    const filenamePtr = this.allocString(filename);

    // Determine eval flags
    const evalFlags = isModule ? JS_EVAL_TYPE_MODULE : JS_EVAL_TYPE_GLOBAL;

    // Call JS_Eval
    const result = this.exports.JS_Eval(
      this.ctxPtr,
      codePtr,
      code.length,
      filenamePtr,
      evalFlags,
    );

    // Free allocated memory
    this.freePtr(codePtr);
    this.freePtr(filenamePtr);

    // Check for exception
    if (this.isException(result)) {
      this.exports.js_std_dump_error(this.ctxPtr);
      throw new Error("JavaScript exception");
    }

    // Free the result value
    this.exports.JS_FreeValue(this.ctxPtr, result);
  }

  /**
   * Run one iteration of the event loop.
   * @returns Loop result: >0 = timer ms, 0 = more work, -1 = idle, -2 = error
   */
  loopOnce(): number {
    if (!this.exports || this.ctxPtr === 0) {
      throw new Error("QuickJS not initialized");
    }

    try {
      return this.exports.js_std_loop_once(this.ctxPtr);
    } catch (e) {
      if (e instanceof WASIProcExit) {
        this.running = false;
        this.exitCode = e.code;
        return LOOP_IDLE;
      }
      throw e;
    }
  }

  /**
   * Poll for I/O events and invoke handlers.
   * @param timeoutMs Poll timeout in milliseconds (0 = non-blocking)
   */
  pollIO(timeoutMs = 0): number {
    if (!this.exports || this.ctxPtr === 0) {
      throw new Error("QuickJS not initialized");
    }

    try {
      return this.exports.js_std_poll_io(this.ctxPtr, timeoutMs);
    } catch (e) {
      if (e instanceof WASIProcExit) {
        this.running = false;
        this.exitCode = e.code;
        return -1;
      }
      throw e;
    }
  }

  /**
   * Push data to stdin for the QuickJS instance to read.
   */
  pushStdin(data: Uint8Array): void {
    this.stdin.push(data);
  }

  /**
   * Check if stdin has data available.
   */
  hasStdinData(): boolean {
    return this.stdin.hasData();
  }

  /**
   * Run the event loop until idle or stopped.
   * This method is designed for browser environments and yields to the event loop.
   * @param onTick Optional callback called on each loop iteration
   * @returns Promise that resolves when the loop is idle
   */
  async runLoop(onTick?: () => void): Promise<number> {
    this.running = true;

    while (this.running) {
      onTick?.();

      const result = this.loopOnce();

      if (result === LOOP_ERROR) {
        throw new Error("JavaScript error occurred");
      }

      if (result === LOOP_IDLE) {
        // Check if there's stdin data to process
        if (this.stdin.hasData()) {
          this.pollIO(0);
          continue;
        }
        // No more work
        break;
      }

      if (result === 0) {
        // More microtasks pending, yield to browser event loop
        await new Promise((resolve) => queueMicrotask(resolve as () => void));
        continue;
      }

      if (result > 0) {
        // Timer pending - check stdin first
        if (this.stdin.hasData()) {
          this.pollIO(0);
          await new Promise((resolve) => queueMicrotask(resolve as () => void));
          continue;
        }
        // Wait for timer
        await new Promise((resolve) => setTimeout(resolve, result));
      }
    }

    return this.exitCode;
  }

  /**
   * Run the event loop synchronously (blocking).
   * This is suitable for Node.js/Bun environments.
   * @returns Exit code
   */
  runLoopSync(): number {
    this.running = true;

    while (this.running) {
      const result = this.loopOnce();

      if (result === LOOP_ERROR) {
        throw new Error("JavaScript error occurred");
      }

      if (result === LOOP_IDLE) {
        if (this.stdin.hasData()) {
          this.pollIO(0);
          continue;
        }
        break;
      }

      if (result === 0) {
        // More microtasks pending
        continue;
      }

      if (result > 0) {
        if (this.stdin.hasData()) {
          this.pollIO(0);
          continue;
        }
        // In sync mode, we just continue - host should call loopOnce again
        // after the timer would have fired
        break;
      }
    }

    return this.exitCode;
  }

  /**
   * Stop the event loop.
   */
  stop(): void {
    this.running = false;
  }

  /**
   * Destroy the QuickJS runtime and release resources.
   */
  destroy(): void {
    if (this.exports) {
      if (this.ctxPtr !== 0) {
        this.exports.JS_FreeContext(this.ctxPtr);
        this.ctxPtr = 0;
      }
      if (this.rtPtr !== 0) {
        this.exports.js_std_free_handlers(this.rtPtr);
        this.exports.JS_FreeRuntime(this.rtPtr);
        this.rtPtr = 0;
      }
    }
    this.stdin.close();
  }

  /**
   * Get the exit code (valid after runLoop completes).
   */
  getExitCode(): number {
    return this.exitCode;
  }
}

/**
 * Create a QuickJS instance from a WASM module.
 * @param wasmModule Compiled WebAssembly module
 * @param options Configuration options
 */
export function createQuickJS(
  wasmModule: WebAssembly.Module,
  options?: QuickJSOptions,
): QuickJS {
  return new QuickJS(wasmModule, options);
}

/**
 * Load and create a QuickJS instance from a URL or buffer.
 * @param wasmSource URL string, Response, or ArrayBuffer containing the WASM
 * @param options Configuration options
 */
export async function loadQuickJS(
  wasmSource: string | Response | ArrayBuffer | Uint8Array,
  options?: QuickJSOptions,
): Promise<QuickJS> {
  let wasmModule: WebAssembly.Module;

  if (typeof wasmSource === "string") {
    const response = await fetch(wasmSource);
    wasmModule = await WebAssembly.compileStreaming(response);
  } else if (wasmSource instanceof Response) {
    wasmModule = await WebAssembly.compileStreaming(wasmSource);
  } else {
    wasmModule = await WebAssembly.compile(wasmSource as BufferSource);
  }

  return createQuickJS(wasmModule, options);
}

/**
 * Build a virtual filesystem from a map of paths to file contents.
 * @param files Map of path -> content (string or Uint8Array)
 * @returns Root directory contents suitable for QuickJSOptions.fs
 */
export function buildFileSystem(
  files: Map<string, string | Uint8Array>,
): Map<string, File | Directory> {
  const root = new Map<string, File | Directory>();

  for (const [path, content] of files) {
    const parts = path.split("/").filter((p) => p.length > 0);
    if (parts.length === 0) continue;

    let currentMap = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      const existing = currentMap.get(part);
      if (existing instanceof Directory) {
        currentMap = existing.contents as Map<string, File | Directory>;
      } else {
        const newDir = new Map<string, File | Directory>();
        currentMap.set(part, new Directory(newDir));
        currentMap = newDir;
      }
    }

    const fileName = parts[parts.length - 1];
    const data =
      typeof content === "string" ? new TextEncoder().encode(content) : content;
    currentMap.set(fileName, new File(data));
  }

  return root;
}
