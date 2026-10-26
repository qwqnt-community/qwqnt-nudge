import type { NudgeAPI } from "./types";

export function waitForBridge(): Promise<NudgeAPI> {
  return new Promise((resolve, reject) => {
    let tries = 0;
    const poll = () => {
      const b = (window as unknown as { nudgeDebug?: NudgeAPI }).nudgeDebug;
      if (b) return resolve(b);
      if (++tries > 50)
        return reject(new Error("nudgeDebug bridge not available"));
      setTimeout(poll, 200);
    };
    poll();
  });
}

export function stopImmediate(ev: Event) {
  ev.preventDefault();
  ev.stopPropagation();
  ev.stopImmediatePropagation();
}
