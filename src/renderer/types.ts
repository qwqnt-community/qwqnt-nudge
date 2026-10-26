export interface NudgeConfig {
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

export interface NudgeAPI {
  getConfig: () => Promise<NudgeConfig>;
  setConfig: (patch: Record<string, unknown>) => void;
  onConfigChange: (cb: (c: NudgeConfig) => void) => void;
  sendNudge: (
    chatType: number,
    peerUid: string,
    targetUin: string,
  ) => Promise<{ result?: number }>;
}

export interface PokePayload {
  chatType: number;
  peerUid: string;
  targetUin: string;
}

export interface MsgRecord {
  msgId?: string;
  msgSeq?: string;
  elements?: unknown[];
  chatType?: number;
  peerUid?: string;
  peerUin?: string | number;
  senderUin?: string | number;
  peer?: { peerUid?: string; peerUin?: string | number; chatType?: number };
  sender?: { uin?: string | number };
  sendType?: number;
  [k: string]: unknown;
}

export interface AioData {
  chatType?: number;
  type?: number;
  aioType?: number;
  peerUid?: string;
  peerUin?: string | number;
  peer?: { chatType?: number; peerUid?: string; peerUin?: string | number };
  contact?: { chatType?: number };
  header?: {
    chatType?: number;
    type?: number;
    peerUid?: string;
    peerUin?: string | number;
    uin?: string | number;
    uid?: string;
    contact?: { chatType?: number };
    peer?: { chatType?: number; peerUid?: string; peerUin?: string | number };
  };
  [k: string]: unknown;
}
