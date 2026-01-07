// js-quickjs-wasi-reactor
// JavaScript harness for QuickJS-NG WASI reactor model

// Main QuickJS API
export {
  QuickJS,
  createQuickJS,
  loadQuickJS,
  buildFileSystem,
  LOOP_IDLE,
  LOOP_ERROR,
  type QuickJSOptions,
  type QuickJSReactorExports,
} from "./quickjs.js";

// WASI implementation
export { WASI, WASIProcExit, type WASIOptions } from "./wasi.js";

// File system types
export {
  File,
  Directory,
  OpenFile,
  OpenDirectory,
  PreopenDirectory,
  ConsoleStdout,
  PollableStdin,
  DevOut,
  DevDirectory,
} from "./fs-mem.js";

// File descriptor types
export { Fd, Inode, type PollResult } from "./fd.js";

// WASI definitions
export * as wasi from "./wasi-defs.js";
