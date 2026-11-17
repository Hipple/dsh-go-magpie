<p align="center">
  <b>简体中文</b> · <a href="README.en.md">English</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/dsh-go-magpie"><img alt="NPM v1.3.7" src="https://img.shields.io/badge/NPM-V1.3.7-6366F1?style=for-the-badge&labelColor=1E1B4B"></a>
  <a href="LICENSE"><img alt="License MIT" src="https://img.shields.io/badge/LICENSE-MIT-10B981?style=for-the-badge&labelColor=064E3B"></a>
  <a href="https://github.com/ccch1mneyyy/dsh-Go"><img alt="DSH plugin" src="https://img.shields.io/badge/DSH-PLUGIN-8B5CF6?style=for-the-badge&labelColor=2E1065"></a>
  <a href="package.json"><img alt="Node 22+" src="https://img.shields.io/badge/NODE-22%2B-F59E0B?style=for-the-badge&labelColor=451A03"></a>
</p>

<p align="center">
  <a href="https://github.com/Hipple/dsh-go-magpie"><img alt="GitHub Hipple/dsh-go-magpie" src="https://img.shields.io/badge/GITHUB-Hipple%2Fdsh--go--magpie-FF4500?style=for-the-badge&logo=github&logoColor=white&labelColor=1A1A2E"></a>
</p>

# dsh-go-magpie

[magpie](https://github.com/yetone/magpie) 让 Codex、Claude Code 这类 agent 都接到你想要的模型上：它在本机开一个网关，agent 把地址指过来就行。DSH Go 把整套引擎塞进了手机里的 Ubuntu 环境，于是为了用上它，你得先手动装 magpie、盯着它有没有一直活着，每次重启还要重新接一遍——这些琐事和「让 agent 干活」本身没什么关系。

这个插件把这段收掉：它在 DSH Go 的引擎环境里装好 magpie，跟着引擎的生命周期托管网关（需要时连网页控制台一起），再在 App 里给一个面板看状态、改设置。装好之后，日常就是在面板上点两下。

## 先跑起来

打开对话详情页的「插件」页签（或「全部功能」里的 Magpie 入口）。首次加载会自动安装并启动，安装过程和日志在面板里能直接看到。面板依赖 dsh-go 桥接，只在有桥接的主机（手机本机引擎等）出现；没有桥接时插件照样装、照样起网关，只是没有界面。

- 状态行告诉你现在是运行中、未安装还是已装未启动，附版本和启动方式。
- 按钮上方是地址，点一下直接复制；网页版模式下第二行是带 key 的网页版地址。
- 按钮为启动 / 停止 / 查看状态 / 安装，当前能用的那个会高亮；点不能用的只回一句提示。
- 出问题先点「查看状态」，它会把 `magpie --version`、`healthcheck`、端口和进程情况写进日志区。

## 两种启动方式

- `web`（默认）：跑 `magpie web`，网关之外再起一个 magpie 网页控制台，地址形如 `http://127.0.0.1:3430/?k=<key>`，适合想直接用网页界面的人。
- `serve`：只跑 `magpie serve`，只有本地网关 `http://127.0.0.1:3425`，给 Claude Code、Codex 这类 agent 指过去用。

App 打不开 `http://` 链接，所以面板给的不是「打开」而是「复制地址」，粘到浏览器即可。

网页版 key 留空时，magpie 每次启动都会换一把，插件从启动日志里读出 `?k=` 后面的值；重启后请重新复制地址。想固定就在设置里填一把（至少 16 个字母、数字或 `-._~`），插件会通过 `MAGPIE_WEB_KEY` 传给 magpie。

## 设置

在面板的「设置」页签里改，保存即写入 `data/settings.json`：

- 启动方式：`web` 或 `serve`。
- 网关端口（默认 3425）；选 `web` 时再多一个网页版端口（默认 3430）。
- 网页版 key（可选）。
- 代理用法：不用 / 直连失败再试代理 / 始终用代理，以及代理地址。只有后两种才显示地址框。
- 随引擎自动启动（默认开）。

改启动方式或代理用法时，字段显隐会立刻跟着变，不用先保存。保存后如果网关是本插件起的，插件会自动按新设置重启；没在运行就只更新设置。

## 安装

dsh-go 原生插件就是主机上的一个 npm 包目录，安装装的是指向它的链接：

```sh
dsh plugin --profile web add dsh-go-magpie
```

从源码装（链接指向目录，目录要留着）：

```sh
git clone https://github.com/Hipple/dsh-go-magpie ~/.dsh/dsh-go/plugins/dsh-go-magpie
dsh plugin --profile web add ~/.dsh/dsh-go/plugins/dsh-go-magpie
```

装上即生效，不用重启 App。改了 `lib/` 里的代码要在「引擎」页重启引擎；只改 `package.json` 的 `dshGo` 会自动重读。卸载：`dsh plugin --profile web remove dsh-go-magpie`。

同一个包也是普通 Cordis bundle，装进 Harness 网页版时没有原生面板，只有引擎侧行为。

## 它做了什么

1. 先看 `~/.local/bin/magpie --version` 能不能跑，能用就直接复用。
2. 没有就装：缺 `curl` 时先补依赖，再下载官方 `install.sh` 执行 `sh install.sh --tui`（只装终端版），直连还是走代理由设置决定。
3. 把 `magpie` 软链到 `/usr/local/bin/magpie`——它在 PATH 里，又不在引擎升级会替换的清单里；同名普通文件不覆盖。
4. 端口上已经有网关在跑就复用，不重复起。
5. 否则按启动方式起 `magpie serve` / `magpie web`，输出写进日志。
6. 插件卸载或引擎退出时，向自己起的进程发 `SIGTERM`。

安装和启动都在异步里跑，不拖慢引擎启动；安装带锁，多实例不会同时装。安装可能要几分钟，超过点按的 3 秒窗口，所以点「安装」只回提示，进度靠面板持续推送；静默超过 30 秒会留一行心跳。

## 装一半断了怎么办

- 首次加载会自动安装。失败时面板显示原因，**下次启动引擎会重新尝试**，不用手动点。
- 安装中途 App 被杀，可能留下 `install.lock`。插件按锁里记的 pid 是否存活来判断：上次进程已经没了就接管继续装，不会空等。没有 pid 的旧锁超过 40 分钟也算过期。
- 已经装好的不会重装——先看 `--version` 能不能跑。

## 设置存放与可覆盖项

设置写成插件目录下的 `data/settings.json`，由面板维护。下列环境变量可作为初值：

| 变量 | 默认值 | 作用 |
| --- | --- | --- |
| `MAGPIE_HOME` | `/root` | 用户名下目录的基准 |
| `MAGPIE_BIN_DIR` | `$MAGPIE_HOME/.local/bin` | magpie 可执行文件目录 |
| `MAGPIE_STATE_DIR` | `$MAGPIE_HOME/.local/state/magpie` | 日志与锁 |
| `MAGPIE_ADDR` | `127.0.0.1` | 监听主机（端口用设置里的网关端口） |
| `MAGPIE_LINK_PATH` | `/usr/local/bin/magpie` | 方便直接敲 `magpie` 的软链 |

dsh-go 里引擎进程的环境由启动清单固定（`env -i`，`HOME=/root`、`DSH_HOME=/root/.dsh`），宿主和 `.bashrc` 改不到它，所以这些变量实际都取默认值；要变就改面板设置。

## 在 dsh-Go 里的存活情况

| 内容 | App 重启 | 引擎升级 | APK 覆盖升级 | 重置运行环境 | 卸载 App |
| --- | --- | --- | --- | --- | --- |
| `root/.local/bin/magpie` | 保留 | 保留 | 保留 | 删除 | 删除 |
| `root/.local/state/magpie` | 保留 | 保留 | 保留 | 删除 | 删除 |
| `usr/local/bin/magpie` 软链 | 保留 | 保留 | 保留 | 删除 | 删除 |
| 插件 `data/settings.json` | 保留 | 保留 | 保留 | 选了保留插件则保留 | 删除 |

引擎升级只替换 `opt/dsh`、`opt/node`、`opt/dsh-go`、`etc/dsh-app` 这些系统目录，`/root` 和 `/usr/local/bin/magpie` 都不在内；重置引擎只保留 `root/.dsh` 的少数几项，magpie 会丢，下次启动自动重装。别往 `/etc/profile.d/dsh-app.sh` 写东西（每次升级被替换），也别依赖 `~/.bashrc`（引擎的 bash 工具是 `bash -c`，不读它）。

## 开发

```sh
npm test                                              # 单元测试
node <dsh-go>/sdk/plugin-kit/bin/check.mjs . --load   # 原生清单 + 视图 + 宿主半侧检查
```

`dshGo` 清单是 v1，一个面板 `magpie`，出现在 `session.tab` / `features` / `plugin`。面板视图是 v2（页签 + 表单 + 按钮），App 不支持 v2 时退回 v1 只读摘要。

## 许可

MIT，见 [LICENSE](LICENSE)。
