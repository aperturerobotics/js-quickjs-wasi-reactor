# js-quickjs-wasi-reactor

> JavaScript/TypeScript harness for running QuickJS-NG in WASI reactor mode

This package provides a JavaScript/TypeScript implementation for running QuickJS-NG compiled to WebAssembly using the WASI reactor model. It includes a complete browser-compatible WASI shim and high-level API for JavaScript execution.

## Related Projects

- [go-quickjs-wasi-reactor](https://github.com/aperturerobotics/go-quickjs-wasi-reactor) - Go implementation with wazero
- [paralin/quickjs](https://github.com/paralin/quickjs) - QuickJS-NG fork with reactor build target

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

// Initialize with std module
qjs.initArgv()

// Evaluate JavaScript code
qjs.eval(`console.log("Hello from QuickJS!")`)

// Run the event loop
await qjs.runLoop()

// Cleanup
qjs.destroy()
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

const qjs = await loadQuickJS('/path/to/qjs-wasi.wasm', {
  args: ['qjs', '--std', 'script.js'],
  fs,
})

qjs.initArgv()
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

#### `initArgv()`

Initialize QuickJS with command-line arguments. Call this after creating the instance.

#### `init()`

Initialize QuickJS with an empty context (without loading scripts via args).

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

Unlike the standard WASI "command" model that blocks in `_start()`, the reactor model exports functions that the host calls:

- `qjs_init()` - Initialize empty runtime
- `qjs_init_argv(argc, argv)` - Initialize with CLI args
- `qjs_eval(code, len, filename, is_module)` - Evaluate JS code
- `qjs_loop_once()` - Run one event loop iteration
- `qjs_poll_io(timeout_ms)` - Poll for I/O events
- `qjs_destroy()` - Cleanup runtime
- `malloc/free` - Memory allocation

This enables re-entrant execution in JavaScript host environments where blocking is not possible.

## License

MIT
