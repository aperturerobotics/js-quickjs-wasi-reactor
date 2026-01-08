# js-quickjs-wasi-reactor

[![NPM Version](https://img.shields.io/npm/v/quickjs-wasi-reactor)](https://www.npmjs.com/package/quickjs-wasi-reactor)

> JavaScript/TypeScript harness for running QuickJS-NG in WASI reactor mode

This package provides a JavaScript/TypeScript implementation for running QuickJS-NG compiled to WebAssembly using the WASI reactor model. It includes a complete browser-compatible WASI shim and high-level API for JavaScript execution.

## Related Projects

- [go-quickjs-wasi-reactor](https://github.com/aperturerobotics/go-quickjs-wasi-reactor) - Go implementation with wazero
- [go-quickjs-wasi](https://github.com/paralin/go-quickjs-wasi) - Go implementation for command model (blocking)
- [paralin/quickjs](https://github.com/paralin/quickjs) - QuickJS-NG fork with reactor build target
- [QuickJS-NG reactor PR](https://github.com/quickjs-ng/quickjs/pull/1308) - Upstream PR for reactor support
- [QuickJS-NG event loop PR](https://github.com/quickjs-ng/quickjs/pull/1307) - Upstream PR for non-blocking event loop

## Installation

```bash
npm install quickjs-wasi-reactor
# or
bun add quickjs-wasi-reactor
```

## Usage

### Basic Usage

```typescript
import { loadQuickJS, buildFileSystem } from "quickjs-wasi-reactor";

// Load QuickJS from a URL or buffer
const qjs = await loadQuickJS("/path/to/qjs-wasi.wasm");

// Initialize with --std flag (provides std, os, bjson globals)
qjs.init(["qjs", "--std"]);

// Evaluate JavaScript code
qjs.eval(`console.log("Hello from QuickJS!")`);

// Run the event loop
await qjs.runLoop();

// Cleanup
qjs.destroy();
```

### Initialization Options

```typescript
// Basic runtime with std modules available for import
qjs.init();
qjs.eval(`import * as std from 'qjs:std'; std.printf("Hello\\n")`, true);

// With --std flag to expose std, os, bjson as globals
qjs.init(["qjs", "--std"]);
qjs.eval(`std.printf("Hello\\n")`); // std is already global

// With script args accessible via scriptArgs global
qjs.init(["qjs", "script.js", "--verbose"]);
qjs.eval(`console.log(scriptArgs)`); // ['qjs', 'script.js', '--verbose']
```

### With Virtual Filesystem

```typescript
import { loadQuickJS, buildFileSystem } from "quickjs-wasi-reactor";

// Build a virtual filesystem
const fs = buildFileSystem(
  new Map([
    ["script.js", 'console.log("Hello from script!")'],
    [
      "lib/utils.js",
      "export function greet(name) { return `Hello, ${name}!` }",
    ],
  ]),
);

const qjs = await loadQuickJS("/path/to/qjs-wasi.wasm", { fs });

qjs.init(["qjs", "--std"]);
qjs.eval(
  `
  import { greet } from './lib/utils.js'
  console.log(greet('World'))
`,
  true,
);
await qjs.runLoop();
qjs.destroy();
```

### Custom I/O Handlers

```typescript
import { loadQuickJS } from "quickjs-wasi-reactor";

const qjs = await loadQuickJS("/path/to/qjs-wasi.wasm", {
  stdout: (line) => (document.body.innerHTML += `<p>${line}</p>`),
  stderr: (line) => console.error("Error:", line),
  onDevOut: (data) => {
    // Handle binary data written to /dev/out
    console.log("Received", data.length, "bytes");
  },
});

qjs.init();
qjs.eval(`console.log("This goes to custom stdout")`);
await qjs.runLoop();
qjs.destroy();
```

### Feeding Stdin Data

```typescript
import { loadQuickJS, PollableStdin } from "quickjs-wasi-reactor";

const stdin = new PollableStdin();

const qjs = await loadQuickJS("/path/to/qjs-wasi.wasm", { stdin });

qjs.init(["qjs", "--std"]);

// Push data to stdin
qjs.pushStdin(new TextEncoder().encode("Hello from stdin\n"));

// Run the loop - QuickJS can read from stdin
await qjs.runLoop();
qjs.destroy();
```

### Non-Blocking Event Loop Control

For fine-grained control over JavaScript execution, use `loopOnce()` instead of `runLoop()`:

```typescript
import { loadQuickJS, LOOP_IDLE, LOOP_ERROR } from "quickjs-wasi-reactor";

const qjs = await loadQuickJS("/path/to/qjs-wasi.wasm");
qjs.init(["qjs", "--std"]);

qjs.eval(`
  os.setTimeout(() => console.log("timer fired"), 100)
  console.log("scheduled timer")
`);

// Manual event loop - integrate with your own scheduling
while (true) {
  const result = qjs.loopOnce();

  if (result === LOOP_ERROR) throw new Error("JavaScript error");
  if (result === LOOP_IDLE) break; // No more work

  if (result === 0) {
    // More microtasks pending - yield to browser then continue
    await new Promise((r) => queueMicrotask(r));
  } else if (result > 0) {
    // Timer pending in N ms - do other work or wait
    await new Promise((r) => setTimeout(r, result));
  }
}

qjs.destroy();
```

### Browser Integration with Animation Frames

```typescript
const qjs = await loadQuickJS("/path/to/qjs-wasi.wasm");
qjs.init(["qjs", "--std"]);

qjs.eval(`
  let frame = 0
  function tick() {
    console.log("Frame:", frame++)
    if (frame < 60) os.setTimeout(tick, 16)
  }
  tick()
`);

// Cooperative scheduling with browser
function runFrame() {
  const result = qjs.loopOnce();
  if (result >= 0) {
    requestAnimationFrame(runFrame);
  } else {
    qjs.destroy();
  }
}
requestAnimationFrame(runFrame);
```

## API

### `loadQuickJS(wasmSource, options?)`

Load and create a QuickJS instance from a WASM source.

**Parameters:**

- `wasmSource`: URL string, `Response`, `ArrayBuffer`, or `Uint8Array`
- `options`: Optional configuration (see `QuickJSOptions`)

**Returns:** `Promise<QuickJS>`

### `createQuickJS(wasmModule, options?)`

Create a QuickJS instance from a pre-compiled WebAssembly module.

**Parameters:**

- `wasmModule`: `WebAssembly.Module`
- `options`: Optional configuration

**Returns:** `QuickJS`

### `QuickJSOptions`

| Option     | Type                         | Default               | Description                       |
| ---------- | ---------------------------- | --------------------- | --------------------------------- |
| `args`     | `string[]`                   | `['qjs']`             | WASI command-line arguments       |
| `env`      | `string[]`                   | `[]`                  | Environment variables (key=value) |
| `debug`    | `boolean`                    | `false`               | Enable WASI debug logging         |
| `stdout`   | `(line: string) => void`     | `console.log`         | Custom stdout line handler        |
| `stderr`   | `(line: string) => void`     | `console.error`       | Custom stderr line handler        |
| `fs`       | `Map<string, File\|Dir>`     | `new Map()`           | Virtual filesystem root contents  |
| `onDevOut` | `(data: Uint8Array) => void` | `undefined`           | Handler for /dev/out writes       |
| `stdin`    | `PollableStdin`              | `new PollableStdin()` | Custom stdin source               |

### `QuickJS` Methods

#### `init(args?)`

Initialize QuickJS runtime and context. Modules `qjs:std`, `qjs:os`, and `qjs:bjson` can be imported in evaluated code.

Pass `['qjs', '--std']` to expose `std`, `os`, and `bjson` as globals.

Supported flags:

- `--std` - Load std, os, bjson modules as globals
- `-m, --module` - Treat script as ES module
- `-e, --eval` - Evaluate expression
- `-I, --include` - Include file before script

#### `eval(code, isModule?, filename?)`

Evaluate JavaScript code.

- `code`: JavaScript source code
- `isModule`: Treat as ES module (default: `false`)
- `filename`: Filename for error messages (default: `'<eval>'`)

#### `loopOnce()`

Run one iteration of the event loop. Returns:

- `> 0`: Next timer fires in N milliseconds
- `0`: More microtasks pending
- `-1` (`LOOP_IDLE`): No pending work
- `-2` (`LOOP_ERROR`): Error occurred

#### `runLoop(onTick?)`

Run the event loop until idle. Yields to the browser event loop between iterations.

**Returns:** `Promise<number>` (exit code)

#### `runLoopSync()`

Run the event loop synchronously. Suitable for Node.js/Bun.

**Returns:** `number` (exit code)

#### `pollIO(timeoutMs?)`

Poll for I/O events and invoke handlers.

#### `pushStdin(data)`

Push data to stdin for the QuickJS instance to read.

#### `hasStdinData()`

Check if stdin has data available.

#### `stop()`

Stop the event loop.

#### `destroy()`

Destroy the QuickJS runtime and release resources.

### `buildFileSystem(files)`

Build a virtual filesystem from a map of paths to content.

```typescript
const fs = buildFileSystem(
  new Map([
    ["path/to/file.js", "content"],
    ["another/file.txt", new Uint8Array([1, 2, 3])],
  ]),
);
```

## Reactor Model

Unlike the standard WASI "command" model that blocks in `_start()`, the reactor model exports functions for re-entrant execution:

**Reactor Initialization (preferred):**

- `qjs_init_argv(argc, argv)` - Initialize with CLI args (sets up module loader)
- `qjs_get_context()` - Get JSContext\* for use with other APIs
- `qjs_destroy()` - Cleanup reactor runtime

**Evaluation:**

- `JS_Eval(ctx, input, len, filename, flags)` - Evaluate JavaScript code
- `JS_FreeValue(ctx, val)` - Free a JSValue

**Event Loop:**

- `js_std_loop_once(ctx)` - Run one event loop iteration (non-blocking)
- `js_std_poll_io(ctx, timeout_ms)` - Poll for I/O events
- `js_std_dump_error(ctx)` - Dump exception to stderr

**Memory:**

- `malloc(size)` / `free(ptr)` - Memory allocation

This enables re-entrant execution in JavaScript host environments where blocking is not possible.

## License

MIT
