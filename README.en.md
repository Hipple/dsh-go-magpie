<p align="center">
  <a href="README.md">简体中文</a> · <b>English</b>
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

[magpie](https://github.com/yetone/magpie) puts every coding agent — Codex, Claude Code and the rest — on whichever model you want: it opens a gateway on your machine and the agent just points at it. DSH Go packs the whole engine into an Ubuntu environment inside the phone, so to use it you first install magpie by hand, watch that it stays up, and wire it back after every restart. None of that has anything to do with getting the agent to do its job.

This plugin removes that chore. It installs magpie inside the DSH Go engine environment, keeps the gateway (plus the web console when you want it) alive along with the engine's lifecycle, and gives you a native panel to check status and change settings. Once installed, day-to-day use is a couple of taps.

## Get it running

Open the Magpie entry under the conversation's "Plugins" tab (or "All features"). The first load installs and starts it automatically, and the installation steps and logs show up in the panel. The panel relies on the dsh-go bridge and only appears on hosts that have it (the phone's local engine and similar). Without the bridge the plugin still installs and runs the gateway — it just has no UI.

- The status line tells you whether it is running, not installed, or installed but stopped, plus version and start mode.
- The addresses sit above the buttons; tap one to copy. In web mode the second line is the web address including its key.
- Buttons are start / stop / check status / install. The action available right now is highlighted; tapping one you cannot use just returns a hint.
- When something looks wrong, hit "Check status" — it writes `magpie --version`, `healthcheck`, port and process details into the log area.

## Two start modes

- `web` (default): runs `magpie web`, adding magpie's web console alongside the gateway, at an address like `http://127.0.0.1:3430/?k=<key>`. Good if you want a browser UI.
- `serve`: runs only `magpie serve`, with just the local gateway at `http://127.0.0.1:3425`, for Claude Code, Codex and other agents to point at.

The app cannot open `http://` links, so the panel offers "copy address" rather than "open" — paste it into your browser.

If the web key is left empty, magpie generates a new one on every start and the plugin reads it from the startup log (the value after `?k=`); copy the address again after a restart. To pin it, enter one in settings (at least 16 letters, digits or `-._~`) and the plugin passes it to magpie as `MAGPIE_WEB_KEY`.

## Settings

Change these on the panel's "Settings" tab; saving writes them to `data/settings.json`:

- Start mode: `web` or `serve`.
- Gateway port (default 3425); in `web` mode, a web port too (default 3430).
- Web key (optional).
- Proxy usage: none / try proxy after a failed direct connection / always, plus the proxy address. The address field only appears for the latter two.
- Start automatically with the engine (on by default).

Changing the start mode or proxy usage updates which fields are shown immediately, no save needed. After saving, if the gateway was started by this plugin it restarts with the new settings; if it was not running, only the settings update.

## Install

A dsh-go native plugin is just an npm package directory on the host — installing adds a link that points at it:

```sh
dsh plugin --profile web add dsh-go-magpie
```

From source (the link points at the directory, so keep the directory):

```sh
git clone https://github.com/Hipple/dsh-go-magpie ~/.dsh/dsh-go/plugins/dsh-go-magpie
dsh plugin --profile web add ~/.dsh/dsh-go/plugins/dsh-go-magpie
```

It takes effect immediately, no app restart. After changing code under `lib/`, restart the engine from the "Engine" page; changing only `dshGo` in `package.json` is picked up automatically. Uninstall: `dsh plugin --profile web remove dsh-go-magpie`.

The same package is also a plain Cordis bundle; installed into the Harness web edition it has no native panel and only the engine-side behavior.

## What it does

1. Check whether `~/.local/bin/magpie --version` runs; if so, reuse it.
2. Otherwise install: add missing deps when `curl` is absent, download the official `install.sh` and run `sh install.sh --tui` (terminal build only). Direct or proxied follows the setting.
3. Symlink `magpie` to `/usr/local/bin/magpie` — it is on PATH and not in the list the engine upgrade replaces; an existing regular file is left untouched.
4. If a gateway is already listening on the port, reuse it instead of starting a second one.
5. Otherwise start `magpie serve` / `magpie web` per the start mode, writing output to the log.
6. When the plugin is uninstalled or the engine exits, send `SIGTERM` to the process it started.

Both install and start run asynchronously and do not block engine startup; install is locked so multiple instances cannot install at once. Installation can take minutes — longer than the 3-second tap window — so "Install" only returns a hint and progress comes through panel updates; a heartbeat line appears after 30 seconds of silence.

## If an install is interrupted

- The first load installs automatically. On failure the panel shows the reason, and **the next engine start tries again** — no manual step.
- If the app is killed mid-install, an `install.lock` may be left behind. The plugin checks whether the pid recorded in the lock is still alive: if the previous process is gone it takes over and continues, no empty wait. A legacy lock with no pid is treated as expired after 40 minutes.
- An existing install is not reinstalled — it first checks whether `--version` runs.

## Where settings live and what you can override

Settings are written to `data/settings.json` in the plugin directory and maintained by the panel. These environment variables serve as initial values:

| Variable | Default | Purpose |
| --- | --- | --- |
| `MAGPIE_HOME` | `/root` | Base for the user's home directory |
| `MAGPIE_BIN_DIR` | `$MAGPIE_HOME/.local/bin` | Directory for the magpie executable |
| `MAGPIE_STATE_DIR` | `$MAGPIE_HOME/.local/state/magpie` | Logs and lock |
| `MAGPIE_ADDR` | `127.0.0.1` | Listen host (port comes from the gateway port setting) |
| `MAGPIE_LINK_PATH` | `/usr/local/bin/magpie` | Symlink so you can just type `magpie` |

Inside dsh-go the engine process environment is fixed by the launch manifest (`env -i`, `HOME=/root`, `DSH_HOME=/root/.dsh`); neither the host nor `.bashrc` can reach it, so in practice these all take their defaults — change them through the panel instead.

## Survival across dsh-Go events

| Item | App restart | Engine upgrade | APK upgrade | Reset runtime | App uninstall |
| --- | --- | --- | --- | --- | --- |
| `root/.local/bin/magpie` | kept | kept | kept | removed | removed |
| `root/.local/state/magpie` | kept | kept | kept | removed | removed |
| `usr/local/bin/magpie` symlink | kept | kept | kept | removed | removed |
| plugin `data/settings.json` | kept | kept | kept | kept if you keep plugins | removed |

An engine upgrade only replaces system paths such as `opt/dsh`, `opt/node`, `opt/dsh-go`, `etc/dsh-app`; `/root` and `/usr/local/bin/magpie` are not among them. A runtime reset keeps only a few items under `root/.dsh`, so magpie is lost and gets reinstalled on the next start. Do not write to `/etc/profile.d/dsh-app.sh` (replaced on every upgrade) or rely on `~/.bashrc` (the engine's bash tool runs `bash -c`, which does not read it).

## Development

```sh
npm test                                              # unit tests
node <dsh-go>/sdk/plugin-kit/bin/check.mjs . --load   # native manifest + view + host-side check
```

The `dshGo` manifest is v1: one panel `magpie`, placed at `session.tab` / `features` / `plugin`. The panel view is v2 (tabs + form + buttons); when the app does not support v2 it falls back to a read-only v1 summary.

## License

MIT, see [LICENSE](LICENSE).
