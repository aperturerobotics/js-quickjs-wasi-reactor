// WASI definitions

// Clock IDs
export const CLOCKID_REALTIME = 0;
export const CLOCKID_MONOTONIC = 1;

// Error numbers
export const ERRNO_SUCCESS = 0;
export const ERRNO_BADF = 8;
export const ERRNO_EXIST = 20;
export const ERRNO_INVAL = 28;
export const ERRNO_ISDIR = 31;
export const ERRNO_NOENT = 44;
export const ERRNO_NOSYS = 52;
export const ERRNO_NOTDIR = 54;
export const ERRNO_NOTEMPTY = 55;
export const ERRNO_NOTSUP = 58;
export const ERRNO_PERM = 63;
export const ERRNO_NAMETOOLONG = 76;
export const ERRNO_NOTCAPABLE = 76;

// File types
export const FILETYPE_UNKNOWN = 0;
export const FILETYPE_BLOCK_DEVICE = 1;
export const FILETYPE_CHARACTER_DEVICE = 2;
export const FILETYPE_DIRECTORY = 3;
export const FILETYPE_REGULAR_FILE = 4;
export const FILETYPE_SOCKET_DGRAM = 5;
export const FILETYPE_SOCKET_STREAM = 6;
export const FILETYPE_SYMBOLIC_LINK = 7;

// Open flags
export const OFLAGS_CREAT = 1;
export const OFLAGS_DIRECTORY = 2;
export const OFLAGS_EXCL = 4;
export const OFLAGS_TRUNC = 8;

// File descriptor flags
export const FDFLAGS_APPEND = 1;
export const FDFLAGS_DSYNC = 2;
export const FDFLAGS_NONBLOCK = 4;
export const FDFLAGS_RSYNC = 8;
export const FDFLAGS_SYNC = 16;

// Rights
export const RIGHTS_FD_READ = 2;
export const RIGHTS_FD_WRITE = 64;

// Seek whence
export const WHENCE_SET = 0;
export const WHENCE_CUR = 1;
export const WHENCE_END = 2;

// Event types
export const EVENTTYPE_CLOCK = 0;
export const EVENTTYPE_FD_READ = 1;
export const EVENTTYPE_FD_WRITE = 2;

// Subscription clock flags
export const SUBCLOCKFLAGS_SUBSCRIPTION_CLOCK_ABSTIME = 1;

// Event read/write flags
export const EVENTRWFLAGS_FD_READWRITE_HANGUP = 1;

export class Fdstat {
  fs_filetype: number;
  fs_flags: number;
  fs_rights_base: bigint;
  fs_rights_inheriting: bigint;

  constructor(filetype: number, flags: number) {
    this.fs_filetype = filetype;
    this.fs_flags = flags;
    this.fs_rights_base = 0n;
    this.fs_rights_inheriting = 0n;
  }

  write_bytes(view: DataView, ptr: number): void {
    view.setUint8(ptr, this.fs_filetype);
    view.setUint16(ptr + 2, this.fs_flags, true);
    view.setBigUint64(ptr + 8, this.fs_rights_base, true);
    view.setBigUint64(ptr + 16, this.fs_rights_inheriting, true);
  }
}

export class Filestat {
  dev: bigint;
  ino: bigint;
  filetype: number;
  nlink: bigint;
  size: bigint;
  atim: bigint;
  mtim: bigint;
  ctim: bigint;

  constructor(ino: bigint, filetype: number, size: bigint) {
    this.dev = 0n;
    this.ino = ino;
    this.filetype = filetype;
    this.nlink = 1n;
    this.size = size;
    this.atim = 0n;
    this.mtim = 0n;
    this.ctim = 0n;
  }

  write_bytes(view: DataView, ptr: number): void {
    view.setBigUint64(ptr, this.dev, true);
    view.setBigUint64(ptr + 8, this.ino, true);
    view.setUint8(ptr + 16, this.filetype);
    view.setBigUint64(ptr + 24, this.nlink, true);
    view.setBigUint64(ptr + 32, this.size, true);
    view.setBigUint64(ptr + 40, this.atim, true);
    view.setBigUint64(ptr + 48, this.mtim, true);
    view.setBigUint64(ptr + 56, this.ctim, true);
  }
}

export class Prestat {
  tag: number;
  inner: { pr_name: Uint8Array };

  constructor(tag: number, name: Uint8Array) {
    this.tag = tag;
    this.inner = { pr_name: name };
  }

  static dir(name: string): Prestat {
    return new Prestat(0, new TextEncoder().encode(name));
  }

  write_bytes(view: DataView, ptr: number): void {
    view.setUint8(ptr, this.tag);
    view.setUint32(ptr + 4, this.inner.pr_name.byteLength, true);
  }
}

export class Iovec {
  buf: number;
  buf_len: number;

  constructor(buf: number, buf_len: number) {
    this.buf = buf;
    this.buf_len = buf_len;
  }

  static read_bytes(view: DataView, ptr: number): Iovec {
    const buf = view.getUint32(ptr, true);
    const buf_len = view.getUint32(ptr + 4, true);
    return new Iovec(buf, buf_len);
  }

  static read_bytes_array(view: DataView, ptr: number, len: number): Iovec[] {
    const result: Iovec[] = [];
    for (let i = 0; i < len; i++) {
      result.push(Iovec.read_bytes(view, ptr + i * 8));
    }
    return result;
  }
}

export class Ciovec {
  buf: number;
  buf_len: number;

  constructor(buf: number, buf_len: number) {
    this.buf = buf;
    this.buf_len = buf_len;
  }

  static read_bytes(view: DataView, ptr: number): Ciovec {
    const buf = view.getUint32(ptr, true);
    const buf_len = view.getUint32(ptr + 4, true);
    return new Ciovec(buf, buf_len);
  }

  static read_bytes_array(view: DataView, ptr: number, len: number): Ciovec[] {
    const result: Ciovec[] = [];
    for (let i = 0; i < len; i++) {
      result.push(Ciovec.read_bytes(view, ptr + i * 8));
    }
    return result;
  }
}

export class Dirent {
  d_next: bigint;
  d_ino: bigint;
  d_namlen: number;
  d_type: number;
  d_name: string;

  constructor(next: bigint, ino: bigint, name: string, type: number) {
    this.d_next = next;
    this.d_ino = ino;
    this.d_namlen = new TextEncoder().encode(name).byteLength;
    this.d_type = type;
    this.d_name = name;
  }

  head_length(): number {
    return 24;
  }

  name_length(): number {
    return this.d_namlen;
  }

  write_head_bytes(view: DataView, ptr: number): void {
    view.setBigUint64(ptr, this.d_next, true);
    view.setBigUint64(ptr + 8, this.d_ino, true);
    view.setUint32(ptr + 16, this.d_namlen, true);
    view.setUint8(ptr + 20, this.d_type);
  }

  write_name_bytes(buffer8: Uint8Array, ptr: number, len: number): void {
    const name_bytes = new TextEncoder().encode(this.d_name);
    buffer8.set(name_bytes.slice(0, len), ptr);
  }
}

export class Subscription {
  userdata: bigint;
  eventtype: number;
  // For clock subscriptions
  clockid: number;
  timeout: bigint;
  flags: number;
  // For fd subscriptions
  fd: number;

  constructor() {
    this.userdata = 0n;
    this.eventtype = 0;
    this.clockid = 0;
    this.timeout = 0n;
    this.flags = 0;
    this.fd = 0;
  }

  static size(): number {
    return 48;
  }

  static read_bytes(view: DataView, ptr: number): Subscription {
    const sub = new Subscription();
    sub.userdata = view.getBigUint64(ptr, true);
    sub.eventtype = view.getUint8(ptr + 8);

    if (sub.eventtype === EVENTTYPE_CLOCK) {
      sub.clockid = view.getUint32(ptr + 16, true);
      sub.timeout = view.getBigUint64(ptr + 24, true);
      // precision at ptr + 32
      sub.flags = view.getUint16(ptr + 40, true);
    } else {
      sub.fd = view.getUint32(ptr + 16, true);
    }

    return sub;
  }
}

export class Event {
  userdata: bigint;
  error: number;
  type: number;
  nbytes: bigint;
  flags: number;

  constructor(
    userdata: bigint,
    error: number,
    type: number,
    nbytes: bigint = 0n,
    flags: number = 0,
  ) {
    this.userdata = userdata;
    this.error = error;
    this.type = type;
    this.nbytes = nbytes;
    this.flags = flags;
  }

  static size(): number {
    return 32;
  }

  write_bytes(view: DataView, ptr: number): void {
    view.setBigUint64(ptr, this.userdata, true);
    view.setUint16(ptr + 8, this.error, true);
    view.setUint8(ptr + 10, this.type);
    view.setBigUint64(ptr + 16, this.nbytes, true);
    view.setUint16(ptr + 24, this.flags, true);
  }
}
