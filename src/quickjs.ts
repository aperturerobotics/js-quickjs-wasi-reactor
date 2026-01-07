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

/** Loop result constants from qjs_loop_once() */
export const LOOP_IDLE = -1;
export const LOOP_ERROR = -2;

/** QuickJS reactor exports interface */
export interface QuickJSReactorExports {
  /** Standard WASI reactor initialization */
  _initialize(): void;
  /** WebAssembly memory */
  memory: WebAssembly.Memory;
  /** Initialize with CLI arguments */
  qjs_init_argv(argc: number, argv: number): number;
  /** Initialize empty runtime */
  qjs_init(): number;
  /** Evaluate JavaScript code */
  qjs_eval(
    code: number,
    len: number,
    filename: number,
    is_module: number,
  ): number;
  /** Run one iteration of the event loop */
  qjs_loop_once(): number;
  /** Poll for I/O events */
  qjs_poll_io(timeout_ms: number): number;
  /** Cleanup runtime */
  qjs_destroy(): void;
  /** Allocate memory */
  malloc(size: number): number;
  /** Free memory */
  free(ptr: number): void;
}

/** Options for creating a QuickJS instance */
export interface QuickJSOptions {
  /** WASI arguments (default: ['qjs', '--std']) */
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

  constructor(wasmModule: WebAssembly.Module, options: QuickJSOptions = {}) {
    const args = options.args ?? ["qjs", "--std"];
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

  /**
   * Initialize QuickJS with command-line arguments.
   * The args should match the WASI args passed to the constructor.
   */
  initArgv(): void {
    if (!this.exports) throw new Error("QuickJS not initialized");

    const args = this.wasi.args;
    const memory = this.exports.memory;
    const encoder = new TextEncoder();

    // Allocate space for argv array and strings
    const ARGV_BASE = 65536;
    const STRINGS_BASE = ARGV_BASE + args.length * 4 + 4;

    const view = new DataView(memory.buffer);
    const bytes = new Uint8Array(memory.buffer);

    let stringOffset = STRINGS_BASE;
    for (let i = 0; i < args.length; i++) {
      view.setUint32(ARGV_BASE + i * 4, stringOffset, true);
      const encoded = encoder.encode(args[i]);
      bytes.set(encoded, stringOffset);
      bytes[stringOffset + encoded.length] = 0;
      stringOffset += encoded.length + 1;
    }
    view.setUint32(ARGV_BASE + args.length * 4, 0, true);

    const result = this.exports.qjs_init_argv(args.length, ARGV_BASE);
    if (result !== 0) {
      throw new Error(`qjs_init_argv failed with code ${result}`);
    }
  }

  /**
   * Initialize QuickJS with an empty context.
   */
  init(): void {
    if (!this.exports) throw new Error("QuickJS not initialized");
    const result = this.exports.qjs_init();
    if (result !== 0) {
      throw new Error(`qjs_init failed with code ${result}`);
    }
  }

  /**
   * Evaluate JavaScript code.
   * @param code The JavaScript code to evaluate
   * @param isModule Whether to treat the code as an ES module
   * @param filename Optional filename for error messages
   */
  eval(code: string, isModule = false, filename = "<eval>"): void {
    if (!this.exports) throw new Error("QuickJS not initialized");

    const codeBytes = new TextEncoder().encode(code);
    const filenameBytes = new TextEncoder().encode(filename);

    // Allocate memory for code
    const codePtr = this.exports.malloc(codeBytes.length + 1);
    if (codePtr === 0) throw new Error("malloc failed for code");

    // Allocate memory for filename
    const filenamePtr = this.exports.malloc(filenameBytes.length + 1);
    if (filenamePtr === 0) {
      this.exports.free(codePtr);
      throw new Error("malloc failed for filename");
    }

    const memory = new Uint8Array(this.exports.memory.buffer);

    // Write code with null terminator
    memory.set(codeBytes, codePtr);
    memory[codePtr + codeBytes.length] = 0;

    // Write filename with null terminator
    memory.set(filenameBytes, filenamePtr);
    memory[filenamePtr + filenameBytes.length] = 0;

    // Call qjs_eval
    const result = this.exports.qjs_eval(
      codePtr,
      codeBytes.length,
      filenamePtr,
      isModule ? 1 : 0,
    );

    // Free allocated memory
    this.exports.free(codePtr);
    this.exports.free(filenamePtr);

    if (result !== 0) {
      throw new Error("eval failed");
    }
  }

  /**
   * Run one iteration of the event loop.
   * @returns Loop result: >0 = timer ms, 0 = more work, -1 = idle, -2 = error
   */
  loopOnce(): number {
    if (!this.exports) throw new Error("QuickJS not initialized");

    try {
      return this.exports.qjs_loop_once();
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
    if (!this.exports) throw new Error("QuickJS not initialized");

    try {
      return this.exports.qjs_poll_io(timeoutMs);
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
      this.exports.qjs_destroy();
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
