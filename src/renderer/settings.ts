import type { NudgeConfig } from "./types";
import { waitForBridge } from "./utils";
import { log } from "../shared/log";

const buildPatch = (path: string, value: unknown) => {
  const [ns, key] = path.split(".");
  return ns && key ? { [ns]: { [key]: value } } : { [path]: value };
};

export async function renderSettings() {
  try {
    const api = await waitForBridge();
    const view = await PluginSettings.renderer.registerPluginSettings({
      name: "qwqnt-nudge",
      qwqnt: { name: "Nudge" },
    });

    view.innerHTML = `
      <setting-section data-title="「戳一戳」">
        <setting-panel>
          <setting-list data-direction="column">
            <setting-item data-direction="row">
              <div>
                <setting-text>自动回戳</setting-text>
                <setting-text data-type="secondary">收到「戳一戳」时自动戳回去</setting-text>
              </div>
              <setting-switch data-path="autoPokeBack.enabled"></setting-switch>
            </setting-item>
            <setting-item data-direction="row">
              <div>
                <setting-text>群聊自动回戳</setting-text>
                <setting-text data-type="secondary">群聊中收到「戳一戳」时自动戳回去</setting-text>
              </div>
              <setting-switch data-path="autoPokeBack.groupEnabled"></setting-switch>
            </setting-item>
            <setting-item data-direction="row">
              <div>
                <setting-text>冷却时间</setting-text>
                <setting-text data-type="secondary">最小回复间隔（ms）</setting-text>
              </div>
              <input class="nudge-input" type="number" data-path="autoPokeBack.cooldown" min="0" max="60000" step="1000">
            </setting-item>
            <setting-item data-direction="row">
              <div>
                <setting-text>最大连续次数</setting-text>
                <setting-text data-type="secondary">防止无限互戳</setting-text>
              </div>
              <input class="nudge-input" type="number" data-path="autoPokeBack.maxConsecutive" min="1" max="50" step="1">
            </setting-item>
            <setting-item data-direction="row">
              <div>
                <setting-text>列表模式</setting-text>
                <setting-text data-type="secondary">黑名单跳过列表内对象，白名单仅回复列表内对象</setting-text>
              </div>
              <setting-select data-path="listMode">
                <setting-option data-value="blacklist" is-selected>黑名单</setting-option>
                <setting-option data-value="whitelist">白名单</setting-option>
              </setting-select>
            </setting-item>
            <setting-item data-direction="row">
              <div>
                <setting-text>群聊白/黑名单</setting-text>
                <setting-text data-type="secondary">群号，英文逗号分隔</setting-text>
              </div>
              <input class="nudge-input nudge-list-input" type="text" data-path="groupList" data-list placeholder="群号">
            </setting-item>
            <setting-item data-direction="row">
              <div>
                <setting-text>用户白/黑名单</setting-text>
                <setting-text data-type="secondary">QQ号，英文逗号分隔</setting-text>
              </div>
              <input class="nudge-input nudge-list-input" type="text" data-path="userList" data-list placeholder="QQ号">
            </setting-item>
            <setting-item data-direction="row">
              <div>
                <setting-text>双击头像「戳一戳」</setting-text>
                <setting-text data-type="secondary">替换默认行为</setting-text>
              </div>
              <setting-switch data-path="doubleClickPoke.enabled"></setting-switch>
            </setting-item>
          </setting-list>
        </setting-panel>
      </setting-section>
    `;

    view.addEventListener("click", (event) => {
      if (!(event.target instanceof Element)) return;
      const control = event.target.closest("setting-switch");
      const path = control?.getAttribute("data-path");
      if (!control || !path) return;
      const active = !control.hasAttribute("is-active");
      control.toggleAttribute("is-active", active);
      api.setConfig(buildPatch(path, active));
    });

    view.addEventListener("change", (event) => {
      if (!(event.target instanceof HTMLInputElement)) return;
      const path = event.target.dataset.path;
      if (!path) return;
      const value = event.target.hasAttribute("data-list")
        ? event.target.value.split(/[,\s]+/).filter(Boolean)
        : Number(event.target.value);
      api.setConfig(buildPatch(path, value));
    });

    const select = view.querySelector<HTMLElement>(
      'setting-select[data-path="listMode"]',
    );
    let applyingListMode = false;
    select?.addEventListener("selected", (event) => {
      if (applyingListMode) return;
      const value = (event as CustomEvent<{ value: string }>).detail.value;
      api.setConfig(buildPatch(select.dataset.path!, value));
    });

    const apply = (config: NudgeConfig) => {
      for (const control of view.querySelectorAll<HTMLElement>("[data-path]")) {
        const path = control.dataset.path;
        if (!path) continue;
        const value = path.split(".").reduce<unknown>((v, key) => {
          if (!v || typeof v !== "object") return undefined;
          return (v as Record<string, unknown>)[key];
        }, config);
        if (control.matches("setting-switch")) {
          control.toggleAttribute("is-active", value === true);
          continue;
        }
        if (control === select) {
          const selectedValue =
            value === "whitelist" ? "whitelist" : "blacklist";
          const option = [
            ...control.querySelectorAll<HTMLElement>("setting-option"),
          ].find((item) => item.getAttribute("data-value") === selectedValue);
          if (option && !option.hasAttribute("is-selected")) {
            applyingListMode = true;
            option.click();
            applyingListMode = false;
          }
          continue;
        }
        if (control instanceof HTMLInputElement && value !== undefined)
          control.value = Array.isArray(value)
            ? value.join(", ")
            : String(value);
      }
    };

    apply(await api.getConfig());
    api.onConfigChange(apply);
  } catch (e) {
    log("settings error", e);
  }
}
