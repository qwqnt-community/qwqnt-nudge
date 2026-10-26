export const log = globalThis.Logs
  ? new globalThis.Logs("qwqnt-nudge")
  : (...args: unknown[]) => console.log("[qwqnt-nudge]", ...args);
