import type { AioData, MsgRecord, NudgeAPI, PokePayload } from "./types";
import { log } from "../shared/log";

function getVueInstances(el: Element) {
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

function probeVueValue(el: Element, paths: string[]) {
  for (const inst of getVueInstances(el))
    for (const p of paths) {
      try {
        const v = p
          .split(".")
          .reduce(
            (o: unknown, k: string) => (o as Record<string, unknown>)?.[k],
            inst,
          );
        if (v != null) return v;
      } catch {}
    }
  return undefined;
}

function isMsgRecord(v: unknown): v is MsgRecord {
  const r = v as Record<string, unknown>;
  return Boolean(
    v &&
      typeof v === "object" &&
      typeof r.msgId === "string" &&
      typeof r.msgSeq === "string" &&
      Array.isArray(r.elements),
  );
}

function deepFindRecord(
  val: unknown,
  depth = 0,
  seen = new WeakSet<object>(),
): MsgRecord | null {
  if (
    !val ||
    depth > 4 ||
    typeof val !== "object" ||
    seen.has(val) ||
    val instanceof Element ||
    val instanceof Uint8Array ||
    val instanceof Map
  )
    return null;
  seen.add(val);
  if (isMsgRecord(val)) return val;
  const r = val as Record<string, unknown>;
  for (const k of [
    "props",
    "setupState",
    "ctx",
    "proxy",
    "msgRecord",
    "message",
    "record",
    "msg",
  ]) {
    try {
      const found = deepFindRecord(r[k], depth + 1, seen);
      if (found) return found;
    } catch {}
  }
  return null;
}

function findMsgRecord(el: Element): MsgRecord | null {
  const container = el.closest(
    ".message.vue-component, .ml-item, .message, [id]",
  );
  const candidates: Element[] = [];
  for (
    let n: Element | null = el;
    n && n !== document.body;
    n = n.parentElement
  )
    candidates.push(n);
  if (container) {
    candidates.push(container);
    candidates.push(
      ...Array.from(container.querySelectorAll("*")).slice(0, 80),
    );
  }
  for (const c of candidates) {
    const d = probeVueValue(c, [
      "props.msgRecord",
      "ctx.msgRecord",
      "proxy.msgRecord",
      "props.message",
      "ctx.message",
      "proxy.message",
    ]);
    if (isMsgRecord(d)) return d;
    for (const inst of getVueInstances(c)) {
      const f = deepFindRecord(inst);
      if (f) return f;
    }
  }
  return null;
}

function getChatContext(avatar: Element) {
  const record = findMsgRecord(avatar);
  const aioEl =
    document.querySelector(".aio.vue-component") ??
    document.querySelector(".aio");
  const aioData = (
    aioEl
      ? probeVueValue(aioEl, [
          "proxy.commonAioStore.curAioData",
          "ctx.commonAioStore.curAioData",
        ])
      : null
  ) as AioData | null;

  const selfUin = String(
    aioEl
      ? (probeVueValue(aioEl, [
          "proxy.selfUin",
          "ctx.selfUin",
          "proxy.authData.uin",
          "ctx.authData.uin",
          "proxy.commonAioStore.authData.uin",
          "ctx.commonAioStore.authData.uin",
        ]) ?? "")
      : "",
  );

  const h = aioData?.header ?? {};
  const chatTypes = [
    aioData?.chatType,
    aioData?.type,
    aioData?.aioType,
    aioData?.peer?.chatType,
    aioData?.contact?.chatType,
    h.chatType,
    h.type,
    h.peer?.chatType,
    h.contact?.chatType,
    record?.chatType,
    record?.peer?.chatType,
  ]
    .map(Number)
    .filter((v) => v > 0);
  return {
    record,
    aioData,
    chatType: chatTypes[0] ?? 0,
    isTemporary: chatTypes.some((t) =>
      [99, 100, 101, 102, 103, 111, 117, 119].includes(t),
    ),
    selfUin: /^\d+$/.test(selfUin) ? selfUin : "",
  };
}

function buildPokePayload(ctx: ReturnType<typeof getChatContext>) {
  if (ctx.isTemporary) return null;
  const { record, aioData, chatType, selfUin } = ctx;
  const puid =
    record?.peerUid ??
    record?.peer?.peerUid ??
    aioData?.peerUid ??
    aioData?.peer?.peerUid ??
    aioData?.header?.peerUid ??
    aioData?.header?.uid ??
    "";
  const puin = [
    record?.peerUin,
    record?.peer?.peerUin,
    record?.peerUid,
    aioData?.peerUin,
    aioData?.peer?.peerUin,
    aioData?.header?.uin,
    aioData?.header?.peerUin,
    aioData?.header?.uid,
    aioData?.header?.peerUid,
  ].find((v) => /^\d+$/.test(String(v)));

  const senderUin = String(record?.senderUin ?? record?.sender?.uin ?? "");

  if (chatType === 2) {
    const guin = String(puin || puid);
    const groupTuin =
      senderUin && senderUin !== "0"
        ? senderUin
        : Number(record?.sendType) === 1 && selfUin
          ? selfUin
          : "";
    if (!guin || !groupTuin) return null;
    return { chatType: 2, peerUid: guin, targetUin: groupTuin };
  }
  if (chatType === 1) {
    const tuin =
      senderUin && senderUin !== "0" ? senderUin : String(puin ?? "");
    if (!tuin) return null;
    return { chatType: 1, peerUid: puid, targetUin: tuin };
  }
  return null;
}

export function resolvePokeTarget(ev: Event) {
  const avatar = (ev.composedPath?.() ?? [ev.target]).find(
    (el): el is Element =>
      el instanceof Element &&
      [
        ".avatar-span .avatar",
        ".avatar.message-container__avatar",
        "[class*=avatar i]",
        "[data-testid*=avatar i]",
      ].some((sel) => el.matches?.(sel)) &&
      findMsgRecord(el) !== null,
  );
  if (!avatar) {
    log("resolvePokeTarget: no avatar found");
    return null;
  }
  const ctx = getChatContext(avatar);
  log(
    "resolvePokeTarget: chatType=",
    ctx.chatType,
    "isTemporary=",
    ctx.isTemporary,
    "record=",
    !!ctx.record,
    "selfUin=",
    ctx.selfUin || "(empty)",
  );
  if (ctx.isTemporary) {
    log("resolvePokeTarget: temporary chat, suppressing");
    return "suppress" as const;
  }
  const payload = buildPokePayload(ctx);
  if (!payload) {
    log("resolvePokeTarget: buildPokePayload returned null");
    return null;
  }
  log("resolvePokeTarget: payload built", JSON.stringify(payload));
  return { avatar, payload } as const;
}

export function sendPoke(payload: PokePayload, avatar: Element, api: NudgeAPI) {
  api
    .sendNudge(payload.chatType, payload.peerUid, payload.targetUin)
    .then((r) => {
      if (r?.result === 0) {
        avatar.classList.remove("nudge-shake");
        void (avatar as HTMLElement).offsetWidth;
        avatar.classList.add("nudge-shake");
      }
    })
    .catch((e: unknown) => log("sendPoke failed", e));
}
