# js-quickjs-wasi-reactor

[![NPM Version](https://img.shields.io/npm/v/quickjs-wasi-reactor)](https://www.npmjs.com/package/quickjs-wasi-reactor)

> JavaScript/TypeScript harness for running QuickJS-NG in WASI reactor mode

This package provides a JavaScript/TypeScript implementation for running QuickJS-NG compiled to WebAssembly using the WASI reactor model. It includes a complete browser-compatible WASI shim and high-level API for JavaScript execution.

## Related Projects

- [go-quickjs-wasi-reactor](https://github.com/aperturerobotics/go-quickjs-wasi-reactor) - Go implementation with wazero
- [go-quickjs-wasi](https://github.com/paralin/go-quickjs-wasi) - Go implementation for command model (blocking)
- [paralin/quickjs](https://github.com/paralin/quickjs) - QuickJS-NG fork with reactor build target
- [QuickJS-NG reactor PR](https://github.com/quickjs-ng/quickjs/pull/1307) - Upstream PR for reactor support

## Installation

```bash
npm install quickjs-wasi-reactor
# or
bun add quickjs-wasi-reactor
```

## Usage

### Basic Usage

```typescript
import { loadQuickJS, buildFileSystem } from 'quickjs-wasi-reactor'

// Load QuickJS from a URL or buffer
const qjs = await loadQuickJS('/path/to/qjs-wasi.wasm')

// Initialize with std module (provides std, os, bjson globals)
qjs.initStdModule()

// Evaluate JavaScript code
qjs.eval(`console.log("Hello from QuickJS!")`)

// Run the event loop
await qjs.runLoop()

// Cleanup
qjs.destroy()
```

### Initialization Options

There are three ways to initialize QuickJS:

```typescript
// Option 1: init() - Basic runtime with std modules available for import
qjs.init()
qjs.eval(`import * as std from 'qjs:std'; std.printf("Hello\\n")`, true)

// Option 2: initStdModule() - Like init() but also exposes std, os, bjson as globals
qjs.initStdModule()
qjs.eval(`std.printf("Hello\\n")`)  // std is already global

// Option 3: initArgv(args) - Like init() but sets up scriptArgs
qjs.initArgv(['qjs', 'script.js', '--verbose'])
qjs.eval(`console.log(scriptArgs)`)  // ['qjs', 'script.js', '--verbose']
```

### With Virtual Filesystem

```typescript
import { loadQuickJS, buildFileSystem } from 'quickjs-wasi-reactor'

// Build a virtual filesystem
const fs = buildFileSystem(
  new Map([
    ['script.js', 'console.log("Hello from script!")'],
    ['lib/utils.js', 'export function greet(name) { return `Hello, ${name}!` }'],
  ]),
)

const qjs = await loadQuickJS('/path/to/qjs-wasi.wasm', { fs })

qjs.initStdModule()
qjs.eval(`
  import { greet } from './lib/utils.js'
  console.log(greet('World'))
`, true)
await qjs.runLoop()
qjs.destroy()
```

### Custom I/O Handlers

```typescript
import { loadQuickJS } from 'quickjs-wasi-reactor'

const qjs = await loadQuickJS('/path/to/qjs-wasi.wasm', {
  stdout: (line) => document.body.innerHTML += `<p>${line}</p>`,
  stderr: (line) => console.error('Error:', line),
  onDevOut: (data) => {
    // Handle binary data written to /dev/out
    console.log('Received', data.length, 'bytes')
  },
})

qjs.initArgv()
qjs.eval(`console.log("This goes to custom stdout")`)
await qjs.runLoop()
qjs.destroy()
```

### Feeding Stdin Data

```typescript
import { loadQuickJS, PollableStdin } from 'quickjs-wasi-reactor'

const stdin = new PollableStdin()

const qjs = await loadQuickJS('/path/to/qjs-wasi.wasm', { stdin })

qjs.initArgv()

// Push data to stdin
qjs.pushStdin(new TextEncoder().encode('Hello from stdin\n'))

// Run the loop - QuickJS can read from stdin
await qjs.runLoop()
qjs.destroy()
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

| Option     | Type                        | Default                   | Description                        |
| ---------- | --------------------------- | ------------------------- | ---------------------------------- |
| `args`     | `string[]`                  | `['qjs', '--std']`        | WASI command-line arguments        |
| `env`      | `string[]`                  | `[]`                      | Environment variables (key=value)  |
| `debug`    | `boolean`                   | `false`                   | Enable WASI debug logging          |
| `stdout`   | `(line: string) => void`    | `console.log`             | Custom stdout line handler         |
| `stderr`   | `(line: string) => void`    | `console.error`           | Custom stderr line handler         |
| `fs`       | `Map<string, File\|Dir>`    | `new Map()`               | Virtual filesystem root contents   |
| `onDevOut` | `(data: Uint8Array) => void`| `undefined`               | Handler for /dev/out writes        |
| `stdin`    | `PollableStdin`             | `new PollableStdin()`     | Custom stdin source                |

### `QuickJS` Methods

#### `init()`

Initialize QuickJS runtime and context with std modules available for import.
Modules `qjs:std`, `qjs:os`, and `qjs:bjson` can be imported in evaluated code.

#### `initStdModule()`

Like `init()` but also exposes `std`, `os`, and `bjson` as global objects.
Convenient for REPL-style usage where you want immediate access to std library.

#### `initArgv(args)`

Like `init()` but also sets up `scriptArgs` global with the provided arguments.
Use this when your JavaScript code needs to access command-line arguments.

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
    ['path/to/file.js', 'content'],
    ['another/file.txt', new Uint8Array([1, 2, 3])],
  ]),
)
```

## Reactor Model

Unlike the standard WASI "command" model that blocks in `_start()`, the reactor model exports the raw QuickJS C API functions that the host calls directly:

**Core Runtime:**
- `JS_NewRuntime()` / `JS_FreeRuntime(rt)` - Create/destroy runtime
- `JS_NewContext(rt)` / `JS_FreeContext(ctx)` - Create/destroy context
- `JS_Eval(ctx, input, len, filename, flags)` - Evaluate JavaScript code
- `JS_FreeValue(ctx, val)` - Free a JSValue

**Standard Library:**
- `js_std_init_handlers(rt)` / `js_std_free_handlers(rt)` - Initialize/cleanup std handlers
- `js_init_module_std(ctx, name)` - Register qjs:std module
- `js_init_module_os(ctx, name)` - Register qjs:os module  
- `js_init_module_bjson(ctx, name)` - Register qjs:bjson module
- `js_std_add_helpers(ctx, argc, argv)` - Add console.log, print, scriptArgs, etc.
- `js_std_loop_once(ctx)` - Run one event loop iteration (non-blocking)
- `js_std_poll_io(ctx, timeout_ms)` - Poll for I/O events
- `js_std_dump_error(ctx)` - Dump exception to stderr

**Memory:**
- `malloc(size)` / `free(ptr)` - Memory allocation

This enables re-entrant execution in JavaScript host environments where blocking is not possible. The raw C API also enables advanced use cases like multiple contexts, custom module loaders, and fine-grained resource control.

## License

MIT
