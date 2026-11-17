<p align="center">
  <a href="README.md">简体中文</a> · <b>English</b>
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

## Overview

dsh-go-magpie is a magpie installation and deployment plugin built for DSH Go. It installs [magpie](https://github.com/yetone/magpie) inside DSH Go's built-in Ubuntu engine environment and manages its process lifecycle, and it provides a native panel in the app for viewing status and changing settings. Once installed, day-to-day use requires no command line.

## Features

- Detects and installs magpie automatically; installation steps and output appear in the panel in real time.
- Starts the local gateway (`serve`), or the gateway plus web console (`web`), according to configuration.
- Lets you view status, copy the gateway/web addresses, start, stop and install from the panel.
- Starts with the engine, and cleans up processes it started when the plugin is uninstalled or the engine exits.

## Requirements

- DSH Go, with the engine running on Linux (the phone's built-in Ubuntu, or a host with an equivalent environment).
- Node.js 22.19 or later (see `engines.node` in `package.json`).
- Network access for the first install; the installer is fetched from `https://usemagpie.ai/install.sh`.

## Installation

A dsh-go native plugin is an npm package directory on the host; installing creates a link that points to that directory:

```sh
dsh plugin --profile web add dsh-go-magpie
```

From source (the link points to the directory, so keep it):

```sh
git clone https://github.com/Hipple/dsh-go-magpie ~/.dsh/dsh-go/plugins/dsh-go-magpie
dsh plugin --profile web add ~/.dsh/dsh-go/plugins/dsh-go-magpie
```

Takes effect immediately; no app restart needed. After changing code under `lib/`, restart the engine from the "Engine" page; changing only `dshGo` in `package.json` is picked up automatically. Uninstall:

```sh
dsh plugin --profile web remove dsh-go-magpie
```

The same package also works as a plain Cordis bundle in the Harness web edition; there it has no native panel and only the engine-side behavior.

## Usage

Open the panel from the "Plugins" tab in the conversation details, or from "All features" or the plugin's own entry. The first load installs and starts it automatically. The panel relies on the dsh-go bridge and only appears on hosts that have it (such as the phone's local engine); without the bridge the plugin still installs and starts the gateway, but has no UI.

The panel has two tabs: "Gateway" and "Settings".

### Gateway

- Status: not installed / installing / running (started by this plugin or elsewhere) / installed but not running; version and current start mode are shown as well.
- Addresses: above the buttons, click to copy. In `web` mode the second line is the web address including its key.
- Actions: start, stop, check status, install. The action currently available is highlighted; clicking an unavailable one only returns a hint.
- Check status: writes `magpie --version`, `magpie healthcheck`, port and process details into the log area.
- The log area shows records since the current engine start; the log file is cleared on each engine load.

### Settings

See Configuration.

## Configuration

Change these on the panel's "Settings" tab; saving writes them to `data/settings.json`.

| Item | Default | Description |
| --- | --- | --- |
| Start mode | `web` | `web` starts the gateway and web console; `serve` starts the gateway only |
| Gateway port | 3425 | Local gateway port |
| Web port | 3430 | `web` mode only; web console port |
| Web key | empty | When empty, magpie generates one per start; when set, passed via `MAGPIE_WEB_KEY` |
| Proxy usage | `off` | `off` no proxy; `fallback` retry through the proxy when a direct connection fails and the proxy port is listening; `always` always use the proxy |
| Proxy address | empty | Shown for `fallback` or `always` |
| Auto start with engine | on | Install and start the gateway when the engine starts |

Changing the start mode or proxy usage updates which fields are shown immediately, without saving. After saving, if the gateway was started by this plugin it restarts with the new settings; otherwise only the settings update.

### Start modes

- `serve`: runs `magpie serve`, providing only the local gateway at `http://127.0.0.1:<gateway port>`.
- `web`: runs `magpie web --addr 127.0.0.1:<web port> --no-open`, adding magpie's web console alongside the gateway, at an address like `http://127.0.0.1:<web port>/?k=<key>`.

The app cannot open `http://` links directly, so the panel offers "copy address" rather than "open".

When no web key is set, magpie generates a new one per start and the plugin reads the value after `?k=` from the startup log; copy the address again after a restart. To pin it, enter one in settings (at least 16 letters, digits or `-._~`) and the plugin passes it as `MAGPIE_WEB_KEY`.

### Install proxy

Proxy usage has three states plus an address: `off` (default, no proxy), `fallback` (try a direct connection first, then retry when it fails and the proxy port is listening), `always` (always use the proxy). The address accepts `http://`, `https://`, `socks5://`, `socks5h://`; leave it empty when `off` is selected. The proxy applies only to downloads during installation.

## How it works

1. Check whether `~/.local/bin/magpie --version` runs; if so, reuse it.
2. Otherwise install: add missing deps when `curl` is absent; then download the official `install.sh` and run `sh install.sh --tui` (terminal build only). Direct or proxied follows the configuration.
3. Symlink `magpie` to `/usr/local/bin/magpie`. This directory is on PATH and not in the list the engine upgrade replaces; an existing regular file is left untouched.
4. If a gateway is already running on the port, reuse it instead of starting a second one.
5. Otherwise start `magpie serve` or `magpie web` per the start mode, writing output to the log.
6. When the plugin is uninstalled or the engine exits, send `SIGTERM` to the processes it started.

Install and start run asynchronously and do not block engine startup; installation is locked so multiple instances cannot install concurrently. Installation can take minutes, beyond the buttons' 3-second response window, so "Install" only returns a hint and progress comes through panel updates; after 30 seconds of silence a heartbeat line is logged.

## Installation recovery

- The first load installs automatically; on failure the panel shows the reason and the next engine start retries, with no manual step.
- An interrupted install may leave `install.lock` behind. The plugin checks whether the pid recorded in the lock is still alive: if the previous process is gone it takes over the lock and continues, with no empty wait. A legacy lock without a pid is treated as expired after 40 minutes.
- An existing magpie install is not reinstalled; a working `--version` is the criterion.

## Data and persistence

Settings are written to `data/settings.json` in the plugin directory and maintained by the panel. These environment variables serve as initial values:

| Variable | Default | Purpose |
| --- | --- | --- |
| `MAGPIE_HOME` | `/root` | Base for the user's home directory |
| `MAGPIE_BIN_DIR` | `$MAGPIE_HOME/.local/bin` | Directory for the magpie executable |
| `MAGPIE_STATE_DIR` | `$MAGPIE_HOME/.local/state/magpie` | Logs and lock |
| `MAGPIE_ADDR` | `127.0.0.1` | Listen host (port comes from the gateway port setting) |
| `MAGPIE_LINK_PATH` | `/usr/local/bin/magpie` | Symlink path for the `magpie` command |

dsh-go fixes the engine process environment via the launch manifest (`env -i`, `HOME=/root`, `DSH_HOME=/root/.dsh`), so neither the host environment nor `.bashrc` can affect it; these variables therefore take their defaults in practice — adjust them through the panel instead.

Data retention across events:

| Item | App restart | Engine upgrade | APK upgrade | Reset runtime | App uninstall |
| --- | --- | --- | --- | --- | --- |
| `root/.local/bin/magpie` | kept | kept | kept | removed | removed |
| `root/.local/state/magpie` | kept | kept | kept | removed | removed |
| `usr/local/bin/magpie` symlink | kept | kept | kept | removed | removed |
| plugin `data/settings.json` | kept | kept | kept | kept if you keep plugins | removed |

An engine upgrade replaces only system directories such as `opt/dsh`, `opt/node`, `opt/dsh-go`, `etc/dsh-app`; `/root` and `/usr/local/bin/magpie` are not among them. A runtime reset keeps only a few items under `root/.dsh`, so magpie is removed and reinstalled on the next start.

Do not write to `/etc/profile.d/dsh-app.sh` (replaced on every upgrade) or rely on `~/.bashrc` (the engine's bash tool runs `bash -c`, which does not read it).

## Development

```sh
npm test                                              # unit tests
node <dsh-go>/sdk/plugin-kit/bin/check.mjs . --load   # native manifest + view + host-side check
```

The `dshGo` manifest is v1: one panel `magpie`, placed at `session.tab` / `features` / `plugin`. The panel view is v2 (tabs + form + buttons); when the app does not support v2 it falls back to a read-only v1 summary.

## License

MIT, see [LICENSE](LICENSE).

<p align="center">
  <a href="https://github.com/deepseek-ai/deepseek-harness"><img alt="powered by dsh" src="https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white"></a>
</p>
