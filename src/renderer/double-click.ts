import type { NudgeAPI, PokePayload } from "./types";
import { waitForBridge, stopImmediate } from "./utils";
import { resolvePokeTarget, sendPoke } from "./poke";
import { log } from "../shared/log";

export async function initDoubleClickPoke() {
  let enabled = false;
  let api: NudgeAPI;
  let pending: {
    time: number;
    x: number;
    y: number;
    target: Element;
    payload: PokePayload;
  } | null = null;
  let suppressUntil = 0;
  try {
    api = await waitForBridge();
    const c = await api.getConfig();
    enabled = c?.doubleClickPoke?.enabled === true;
    api.onConfigChange((c) => {
      enabled = c?.doubleClickPoke?.enabled === true;
    });
  } catch (e) {
    log("double-click init failed", e);
    return;
  }

  document.addEventListener(
    "pointerdown",
    (ev) => {
      if (!enabled || ev.button !== 0) {
        pending = null;
        return;
      }
      const target = resolvePokeTarget(ev);
      if (target === null) {
        pending = null;
        return;
      }
      if (target === "suppress") {
        stopImmediate(ev);
        suppressUntil = performance.now() + 650;
        pending = null;
        return;
      }
      const { avatar, payload } = target;
      const now = performance.now();
      const prev = pending;
      if (
        prev &&
        prev.target === avatar &&
        now - prev.time <= 480 &&
        Math.hypot(ev.clientX - prev.x, ev.clientY - prev.y) <= 20
      ) {
        stopImmediate(ev);
        suppressUntil = performance.now() + 650;
        pending = null;
        sendPoke(prev.payload, avatar, api);
        return;
      }
      stopImmediate(ev);
      suppressUntil = performance.now() + 650;
      pending = {
        time: now,
        x: ev.clientX,
        y: ev.clientY,
        target: avatar,
        payload,
      };
      setTimeout(() => {
        if (pending?.time === now) pending = null;
      }, 500);
    },
    true,
  );

  document.addEventListener(
    "click",
    (ev) => {
      if (performance.now() <= suppressUntil) stopImmediate(ev);
    },
    true,
  );

  document.addEventListener(
    "dblclick",
    (ev) => {
      if (!enabled || ev.button !== 0) return;
      if (performance.now() <= suppressUntil) {
        stopImmediate(ev);
        return;
      }
      const target = resolvePokeTarget(ev);
      if (target === null) return;
      stopImmediate(ev);
      suppressUntil = performance.now() + 650;
      pending = null;
      if (target === "suppress") return;
      sendPoke(target.payload, target.avatar, api);
    },
    true,
  );
}
