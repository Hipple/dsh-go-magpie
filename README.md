# dsh-go-magpie-autostart

为 [DSH Go](https://github.com/ccch1mneyyy/dsh-Go) 定制的 [magpie](https://github.com/yetone/magpie) 安装、部署、启动插件：DSH 启动时把 magpie 装好并拉起它的本地网关，DSH 退出时把网关收掉。

## 为什么需要

DSH Go 自带一个免 Root 的 Ubuntu 环境跑 DSH 引擎。里面没有桌面、也没有 systemd，`magpie serve` 没有东西托管它：手动 `curl | sh` 装完之后，每次重开 App 都要再敲一遍，而且 `--gui` 那条路在无桌面环境里走不通。

这个插件把"装 magpie"和"起网关"挂到 DSH 的插件生命周期上，装一次，之后随 DSH 自动起停。

## 行为

1. 探测 `~/.local/bin/magpie --version`。
2. 不可用就安装：
   - 缺 `curl` 时先 `apt-get install -y curl ca-certificates`；
   - 下载官方脚本 `https://usemagpie.ai/install.sh`；
   - `sh install.sh --tui`，只装终端版，不装桌面版；
   - 直连失败、且本机 `127.0.0.1:10808` 在监听时，走代理重试一次；
   - 把 `magpie` 软链到 `/usr/local/bin/magpie`——`/usr/local/bin` 本来就在 PATH 里，对话里可以直接敲 `magpie`。
3. 探网关端口（默认 `127.0.0.1:3425`）：已有 magpie 网关在跑就直接复用，不重复启动。
4. 否则 `magpie serve` 拉起网关，输出写进日志。
5. 插件卸载或 DSH 退出时，向自己起的网关发 `SIGTERM`。

安装和启动都在异步里执行，不阻塞 DSH 启动。安装过程持有锁文件 `install.lock`，多个 DSH 实例不会同时安装；抢不到锁的实例会轮询等待最多 10 分钟。

## 环境变量

**在 dsh-Go 里这些变量没有设置入口。** 引擎进程的环境由启动清单固定（`env -i`：`HOME=/root`、`USER=root`、`DSH_HOME=/root/.dsh`、`PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`），宿主环境和 `.bashrc` 都改不到它，所以实际一律取默认值——恰好就是下面这组，能用，但不可配。

| 变量 | 默认值 | 作用 |
| --- | --- | --- |
| `MAGPIE_HOME` | `/root` | 用户名下目录的基准 |
| `MAGPIE_BIN_DIR` | `$MAGPIE_HOME/.local/bin` | magpie 可执行文件所在目录 |
| `MAGPIE_STATE_DIR` | `$MAGPIE_HOME/.local/state/magpie` | 日志与锁文件目录 |
| `MAGPIE_ADDR` | `127.0.0.1:3425` | 网关监听地址；插件按它决定健康探测的目标 |
| `MAGPIE_PROXY` | `http://127.0.0.1:10808` | 直连安装失败后的重试代理 |
| `MAGPIE_LINK_PATH` | `/usr/local/bin/magpie` | 方便直接敲 `magpie` 的软链位置 |

这些名字只在自建 Linux 主机上（自己控进程环境时）才有意义。要把它们做成 dsh-Go 上可配，正确做法是改用 cordis `Config`（DSH 设置界面可改、存在 `root/.dsh/profiles`，属于重置仍保留的路径），而不是读 `process.env`。

## dsh-Go 里的持久化

magpie 装在 `/root` 下，日志和锁也在 `/root` 下。各操作之后：

| 内容 | App 重启 | 引擎升级 | APK 覆盖升级 | 重置运行环境 | 卸载 App |
| --- | --- | --- | --- | --- | --- |
| `root/.local/bin/magpie` | 保留 | 保留 | 保留 | 删除 | 删除 |
| `root/.local/state/magpie` | 保留 | 保留 | 保留 | 删除 | 删除 |
| `usr/local/bin/magpie` 软链 | 保留 | 保留 | 保留 | 删除 | 删除 |

引擎升级只替换固定路径（`opt/dsh`、`opt/node`、`opt/dsh-go`、`etc/dsh-app`、`etc/profile.d/dsh-app.sh`、`usr/local/lib/node_modules/pnpm` 与 `usr/local/bin/{dsh,node,npm,npx,corepack,pnpm…}`），`/root` 和 `/usr/local/bin/magpie` 都不在内。「重置运行环境」只保留 `root/.dsh` 的少数几项，所以会清掉 magpie；插件下次启动会自动重装并重建软链。

不要往 `/etc/profile.d/dsh-app.sh` 写任何东西：它每次引擎升级都会被替换。也不要依赖 `~/.bashrc`：DSH 的 bash 工具是 `bash -c`（非登录、非交互），不会读它。

## 安装

本仓库是一个 DSH bundle：`package.json` 的 `dsh.bundle.patch` 指向 `cordis.patch.yml`，后者插入插件条目。装进任意 DSH profile（包括 DSH Go 里那个）即可，启用后无需配置。

## 排障

日志在 `$MAGPIE_STATE_DIR/autostart.log`（默认 `/root/.local/state/magpie/autostart.log`）。常见情况：

- `网关已在运行（127.0.0.1:3425）`：已经有一个 magpie 网关（可能是你在 TUI/桌面版里开的），插件不会再起第二个。
- `下载安装脚本失败`：检查网络；确认手机上的代理端口确实在 `10808`，否则改 `MAGPIE_PROXY`。
- `安装脚本执行完毕，但 magpie 仍不可用`：看 `install.sh` 自己的输出，多为缺 `webkitgtk` 之类的提示；无桌面环境应该走 `--tui`，若仍失败按 magpie 文档用 `go install github.com/yetone/magpie@latest`。

- `magpie: command not found`：软链没建成（`/usr/local/bin` 不可写，或那里已有同名普通文件，插件不会覆盖它）。看日志里那行 `创建软链 … 失败`；临时可用全路径 `/root/.local/bin/magpie`。

手动验证：

```sh
/root/.local/bin/magpie --version
nc -z 127.0.0.1 3425 && echo gateway up
```

## 注意

- 插件不管理 magpie 的模型与账号配置；首次使用仍需在 magpie 里添加 provider，或改用 `magpie provider add`。
- 只负责"活着"：网关异常退出后不会自动重启（DSH 下次加载插件时会补起）。
- 与 magpie 自己写 DSH profile 的 provider 配置互不冲突：那改的是 provider，本插件插入的是一条插件条目。
