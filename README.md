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
   - 把 `~/.local/bin` 追加进 `~/.bashrc` 的 `PATH`。
3. 探网关端口（默认 `127.0.0.1:3425`）：已有 magpie 网关在跑就直接复用，不重复启动。
4. 否则 `magpie serve` 拉起网关，输出写进日志。
5. 插件卸载或 DSH 退出时，向自己起的网关发 `SIGTERM`。

安装和启动都在异步里执行，不阻塞 DSH 启动。安装过程持有锁文件 `install.lock`，多个 DSH 实例不会同时安装；抢不到锁的实例会轮询等待最多 10 分钟。

## 环境变量

| 变量 | 默认值 | 作用 |
| --- | --- | --- |
| `MAGPIE_HOME` | `/root` | 用户名下目录的基准 |
| `MAGPIE_BIN_DIR` | `$MAGPIE_HOME/.local/bin` | magpie 可执行文件所在目录 |
| `MAGPIE_STATE_DIR` | `$MAGPIE_HOME/.local/state/magpie` | 日志与锁文件目录 |
| `MAGPIE_ADDR` | `127.0.0.1:3425` | 网关监听地址；插件按它决定健康探测的目标 |
| `MAGPIE_PROXY` | `http://127.0.0.1:10808` | 直连安装失败后的重试代理 |

`MAGPIE_ADDR` 是 magpie 自己的变量，插件读它而不是另立一个端口变量，两边不会说岔。

## 安装

本仓库是一个 DSH bundle：`package.json` 的 `dsh.bundle.patch` 指向 `cordis.patch.yml`，后者插入插件条目。装进任意 DSH profile（包括 DSH Go 里那个）即可，启用后无需配置。

## 排障

日志在 `$MAGPIE_STATE_DIR/autostart.log`（默认 `/root/.local/state/magpie/autostart.log`）。常见情况：

- `网关已在运行（127.0.0.1:3425）`：已经有一个 magpie 网关（可能是你在 TUI/桌面版里开的），插件不会再起第二个。
- `下载安装脚本失败`：检查网络；确认手机上的代理端口确实在 `10808`，否则改 `MAGPIE_PROXY`。
- `安装脚本执行完毕，但 magpie 仍不可用`：看 `install.sh` 自己的输出，多为缺 `webkitgtk` 之类的提示；无桌面环境应该走 `--tui`，若仍失败按 magpie 文档用 `go install github.com/yetone/magpie@latest`。

手动验证：

```sh
/root/.local/bin/magpie --version
nc -z 127.0.0.1 3425 && echo gateway up
```

## 注意

- 插件不管理 magpie 的模型与账号配置；首次使用仍需在 magpie 里添加 provider，或改用 `magpie provider add`。
- 只负责"活着"：网关异常退出后不会自动重启（DSH 下次加载插件时会补起）。
- 与 magpie 自己写 DSH profile 的 provider 配置互不冲突：那改的是 provider，本插件插入的是一条插件条目。
