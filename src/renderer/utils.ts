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

export function getVueInstances(el: Element) {
  const out: unknown[] = [];
  const seen = new Set<unknown>();
  const vueEl = el as HTMLElement & { __vueParentComponent?: unknown };
  const arr = vueEl.__VUE__ ?? [];
  for (const i of Array.isArray(arr) ? arr : [arr])
    if (i && !seen.has(i)) {
      seen.add(i);
      out.push(i);
    }
  const pc = vueEl.__vueParentComponent;
  if (pc && !seen.has(pc)) out.push(pc);
  return out;
}

export function probeVueValue(el: Element, paths: string[]) {
  for (const inst of getVueInstances(el))
    for (const p of paths) {
      try {
        const v = p
          .split(".")
          .reduce((o, k) => (o as Record<string, unknown>)?.[k], inst);
        if (v != null) return v;
      } catch {}
    }
  return undefined;
}
