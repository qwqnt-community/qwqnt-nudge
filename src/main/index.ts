import { ipcMain, webContents } from "electron";
import crypto from "crypto";
import { log } from "../shared/log";

interface Config extends Record<string, unknown> {
  autoPokeBack: {
    enabled: boolean;
    groupEnabled: boolean;
    cooldown: number;
    maxConsecutive: number;
  };
  doubleClickPoke: { enabled: boolean };
  listMode: "blacklist" | "whitelist";
  groupList: string[];
  userList: string[];
}

const DEFAULT_CONFIG: Config = {
  autoPokeBack: {
    enabled: true,
    groupEnabled: false,
    cooldown: 3000,
    maxConsecutive: 5,
  },
  doubleClickPoke: { enabled: true },
  listMode: "blacklist",
  groupList: [],
  userList: [],
};

interface ReceivedMessage {
  sendType?: number;
  senderUin?: string | number;
  senderUid?: string;
  chatType?: number;
  msgType?: number;
  subMsgType?: number;
  peerUid?: string;
  peerUin?: string | number;
  elements?: Array<{
    grayTipElement?: {
      jsonGrayTipElement?: {
        busiId?: string | number;
        jsonStr?: string;
        xmlToJsonParam?: {
          templParam?: Map<string, string> | Record<string, string>;
        };
      };
    };
  } & Record<string, unknown>>;
}

interface IpcResult {
  cmdData?: unknown;
  error?: string;
}

function normalizeUin(value: unknown) {
  const s = String(value ?? "").trim();
  return /^\d+$/.test(s) && s !== "0" ? s : "";
}

function parseNudgePoke(msg: ReceivedMessage) {
  for (const el of msg?.elements ?? []) {
    const tip = el?.grayTipElement?.jsonGrayTipElement;
    if (String(tip?.busiId ?? "") !== "1061") continue;
    let uid = "";
    let targetUid = "";
    try {
      const items = (JSON.parse(tip?.jsonStr ?? "{}").items ??
        []) as { uid?: string }[];
      const uids = items.filter((i) => i?.uid).map((i) => String(i.uid));
      uid = uids[0] ?? "";
      targetUid = uids[1] ?? "";
    } catch {}
    const tp = tip?.xmlToJsonParam?.templParam;
    const get = (k: string) =>
      normalizeUin(tp instanceof Map ? tp.get(k) : tp?.[k]);
    return {
      uid,
      targetUid,
      uin: get("uin_str1"),
      targetUin: get("uin_str2"),
    };
  }
  return null;
}

function dispatchIpc(
  wcId: number,
  eventName: string,
  cmdName: string,
  payload: unknown,
) {
  const wc = webContents.fromId(wcId);
  if (!wc) return Promise.resolve<IpcResult>({ error: "no webContents" });
  const callbackId = crypto.randomUUID();
  const mainChannel = "RM_IPCFROM_MAIN" + wcId;
  const rendererChannel = "RM_IPCFROM_RENDERER" + wcId;
  return new Promise<IpcResult>((resolve) => {
    let settled = false;
    const finish = (v: IpcResult) => {
      if (settled) return;
      settled = true;
      unsub();
      clearTimeout(timer);
      resolve(v);
    };
    const unsub = IpcInterceptor.interceptIpcSend(
      (ch: string, ...a: unknown[]) => {
        const first = a[0] as { callbackId?: string } | undefined;
        if (ch !== mainChannel || first?.callbackId !== callbackId)
          return { action: "pass" as const };
        finish(a[1] as IpcResult);
        return { action: "block" as const };
      },
    );
    const timer = setTimeout(() => finish({ error: "timeout" }), 3000);
    const listeners = ipcMain.listeners(rendererChannel) as ((
      event: unknown,
      envelope: unknown,
      cmd: unknown,
    ) => void)[];
    if (!listeners.length) {
      finish({ error: "no listeners" });
      return;
    }
    const fakeEvent = {
      sender: wc,
      reply: (...a: unknown[]) => wc.send(rendererChannel, ...a),
    };
    for (const fn of listeners)
      try {
        fn(
          fakeEvent,
          { peerId: wcId, callbackId, type: "request", eventName },
          { cmdName, cmdType: "invoke", payload },
        );
      } catch (err) {
        log("listener error:", err);
      }
  });
}

function sendNudge(
  wcId: number,
  chatType: number,
  peerUid: string,
  target: { uin: string; uid: string },
  chatUin: string,
) {
  const param: Record<string, unknown> = {
    peer: { chatType, peerUid, guildId: "" },
    chatUin,
  };
  if (target.uin) param.targetUin = target.uin;
  if (target.uid) param.targetUid = target.uid;
  return dispatchIpc(
    wcId,
    "ntApi",
    "nodeIKernelMsgService/sendNudge",
    [param, null],
  );
}

function findSelfField(
  obj: unknown,
  keys: string[],
  valid: (s: string) => boolean,
  depth = 0,
) {
  if (!obj || typeof obj !== "object" || depth > 5) return "";
  const o = obj as Record<string, unknown>;
  for (const k of keys) {
    const s = String(o[k] ?? "").trim();
    if (valid(s)) return s;
  }
  for (const v of Object.values(o)) {
    const found = findSelfField(v, keys, valid, depth + 1);
    if (found) return found;
  }
  return "";
}

function fetchSelfInfo(wcId: number) {
  return dispatchIpc(wcId, "GlobalDataApi", "fetchAuthData", [])
    .then((r) => {
      if (r?.error) {
        log("fetchSelfInfo error:", r.error);
        return { uin: "", uid: "" };
      }
      const data = r?.cmdData ?? r;
      const info = {
        uin: findSelfField(
          data,
          ["uin", "selfUin", "accountUin"],
          (s) => /^\d+$/.test(s) && s !== "0",
        ),
        uid: findSelfField(
          data,
          ["uid", "selfUid"],
          (s) => s.startsWith("u_") && s.length > 2,
        ),
      };
      log("fetchSelfInfo:", info.uin || "(no uin)", info.uid || "(no uid)");
      return info;
    })
    .catch((e) => {
      log("fetchSelfInfo failed:", e);
      return { uin: "", uid: "" };
    });
}

export default {
  onLoad() {
    const stored = PluginSettings.main.readConfig<Config>(
      "qwqnt-nudge",
      DEFAULT_CONFIG,
    );
    let config: Config = {
      autoPokeBack: { ...DEFAULT_CONFIG.autoPokeBack, ...stored.autoPokeBack },
      doubleClickPoke: {
        ...DEFAULT_CONFIG.doubleClickPoke,
        ...stored.doubleClickPoke,
      },
      listMode: stored.listMode ?? DEFAULT_CONFIG.listMode,
      groupList: stored.groupList ?? DEFAULT_CONFIG.groupList,
      userList: stored.userList ?? DEFAULT_CONFIG.userList,
    };
    PluginSettings.main.writeConfig("qwqnt-nudge", config);

    ipcMain.handle("nudge:get-config", () => ({ ...config }));
    ipcMain.on("nudge:set-config", (_, patch: Partial<Config>) => {
      if (patch.autoPokeBack)
        Object.assign(config.autoPokeBack, patch.autoPokeBack);
      if (patch.doubleClickPoke)
        Object.assign(config.doubleClickPoke, patch.doubleClickPoke);
      if (patch.listMode !== undefined) config.listMode = patch.listMode;
      if (patch.groupList !== undefined) config.groupList = patch.groupList;
      if (patch.userList !== undefined) config.userList = patch.userList;
      PluginSettings.main.writeConfig("qwqnt-nudge", config);
      webContents.getAllWebContents().forEach((w) => {
        if (!w.isDestroyed()) w.send("nudge:config-changed", { ...config });
      });
    });
    ipcMain.handle(
      "nudge:send",
      async (
        e,
        {
          chatType,
          peerUid,
          targetUin,
        }: {
          chatType: number;
          peerUid: string;
          targetUin: string;
        },
      ) => {
        const r = await sendNudge(
          e.sender.id,
          chatType,
          peerUid,
          { uin: targetUin, uid: "" },
          chatType === 2 ? peerUid : targetUin,
        );
        return r.cmdData ?? r.error;
      },
    );

    const lastNudgeTime = new Map<string, number>();
    let consecutiveCount = 0;
    let lastConsecutiveReset = 0;
    let selfUin = "";
    let selfUid = "";
    let lastSentNudge: {
      peerUid: string;
      targetUin: string;
      time: number;
    } | null = null;

    const ready = setInterval(() => {
      if (!IpcInterceptor) return;
      clearInterval(ready);
      const wc = webContents.getAllWebContents()[0];
      if (wc)
        void fetchSelfInfo(wc.id).then(({ uin, uid }) => {
          if (uin) selfUin = uin;
          if (uid) selfUid = uid;
        });
      IpcInterceptor.onIpcSend(
        (
          ch: string,
          _e: unknown,
          cmd: { cmdName?: string; payload?: { msgList?: ReceivedMessage[] } },
        ) => {
          if (cmd?.cmdName !== "nodeIKernelMsgListener/onRecvMsg") return;
          if (!config.autoPokeBack?.enabled) return;
          const wcId = Number(ch.replace("RM_IPCFROM_MAIN", ""));
          if (!wcId) return;
          if (!selfUin || !selfUid)
            void fetchSelfInfo(wcId).then(({ uin, uid }) => {
              if (uin) selfUin = uin;
              if (uid) selfUid = uid;
            });
          const msgList = cmd.payload?.msgList ?? [];
          for (const msg of msgList) {
            if (Number(msg.sendType) === 1) {
              const suin = normalizeUin(msg.senderUin);
              const suid = String(msg.senderUid ?? "");
              if (!selfUin && suin) selfUin = suin;
              if (!selfUid && suid.startsWith("u_") && suid.length > 2)
                selfUid = suid;
            }
            const poke = parseNudgePoke(msg);
            if (!poke) continue;
            const chatType = msg.chatType;
            const peerUid = msg.peerUid;
            if (!chatType || !peerUid) continue;
            const isGroup = chatType === 2;
            if (isGroup ? !config.autoPokeBack.groupEnabled : chatType !== 1)
              continue;

            if (!poke.uin && !poke.targetUin && !poke.uid && !poke.targetUid)
              continue;
            const sameEntity = poke.uin
              ? poke.uin === poke.targetUin
              : poke.uid === poke.targetUid;
            if (sameEntity) continue;
            const iInitiated = poke.uin
              ? !!selfUin && poke.uin === selfUin
              : !!selfUid && poke.uid === selfUid;
            if (iInitiated) continue;
            const targetsMe = poke.targetUin
              ? poke.targetUin === selfUin
              : poke.targetUid
                ? poke.targetUid === selfUid
                : false;
            if (!targetsMe && !isGroup) {
              // 1:1 chat: a poke initiated by the peer must be aimed at me
              const peerUin = normalizeUin(msg.peerUin);
              if (
                (poke.uin && peerUin && poke.uin === peerUin) ||
                (poke.uid && poke.uid === peerUid)
              ) {
                if (!selfUin && poke.targetUin) selfUin = poke.targetUin;
                if (!selfUid && poke.targetUid) selfUid = poke.targetUid;
              } else continue;
            } else if (!targetsMe) continue;
            log(
              "poke matched, chatType:",
              chatType,
              "initiator:",
              poke.uin || poke.uid,
              "target:",
              poke.targetUin || poke.targetUid,
              "self:",
              selfUin || selfUid,
            );
            if (
              isGroup
                ? config.listMode === "blacklist"
                  ? config.groupList.includes(peerUid)
                  : !config.groupList.includes(peerUid)
                : config.listMode === "blacklist"
                  ? config.userList.includes(poke.uin)
                  : !config.userList.includes(poke.uin)
            )
              continue;
            if (
              isGroup &&
              lastSentNudge &&
              Date.now() - lastSentNudge.time < 5000 &&
              peerUid === lastSentNudge.peerUid &&
              poke.targetUin === lastSentNudge.targetUin
            )
              continue;

            const { cooldown = 3000, maxConsecutive = 5 } = config.autoPokeBack;
            const cooldownKey = poke.uin || poke.uid;
            if (Date.now() - (lastNudgeTime.get(cooldownKey) ?? 0) < cooldown)
              continue;
            if (Date.now() - lastConsecutiveReset > cooldown * 2)
              consecutiveCount = 0;
            if (consecutiveCount >= maxConsecutive) continue;
            consecutiveCount++;
            lastConsecutiveReset = Date.now();
            lastNudgeTime.set(cooldownKey, Date.now());

            if (isGroup)
              lastSentNudge = {
                peerUid: peerUid,
                targetUin: poke.uin,
                time: Date.now(),
              };
            const chatUin = isGroup
              ? normalizeUin(msg.peerUin) || peerUid
              : normalizeUin(msg.peerUin) || poke.uin;
            void sendNudge(
              wcId,
              chatType,
              peerUid,
              { uin: poke.uin, uid: poke.uid },
              chatUin,
            ).then((r) => {
              if (r?.error) log("sendNudge failed:", r.error);
            });
          }
        },
      );
    }, 1000);
  },
};
