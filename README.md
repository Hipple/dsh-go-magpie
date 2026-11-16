# dsh-go-magpie

为 [DSH Go](https://github.com/ccch1mneyyy/dsh-Go) 定制的 [magpie](https://github.com/yetone/magpie) 安装、启动插件。它在 DSH Go 的引擎里装好 magpie，把 magpie 的本地网关（或网关 + 网页版）托管到 DSH 的生命周期上；App 里给一个原生面板看状态、改设置。

## 面板

面板分两个页签。入口在对话详情页「插件」页签、「全部功能」或插件自己的入口。

**网关**

- 状态：未安装 / 正在安装 / 运行中（本插件启动 / 已在别处启动）/ 已安装未运行；版本、当前启动方式、网关地址。
- 仅「网关 + 网页」模式才出现网页版地址（含 key）。仅网关时这里不显示任何网页版信息。
- 按钮：安装 / 重装、启动、停止；复制网关地址、复制网页版地址（仅网页版模式）。
- 需要重启或出错时会给出提示条；日志区用 App 的固定高度代码块展示、可滚动，只显示本次启动以来的记录（日志文件在每次引擎加载时清空）。

**设置**

- 启动方式：`serve`（仅网关，默认）或 `web`（`magpie web`，网关 + 网页控制台）。
- 网关端口（默认 3425）。
- 选了「网关 + 网页」再多两项：网页版端口（默认 3430）、网页版 key（`MAGPIE_WEB_KEY`，留空则每次启动由 magpie 随机生成）。
- 代理用法：不用代理（默认）/ 直连失败再用 / 始终使用；只有选了前两者之外（非「不用代理」）才显示代理地址输入框。
- 随引擎自动启动。

面板每次打开都会重新取视图；开着时每 2 秒重读日志并推送最新状态（状态、版本、网关/网页地址与 key 都走 data 绑定），所以随机生成的 key 也会很快出现，复制时用的是点下去那一刻的快照。日志区是视图快照，点任何按钮都会刷新重取。

改启动方式或代理用法会立刻调整字段显隐（不用点保存）；点「保存设置」后落盘，面板内容同步刷新。如果网关是本插件起的，改启动方式 / 端口 / key 会自动重启网关；没在运行就只更新设置。

面板走 dsh-go 桥接，只在手机本机引擎（以及装了桥接的主机）显示；没有桥接的主机只保留引擎侧行为。

## 启动方式

- `serve`：跑 `magpie serve`，只有本地网关（`http://127.0.0.1:<网关端口>`），给 Claude Code、Codex 这类 agent 用。
- `web`：跑 `magpie web --addr 127.0.0.1:<网页端口> --no-open`，网关之外再起 magpie 网页控制台，地址形如 `http://127.0.0.1:<网页端口>/?k=<key>`。

App 不能直接打开 `http://` 链接（`link` 效果只收 https），所以面板给的是「复制网页版地址」：复制出来就带 key，粘到浏览器即可。

key 从哪来：设置里填了就用 `MAGPIE_WEB_KEY` 传给 magpie；留空时 magpie 每次启动自己生成，插件从启动日志里取 `?k=` 后面的值。

## 安装代理

三态 + 一个地址：`off`（默认，不用代理）/ `fallback`（先直连，失败且代理端口在监听时重试）/ `always`（只用代理）。地址支持 `http://`、`https://`、`socks5://`、`socks5h://`；选「不用代理」时地址留空。

## 安装

dsh-go 原生插件是放在主机上的 npm 包目录，装的是指向该目录的链接：

```sh
dsh plugin --profile web add dsh-go-magpie
```

也可以从源码装（装的是指向目录的链接，目录要留着）：

```sh
git clone https://github.com/Hipple/dsh-go-magpie ~/.dsh/dsh-go/plugins/dsh-go-magpie
dsh plugin --profile web add ~/.dsh/dsh-go/plugins/dsh-go-magpie
```

装上即生效，不用重启。改了 `lib/` 里的代码要在 App 的「引擎」页重启引擎才生效；只改 `package.json` 的 `dshGo` 会自动重读。卸载：`dsh plugin --profile web remove dsh-go-magpie`。

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

设置写在插件目录下的 `data/settings.json`，由面板表单维护。环境变量仍作为初值：

| 变量 | 默认值 | 作用 |
| --- | --- | --- |
| `MAGPIE_HOME` | `/root` | 用户名下目录的基准 |
| `MAGPIE_BIN_DIR` | `$MAGPIE_HOME/.local/bin` | magpie 可执行文件目录 |
| `MAGPIE_STATE_DIR` | `$MAGPIE_HOME/.local/state/magpie` | 日志与锁 |
| `MAGPIE_ADDR` | `127.0.0.1` | 监听主机（端口由设置里的网关端口决定） |
| `MAGPIE_LINK_PATH` | `/usr/local/bin/magpie` | 方便直接敲 `magpie` 的软链 |
| `MAGPIE_PROXY` | 空 | 代理初值（默认不用代理） |

在 dsh-go 里引擎进程的环境由启动清单固定（`env -i`，`HOME=/root`、`DSH_HOME=/root/.dsh`），宿主和 `.bashrc` 改不到它，所以这些变量实际取默认值；要改就用面板里的设置。

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
npm test                                              # 单元测试
node <dsh-go>/sdk/plugin-kit/bin/check.mjs . --load   # 原生清单 + 视图 + 宿主半侧检查
```

`dshGo` 清单：v1，一个面板 `magpie`，位置 `session.tab` / `features` / `plugin`。面板视图 v2（页签 + 表单 + 按钮），App 不具备 v2 组件时退回 v1 只读摘要。


