# qwqnt-nudge

  为 QwQNT 提供「戳一戳」自动回戳与双击头像戳一戳的插件

## 功能

- 收到私聊「戳一戳」时自动戳回, 仅当自己是被戳目标
- 群聊回戳默认关闭, 可在设置中开启
- 群聊与用户黑名单/白名单, 支持模式切换
- 可配置回复冷却时间与最大连续次数, 防止无限互戳
- 双击消息头像发送「戳一戳」, 私聊与群聊均可用

## 环境要求

- QQNT >= `v9.9.32.50776`
- QwQNT 框架
- [`qwqnt-ipc-interceptor`](https://github.com/qwqnt-community/qwqnt-ipc-interceptor) >= `1.2.1`
- [`qwqnt-hako`](https://github.com/qwqnt-community/qwqnt-hako) >= `1.0.0`
- [`qwqnt-ipc-logger`](https://github.com/qwqnt-community/qwqnt-ipc-logger) >= `1.3.1` (可选, 启用结构化日志)

  依赖插件须与本体安装在同一 QwQNT 插件目录; 已在 `qwqnt.dependencies` 中声明

## 安装

1. 下载 release 压缩包
2. 解压到 `qwqnt-storage/plugins/qwqnt-nudge/`
3. 重启 QQ
4. 打开 QQ 设置, 找到 `Nudge`

## 反馈

  问题请反馈至 <https://github.com/qwqnt-community/qwqnt-nudge/issues>

## 许可证

  Apache-2.0, 见 [LICENSE](./LICENSE)

## 致谢

- [QwQNT-PluginTemplate-Vite-pnpm](https://github.com/adproqwq/QwQNT-PluginTemplate-Vite-pnpm/)
- [QQNT-Toolbox](https://github.com/MeiYongAI/QQNT-Toolbox)
