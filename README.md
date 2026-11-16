# dsh-go-magpie-autostart

为 [DSH Go](https://github.com/ccch1mneyyy/dsh-Go) 定制的 [magpie](https://github.com/yetone/magpie) 安装、启动插件。它在 DSH Go 的引擎里装好 magpie，并把 magpie 的本地网关（或网关 + 网页版）托管到 DSH 的生命周期上；App 里给一个原生面板看状态、改设置。

## 面板

在对话详情页「插件」页签、「全部功能」或插件自己的入口打开 **Magpie**：

- 状态：未安装 / 正在安装 / 运行中（本插件启动 / 已在别处启动）/ 已安装未运行；版本、当前启动方式、网关地址、网页版地址。
- 按钮：安装 / 重装、启动、停止、复制网关地址、复制网页版地址。
- 设置表单：启动方式、代理用法、安装代理、随引擎自动启动；保存后立刻生效。

面板走 dsh-go 桥接，只在手机本机引擎（以及装了桥接的主机）显示；没有桥接的主机只保留引擎侧行为，插件照样装、照样起网关。

## 两项能力

### 启动方式：网关 or 网关 + 网页

- `serve`（默认）：跑 `magpie serve`，只有本地网关（`http://127.0.0.1:3425`），给 Claude Code、Codex 这类 agent 用。
- `web`：跑 `magpie web`，网关之外再起 magpie 的网页控制台（`http://127.0.0.1:3430`）。

App 不能直接打开 `http://` 链接（`link` 效果只收 https），所以面板给的是「复制网页版地址」：复制后粘到浏览器打开。

### 安装代理

安装代理可配，三种用法：

- `fallback`（默认）：先直连下载 `install.sh`，失败且代理端口在监听时再用代理重试。
- `always`：只用代理。
- `off`：不用代理。

代理地址写完整 URL，支持 `http://`、`https://`、`socks5://`、`socks5h://`；空串表示没填。

## 安装

dsh-go 原生插件是放在主机上的 npm 包目录，装的是指向该目录的链接：

```sh
# 放到本机环境里（重置引擎时这个目录默认保留）
git clone https://github.com/Hipple/dsh-go-magpie-autostart ~/.dsh/dsh-go/plugins/dsh-go-magpie-autostart
dsh plugin --profile web add ~/.dsh/dsh-go/plugins/dsh-go-magpie-autostart
```

装上即生效，不用重启。改了 `lib/` 里的代码要在 App 的「引擎」页重启引擎才生效；只改 `package.json` 的 `dshGo` 会自动重读。卸载：`dsh plugin --profile web remove dsh-go-magpie-autostart`。

同一个包也是普通 Cordis bundle（`dsh.bundle.patch`），装进 Harness 网页版时没有原生面板，只有引擎侧行为。

## 行为

1. 探测 `~/.local/bin/magpie --version`；可用就直接复用。
2. 不可用则安装：缺 `curl` 先 `apt-get install -y curl ca-certificates`，下载官方 `install.sh`，`sh install.sh --tui`（只装终端版）；按代理设置决定直连 / 代理。
3. 把 `magpie` 软链到 `/usr/local/bin/magpie`——`/usr/local/bin` 在 PATH 里，且不在 dsh-Go 引擎升级的替换清单中；同名普通文件不覆盖。
4. 探端口：已有网关在跑就复用，不重复启动。
5. 否则按启动方式跑 `magpie serve` / `magpie web`，输出写日志。
6. 插件卸载或引擎退出时，向自己启动的进程发 `SIGTERM`。

安装和启动都在异步里跑，不阻塞引擎启动；安装持锁，多实例不会同时装。面板每 2 秒探一次端口刷新状态。安装耗时超过点按的 3 秒窗口，所以「安装」动作只回提示，进度通过面板数据推送。

## 设置存放

设置写在插件目录下的 `data/settings.json`，由面板表单维护。旧的环境变量仍作为初值：

| 变量 | 默认值 | 作用 |
| --- | --- | --- |
| `MAGPIE_HOME` | `/root` | 用户名下目录的基准 |
| `MAGPIE_BIN_DIR` | `$MAGPIE_HOME/.local/bin` | magpie 可执行文件目录 |
| `MAGPIE_STATE_DIR` | `$MAGPIE_HOME/.local/state/magpie` | 日志与锁 |
| `MAGPIE_ADDR` | `127.0.0.1:3425` | 网关监听地址 |
| `MAGPIE_WEB_ADDR` | `127.0.0.1:3430` | 网页版监听地址（`magpie web`） |
| `MAGPIE_LINK_PATH` | `/usr/local/bin/magpie` | 方便直接敲 `magpie` 的软链 |
| `MAGPIE_PROXY` | `http://127.0.0.1:10808` | 代理初值 |

注意：在 dsh-go 里引擎进程的环境由启动清单固定（`env -i`，`HOME=/root`、`DSH_HOME=/root/.dsh`），宿主和 `.bashrc` 改不到它，所以这些变量实际取默认值；想改就用面板里的设置。

## dsh-Go 里的持久化

| 内容 | App 重启 | 引擎升级 | APK 覆盖升级 | 重置运行环境 | 卸载 App |
| --- | --- | --- | --- | --- | --- |
| `root/.local/bin/magpie` | 保留 | 保留 | 保留 | 删除 | 删除 |
| `root/.local/state/magpie` | 保留 | 保留 | 保留 | 删除 | 删除 |
| `usr/local/bin/magpie` 软链 | 保留 | 保留 | 保留 | 删除 | 删除 |
| 插件的 `data/settings.json` | 保留 | 保留 | 保留 | 选了保留插件则保留 | 删除 |

引擎升级只替换 `opt/dsh`、`opt/node`、`opt/dsh-go`、`etc/dsh-app`、`etc/profile.d/dsh-app.sh`、`usr/local/lib/node_modules/pnpm` 与 `usr/local/bin/{dsh,node,npm,npx,corepack,pnpm…}`，`/root` 和 `/usr/local/bin/magpie` 都不在内。重置引擎只保留 `root/.dsh` 的少数几项；magpie 会丢，下次启动插件自动重装。

不要往 `/etc/profile.d/dsh-app.sh` 写东西（每次引擎升级被替换），也不要依赖 `~/.bashrc`（引擎的 bash 工具是 `bash -c`，不读它）。

## 开发

```sh
npm test                                   # 单元测试
node <dsh-go>/sdk/plugin-kit/bin/check.mjs . --load   # 原生清单 + 视图 + 宿主半侧检查
```

`dshGo` 清单：v1，一个面板 `magpie`，位置 `session.tab` / `features` / `plugin`。面板视图 v2（表单 + 按钮），App 不具备 v2 组件时退回 v1 只读摘要。
