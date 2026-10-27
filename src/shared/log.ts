type LogSink = (...args: unknown[]) => void;

const base = globalThis.Logs
  ? new globalThis.Logs("qwqnt-nudge")
  : (...args: unknown[]) => console.log("[qwqnt-nudge]", ...args);

let sink: LogSink | undefined;

export function setLogSink(fn: LogSink) {
  sink = fn;
}

export function log(...args: unknown[]) {
  base(...args);
  try {
    sink?.(...args);
  } catch {}
}
