<p align="center">
  <b>简体中文</b> · <a href="README.en.md">English</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/dsh-go-magpie"><img alt="NPM v1.3.7" src="https://img.shields.io/badge/NPM-V1.3.7-6366F1?style=for-the-badge&labelColor=1E1B4B"></a>
  <a href="LICENSE"><img alt="License MIT" src="https://img.shields.io/badge/LICENSE-MIT-10B981?style=for-the-badge&labelColor=064E3B"></a>
  <a href="package.json"><img alt="Node 22+" src="https://img.shields.io/badge/NODE-22%2B-F59E0B?style=for-the-badge&labelColor=451A03"></a>
</p>

<p align="center">
  <a href="https://github.com/Hipple/dsh-go-magpie"><img alt="GitHub Hipple/dsh-go-magpie" src="https://img.shields.io/badge/GITHUB-Hipple%2Fdsh--go--magpie-FF4500?style=for-the-badge&logo=github&logoColor=white&labelColor=1A1A2E"></a>
</p>

# dsh-go-magpie

## 简介

dsh-go-magpie 是为 DSH Go 打造的 magpie 安装与部署插件。它在 DSH Go 内置的 Ubuntu 引擎环境中自动安装 [magpie](https://github.com/yetone/magpie) 并托管其进程生命周期，同时在 App 中提供原生面板，用于查看运行状态和修改配置。安装完成后，日常使用无需命令行操作。

## 功能

- 自动检测并安装 magpie，安装过程与输出实时显示在面板中。
- 按配置启动本地网关（`serve`），或网关加网页控制台（`web`）。
- 在面板中查看状态、复制网关/网页地址、启动、停止与安装。
- 随引擎自动启动，并在插件卸载或引擎退出时清理自身启动的进程。

## 运行要求

- DSH Go，引擎运行于 Linux 环境（手机内置 Ubuntu，或具备等效环境的主机）。
- Node.js 22.19 或更高版本（见 `package.json` 的 `engines.node`）。
- 首次安装需要网络，安装脚本从 `https://usemagpie.ai/install.sh` 获取。

## 安装

dsh-go 原生插件是位于主机上的 npm 包目录，安装即为创建指向该目录的链接：

```sh
dsh plugin --profile web add dsh-go-magpie
```

从源码安装（链接指向目录，须保留该目录）：

```sh
git clone https://github.com/Hipple/dsh-go-magpie ~/.dsh/dsh-go/plugins/dsh-go-magpie
dsh plugin --profile web add ~/.dsh/dsh-go/plugins/dsh-go-magpie
```

安装后立即生效，无需重启 App。修改 `lib/` 下的代码后需在「引擎」页重启引擎；仅修改 `package.json` 中的 `dshGo` 会自动重读。卸载：

```sh
dsh plugin --profile web remove dsh-go-magpie
```

同一包也可作为普通 Cordis bundle 安装到 Harness 网页版；此时没有原生面板，仅保留引擎侧行为。

## 使用

面板入口位于对话详情页的「插件」页签，也可从「全部功能」或插件自身入口进入。首次加载会自动安装并启动。面板依赖 dsh-go 桥接，仅在具备桥接的主机（如手机本机引擎）出现；无桥接时插件仍会安装并启动网关，但没有界面。

面板包含「网关」与「设置」两个页签。

### 网关

- 状态：未安装 / 正在安装 / 运行中（本插件启动或已在别处启动）/ 已安装未运行；同时显示版本与当前启动方式。
- 地址：位于按钮上方，点击即可复制；`web` 模式下第二行为带 key 的网页版地址。
- 操作按钮：启动、停止、查看状态、安装。当前可用的操作会高亮；点击不可用的操作仅返回提示。
- 查看状态：将 `magpie --version`、`magpie healthcheck`、端口与进程信息写入日志区。
- 日志区显示本次引擎启动以来的记录；日志文件在每次引擎加载时清空。

### 设置

配置项见「配置」一节。

## 配置

在面板「设置」页签中修改，保存后写入 `data/settings.json`。

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| 启动方式 | `web` | `web` 启动网关与网页控制台；`serve` 仅启动网关 |
| 网关端口 | 3425 | 本地网关端口 |
| 网页端口 | 3430 | 仅 `web` 模式，网页控制台端口 |
| 网页版 key | 空 | 留空时每次启动由 magpie 随机生成；填写后经 `MAGPIE_WEB_KEY` 传入 |
| 代理用法 | `off` | `off` 不使用代理；`fallback` 直连失败且代理端口在监听时重试；`always` 始终使用代理 |
| 代理地址 | 空 | 选择 `fallback` 或 `always` 时显示 |
| 随引擎自动启动 | 开 | 引擎启动时自动安装并启动网关 |

修改启动方式或代理用法时，字段显隐立即更新，无需保存。保存后，若网关由本插件启动，将按新配置自动重启；否则仅更新配置。

### 启动方式

- `serve`：运行 `magpie serve`，仅提供本地网关 `http://127.0.0.1:<网关端口>`。
- `web`：运行 `magpie web --addr 127.0.0.1:<网页端口> --no-open`，在网关之外提供 magpie 网页控制台，地址形如 `http://127.0.0.1:<网页端口>/?k=<key>`。

App 无法直接打开 `http://` 链接，因此面板提供「复制地址」而非「打开」。

网页版 key 未设置时，magpie 每次启动生成新 key，插件从启动日志读取 `?k=` 后的值；重启后需重新复制地址。如需固定，可在设置中填写（至少 16 个字母、数字或 `-._~`），插件会通过 `MAGPIE_WEB_KEY` 传入。

### 安装代理

代理用法为三态加一个地址：`off`（默认，不使用代理）、`fallback`（先直连，失败且代理端口在监听时重试）、`always`（始终使用代理）。地址支持 `http://`、`https://`、`socks5://`、`socks5h://`；选择 `off` 时地址留空。代理仅作用于安装阶段的下载。

## 工作原理

1. 检测 `~/.local/bin/magpie --version`，可用则复用。
2. 不可用时执行安装：若缺少 `curl`，先安装依赖；随后下载官方 `install.sh` 并以 `sh install.sh --tui` 运行（仅安装终端版）。直连或代理由配置决定。
3. 将 `magpie` 软链至 `/usr/local/bin/magpie`。该目录在 PATH 中，且不在引擎升级的替换清单内；同名普通文件不覆盖。
4. 若目标端口已有网关在运行，则复用，不重复启动。
5. 否则按启动方式运行 `magpie serve` 或 `magpie web`，输出写入日志。
6. 插件卸载或引擎退出时，向自身启动的进程发送 `SIGTERM`。

安装与启动均在异步中执行，不阻塞引擎启动；安装过程持锁，多实例不会并发安装。安装可能持续数分钟，超过操作按钮 3 秒的响应窗口，因此「安装」仅返回提示，进度通过面板数据推送；静默超过 30 秒会输出一行心跳日志。

## 安装中断与恢复

- 首次加载会自动安装；失败时面板显示原因，下次启动引擎会重新尝试，无需手动操作。
- 安装中途退出可能导致 `install.lock` 残留。插件根据锁中记录的 pid 是否存活判断：若上一次进程已不存在，则接管该锁继续安装，不会空等。无 pid 的旧格式锁在超过 40 分钟后视为过期。
- 已安装的 magpie 不会重复安装，以 `--version` 可执行为准。

## 数据与持久化

设置写入插件目录下的 `data/settings.json`，由面板维护。以下环境变量可作为初始值：

| 变量 | 默认值 | 作用 |
| --- | --- | --- |
| `MAGPIE_HOME` | `/root` | 用户主目录基准 |
| `MAGPIE_BIN_DIR` | `$MAGPIE_HOME/.local/bin` | magpie 可执行文件目录 |
| `MAGPIE_STATE_DIR` | `$MAGPIE_HOME/.local/state/magpie` | 日志与锁目录 |
| `MAGPIE_ADDR` | `127.0.0.1` | 监听主机（端口取自网关端口配置） |
| `MAGPIE_LINK_PATH` | `/usr/local/bin/magpie` | `magpie` 命令软链路径 |

dsh-go 中引擎进程的环境由启动清单固定（`env -i`，`HOME=/root`，`DSH_HOME=/root/.dsh`），宿主环境与 `.bashrc` 均无法影响，因此上述变量实际取默认值；如需调整，请使用面板设置。

各类事件后的数据保留情况：

| 内容 | App 重启 | 引擎升级 | APK 覆盖升级 | 重置运行环境 | 卸载 App |
| --- | --- | --- | --- | --- | --- |
| `root/.local/bin/magpie` | 保留 | 保留 | 保留 | 删除 | 删除 |
| `root/.local/state/magpie` | 保留 | 保留 | 保留 | 删除 | 删除 |
| `usr/local/bin/magpie` 软链 | 保留 | 保留 | 保留 | 删除 | 删除 |
| 插件 `data/settings.json` | 保留 | 保留 | 保留 | 选择保留插件则保留 | 删除 |

引擎升级仅替换 `opt/dsh`、`opt/node`、`opt/dsh-go`、`etc/dsh-app` 等系统目录，`/root` 与 `/usr/local/bin/magpie` 均不在其中。重置运行环境仅保留 `root/.dsh` 下的少量内容，magpie 会被删除，并在下次启动时自动重装。

不要写入 `/etc/profile.d/dsh-app.sh`（每次升级被替换），也不要依赖 `~/.bashrc`（引擎的 bash 工具以 `bash -c` 执行，不读取该文件）。

## 开发

```sh
npm test                                              # 单元测试
node <dsh-go>/sdk/plugin-kit/bin/check.mjs . --load   # 原生清单 + 视图 + 宿主半侧检查
```

`dshGo` 清单为 v1，包含一个面板 `magpie`，位置为 `session.tab` / `features` / `plugin`。面板视图为 v2（页签 + 表单 + 按钮）；App 不支持 v2 时回退为 v1 只读摘要。

## 许可

MIT，见 [LICENSE](LICENSE)。

<p align="center">
  <a href="https://github.com/deepseek-ai/deepseek-harness"><img alt="powered by dsh" src="https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white"></a>
</p>
