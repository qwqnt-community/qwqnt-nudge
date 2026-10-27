import { ipcMain, webContents } from "electron";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { log, setLogSink } from "../shared/log";

let logPath = "";
setLogSink((...args: unknown[]) => {
  try {
    if (!logPath) {
      const qwqnt = (
        globalThis as unknown as {
          qwqnt?: { framework?: { paths?: { data?: string } } };
        }
      ).qwqnt;
      const dir = path.join(
        qwqnt?.framework?.paths?.data ??
          path.join(__dirname, "..", "..", "..", "data"),
        "qwqnt-nudge",
      );
      fs.mkdirSync(dir, { recursive: true });
      logPath = path.join(dir, "debug.log");
      try {
        if (fs.statSync(logPath).size > 1024 * 1024)
          fs.writeFileSync(logPath, "");
      } catch {}
    }
    const line = args
      .map((v) =>
        typeof v === "string" ? v : (JSON.stringify(v) ?? String(v)),
      )
      .join(" ");
    fs.appendFileSync(
      logPath,
      `[${new Date().toTimeString().slice(0, 8)}] ${line}\n`,
    );
  } catch {}
});

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
  msgId?: string;
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
      subElementType?: unknown;
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

interface PokeInfo {
  uid: string;
  targetUid: string;
  uin: string;
  targetUin: string;
  hasTemplParam: boolean;
  raw: string;
}

interface IpcResult {
  cmdData?: unknown;
  error?: string;
}

interface IpcCommand {
  cmdName?: string;
  payload?: unknown;
}

export default {
  onLoad() {
    const stored = PluginSettings.main.readConfig<Config>(
      "qwqnt-nudge",
      DEFAULT_CONFIG,
    );
    let config = {
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

    const MSG_STREAMS = new Set([
      "nodeIKernelMsgListener/onRecvMsg",
      "nodeIKernelMsgListener/onMsgInfoListUpdate",
      "nodeIKernelMsgListener/onMsgInfoListAdd",
      "nodeIKernelMsgListener/onRecvActiveMsg",
      "nodeIKernelMsgListener/onActiveMsgInfoUpdate",
      "nodeIKernelMsgListener/onAddSendMsg",
      "nodeIKernelMsgListener/onRecvS2CMsg",
      "nodeIKernelMsgListener/onRecvSysMsg",
    ]);
    const lastNudgeTime = new Map<string, number>();
    const processedMsgIds = new Set<string>();
    const seenCmdNames = new Set<string>();
    const seenGrayTips = new Set<string>();
    let consecutiveCount = 0;
    let lastConsecutiveReset = 0;
    let selfUin = "";
    let selfUid = "";
    let lastSelfFetch = 0;
    let loggedWaiting = false;
    let lastSentNudge: {
      peerUid: string;
      initiator: string;
      time: number;
    } | null = null;

    async function processPoke(
      wcId: number,
      streamName: string,
      msg: ReceivedMessage,
      poke: PokeInfo,
    ) {
      const chatType = msg.chatType;
      const peerUid = msg.peerUid;
      log(
        "poke message seen via", streamName, "chatType:",
        chatType,
        "peerUid:",
        peerUid,
        "initiator:",
        poke.uin || poke.uid || "(none)",
        "target:",
        poke.targetUin || poke.targetUid || "(none)",
      );
      if (!chatType || !peerUid) return;
      const isGroup = chatType === 2;
      if (isGroup ? !config.autoPokeBack.groupEnabled : chatType !== 1) {
        log(
          "poke-back skipped: chatType",
          chatType,
          isGroup ? "(group auto-back disabled)" : "(unsupported chat type)",
        );
        return;
      }

      if (!poke.uin && !poke.targetUin && !poke.uid && !poke.targetUid) {
        log(
          "poke parse degraded, hasTemplParam:",
          poke.hasTemplParam,
          "raw:",
          poke.raw,
        );
        return;
      }
      const sameEntity = poke.uin
        ? poke.uin === poke.targetUin
        : poke.uid === poke.targetUid;
      if (sameEntity) {
        log("poke-back skipped: initiator is the target");
        return;
      }
      if (!selfUin || !selfUid) {
        const { uin, uid } = await fetchSelfInfo(wcId);
        if (uin) selfUin = uin;
        if (uid) selfUid = uid;
      }
      const iInitiated = poke.uin
        ? !!selfUin && poke.uin === selfUin
        : !!selfUid && poke.uid === selfUid;
      if (iInitiated) {
        log("poke-back skipped: initiated by self");
        return;
      }
      if (!selfUin && poke.targetUin) selfUin = poke.targetUin;
      if (!selfUid && poke.targetUid) selfUid = poke.targetUid;
      const initiatorUin =
        poke.uin ||
        (!isGroup && poke.uid === peerUid ? normalizeUin(msg.peerUin) : "");
      const targetsMe = poke.targetUin
        ? poke.targetUin === selfUin
        : poke.targetUid
          ? poke.targetUid === selfUid
          : false;
      // 1:1 chat: a poke not initiated by self is necessarily aimed at me
      if (isGroup && !targetsMe) {
        log("poke-back skipped: group poke not aimed at me");
        return;
      }
      log(
        "poke matched, chatType:",
        chatType,
        "initiator:",
        initiatorUin || poke.uid,
        "self:",
        selfUin || selfUid || "(unknown)",
      );
      const listHit = isGroup
        ? config.groupList.includes(peerUid) ||
          config.groupList.includes(normalizeUin(msg.peerUin))
        : config.userList.includes(initiatorUin) ||
          config.userList.includes(poke.uid);
      if (config.listMode === "blacklist" ? listHit : !listHit) {
        log(
          "poke-back skipped by",
          config.listMode + ":",
          isGroup ? peerUid : initiatorUin || poke.uid,
        );
        return;
      }
      if (
        isGroup &&
        lastSentNudge &&
        Date.now() - lastSentNudge.time < 5000 &&
        peerUid === lastSentNudge.peerUid &&
        (poke.uin || poke.uid) === lastSentNudge.initiator
      ) {
        log("poke-back skipped: duplicate group poke");
        return;
      }

      const { cooldown = 3000, maxConsecutive = 5 } = config.autoPokeBack;
      const cooldownKey = poke.uin || poke.uid;
      if (Date.now() - (lastNudgeTime.get(cooldownKey) ?? 0) < cooldown) {
        log("poke-back skipped: cooldown", cooldownKey);
        return;
      }
      if (Date.now() - lastConsecutiveReset > cooldown * 2)
        consecutiveCount = 0;
      if (consecutiveCount >= maxConsecutive) {
        log("poke-back skipped: maxConsecutive", consecutiveCount);
        return;
      }
      consecutiveCount++;
      lastConsecutiveReset = Date.now();
      lastNudgeTime.set(cooldownKey, Date.now());

      if (isGroup)
        lastSentNudge = {
          peerUid: peerUid,
          initiator: poke.uin || poke.uid,
          time: Date.now(),
        };
      let uin = initiatorUin;
      if (!uin && poke.uid) {
        const extractMappedUin = (data: unknown) => {
          if (!data || typeof data !== "object") return "";
          const holder = data as Record<string, unknown>;
          for (const c of [holder.uins, holder.uinInfo, holder]) {
            if (c instanceof Map) {
              const v = normalizeUin(c.get(poke.uid));
              if (v) return v;
            } else if (Array.isArray(c)) {
              for (const entry of c)
                if (Array.isArray(entry) && entry[0] === poke.uid) {
                  const v = normalizeUin(entry[1]);
                  if (v) return v;
                }
            } else if (c && typeof c === "object") {
              const v = normalizeUin(c[poke.uid]);
              if (v) return v;
            }
          }
          return "";
        };
        for (const [cmdName, payload] of [
          ["nodeIKernelProfileService/getUinByUid", ["FriendsServiceImpl", [poke.uid]]],
          ["nodeIKernelGroupService/getUinByUids", [[poke.uid]]],
        ] as Array<[string, unknown]>) {
          const r = await dispatchIpc(wcId, "ntApi", cmdName, payload).catch(
            () => null,
          );
          if (r?.error) {
            log("resolveUinByUid", cmdName, "error:", r.error);
            continue;
          }
          uin = extractMappedUin(r?.cmdData);
          if (uin) {
            log("uid resolved:", poke.uid, "->", uin);
            break;
          }
          log(
            "resolveUinByUid miss:",
            cmdName,
            JSON.stringify(r?.cmdData ?? null).slice(0, 200),
          );
        }
      }
      const target = uin ? { uin, uid: "" } : { uin: "", uid: poke.uid };
      const chatUin = isGroup
        ? normalizeUin(msg.peerUin) || peerUid
        : normalizeUin(msg.peerUin) || uin;
      log(
        "sending poke-back:",
        target.uin || target.uid,
        "->",
        isGroup ? `group ${peerUid}` : `peer ${peerUid}`,
      );
      const r = await sendNudge(wcId, chatType, peerUid, target, chatUin);
      if (r?.error) {
        log("sendNudge failed:", r.error);
        return;
      }
      const data = (r?.cmdData ?? {}) as {
        result?: number;
        errMsg?: string;
      };
      if (Number(data.result) === 0) log("poke-back sent");
      else log("sendNudge rejected:", JSON.stringify(r));
    }

    const ready = setInterval(() => {
      if (!IpcInterceptor) {
        if (!loggedWaiting) {
          loggedWaiting = true;
          log("waiting for IpcInterceptor global...");
        }
        return;
      }
      clearInterval(ready);
      log("auto poke-back listener registered");
      const wc = webContents.getAllWebContents()[0];
      if (wc)
        void fetchSelfInfo(wc.id).then(({ uin, uid }) => {
          if (uin) selfUin = uin;
          if (uid) selfUid = uid;
        });
      IpcInterceptor.onIpcSend(
        (ch: string, _e: unknown, cmd: IpcCommand) => {
          const cmdName = cmd?.cmdName;
          if (cmdName && !seenCmdNames.has(cmdName)) {
            seenCmdNames.add(cmdName);
            log("ipc event:", cmdName);
          }
          if (!cmdName || !MSG_STREAMS.has(cmdName)) return;
          const streamName = cmdName.replace("nodeIKernelMsgListener/", "");
          if (!config.autoPokeBack?.enabled) return;
          const wcId = Number(ch.replace("RM_IPCFROM_MAIN", ""));
          if (!wcId) return;
          if ((!selfUin || !selfUid) && Date.now() - lastSelfFetch > 30000) {
            lastSelfFetch = Date.now();
            void fetchSelfInfo(wcId).then(({ uin, uid }) => {
              if (uin) selfUin = uin;
              if (uid) selfUid = uid;
            });
          }
          const msgs: ReceivedMessage[] = [];
          const visit = (v: unknown, depth: number) => {
            if (!v || typeof v !== "object" || depth > 4) return;
            if (Array.isArray(v)) {
              const direct = v.filter(looksLikeMsg);
              if (direct.length) {
                msgs.push(...direct);
                return;
              }
              for (const item of v) visit(item, depth + 1);
              return;
            }
            const o = v as Record<string, unknown>;
            if (Array.isArray(o.msgList)) {
              msgs.push(...o.msgList.filter(looksLikeMsg));
              return;
            }
            if (looksLikeMsg(o.msgRecord)) {
              msgs.push(o.msgRecord);
              return;
            }
            if (looksLikeMsg(v)) {
              msgs.push(v);
              return;
            }
            for (const val of Object.values(o)) visit(val, depth + 1);
          };
          visit(cmd?.payload, 0);
          log("msg stream:", streamName, "count:", msgs.length);
          for (const msg of msgs) {
            for (const el of msg?.elements ?? []) {
              const tip = el?.grayTipElement;
              if (!tip) continue;
              const json = tip.jsonGrayTipElement;
              const busiId = String(json?.busiId ?? tip.subElementType ?? "?");
              const key = `${busiId}:${json ? "json" : "raw"}`;
              if (busiId !== "1061" && seenGrayTips.has(key)) continue;
              seenGrayTips.add(key);
              const detail = json?.jsonStr
                ? String(json.jsonStr).slice(0, 300)
                : JSON.stringify(Object.keys(tip));
              log("gray tip: stream:", streamName, "busiId:", busiId, detail);
            }
            const suin = normalizeUin(msg.senderUin);
            const suid = String(msg.senderUid ?? "");
            if (Number(msg.sendType) === 1) {
              if (!selfUin && suin) {
                selfUin = suin;
                log("selfUin learned:", selfUin);
              }
              if (!selfUid && suid.startsWith("u_") && suid.length > 2) {
                selfUid = suid;
                log("selfUid learned:", selfUid);
              }
            }
            const msgId = String(msg.msgId ?? "");
            if (msgId) {
              if (processedMsgIds.has(msgId)) continue;
              processedMsgIds.add(msgId);
              if (processedMsgIds.size > 512) {
                const oldest = processedMsgIds.values().next().value;
                if (oldest !== undefined) processedMsgIds.delete(oldest);
              }
            }
            let poke: PokeInfo | null = null;
            for (const el of msg?.elements ?? []) {
              const tip = el?.grayTipElement?.jsonGrayTipElement;
              if (String(tip?.busiId ?? "") !== "1061") continue;
              const users: { uid?: string; qn?: string | number }[] = [];
              try {
                const items = (JSON.parse(tip?.jsonStr ?? "{}").items ?? []) as {
                  uid?: string;
                  qn?: string | number;
                }[];
                users.push(...items.filter((i) => i?.uid));
              } catch {}
              const tp = tip?.xmlToJsonParam?.templParam;
              poke = {
                uid: String(users[0]?.uid ?? ""),
                targetUid: String(users[1]?.uid ?? ""),
                uin:
                  normalizeUin(
                    tp instanceof Map ? tp.get("uin_str1") : tp?.["uin_str1"],
                  ) || normalizeUin(users[0]?.qn),
                targetUin:
                  normalizeUin(
                    tp instanceof Map ? tp.get("uin_str2") : tp?.["uin_str2"],
                  ) || normalizeUin(users[1]?.qn),
                hasTemplParam: Boolean(tp),
                raw: String(tip?.jsonStr ?? "").slice(0, 400),
              };
              break;
            }
            if (!poke) continue;
            void processPoke(wcId, streamName, msg, poke);
          }
        },
      );
    }, 1000);
  },
};

function looksLikeMsg(v: unknown): v is ReceivedMessage {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    ("msgId" in o || "elements" in o) &&
    ("peerUid" in o || "chatType" in o || "senderUid" in o)
  );
}

function normalizeUin(value: unknown) {
  const s = String(value ?? "").trim();
  return /^\d+$/.test(s) && s !== "0" ? s : "";
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

function fetchSelfInfo(wcId: number) {
  const findSelfField = (
    obj: unknown,
    keys: string[],
    valid: (s: string) => boolean,
    depth = 0,
  ) => {
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
  };
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
