# Platform Compatibility

Status of TrueLazer on Windows, macOS and Linux.

**Windows x64 is the only currently supported target.** macOS and Linux are not
on the roadmap right now, but this file records what a cross-platform pass would
have to touch so the work is not rediscovered from scratch later.

Everything below is verified against the code as of **v0.1.10**. File/line
references are included so claims can be re-checked as the code moves.

---

## 1. Support matrix

| | Windows x64 | macOS | Linux |
|---|---|---|---|
| Builds / packages | Yes | No | No |
| Runs | Yes | No (see §3) | No (see §3) |
| Native NDI addon | Yes | Fails to build (§2) | Fails to build (§2) |
| CI coverage | Yes | No | No |
| App runs without the NDI addon | Yes (degrades) | Yes in principle (§2.3) | Yes in principle (§2.3) |

The app is plain JavaScript with one Windows-compiled native addon. There is no
other platform-specific code in the renderer or main process, so the blockers are
concentrated in packaging and that single addon rather than spread through the
application.

---

## 2. Native addon (`ndi_wrapper.node`) — the main blocker

### 2.1 The binding is Windows-only

`native/binding.gyp:19-33` has a single condition, `OS=="win"`, which links
`Processing.NDI.Lib.x64.lib` and copies `Processing.NDI.Lib.x64.dll` next to the
built addon.

There is **no `OS=="mac"` or `OS=="linux"` branch**. On those platforms gyp has no
library to link, so `npm run build-native` (`package.json:9`, wired into
`postinstall` at `package.json:11`) fails and takes `npm install` down with it.

`native/src/ndi_wrapper.cc` itself contains no Win32 headers, so the C++ is
likely portable — the blocker is the library linkage in the `.gyp`, not the
source. That is the good news; it should be a small fix rather than a rewrite.

### 2.2 Runtime loading is already fault-tolerant

`main.js:30-51` wraps the addon load in `try`/`catch` and only logs on failure:

```js
const ndiModule = require(path.join(nativeModulePath, 'ndi_wrapper.node'));
ndi = new ndiModule.NdiWrapper();
```

If the addon is absent the app still starts; only the NDI video output feature is
unavailable. `main.js:37-39` already guards the DLL search-path manipulation with
`if (process.platform === 'win32')`.

This means a macOS/Linux build does not strictly *need* a working NDI addon to
run — it needs the `postinstall` step to tolerate its absence, or NDI support
made optional at install time.

### 2.3 Other prebuild exclusions to revisit

`package.json:28-53` excludes a lot of prebuilt binaries from the packaged app.
Most of these are tuned for the Windows build and would need re-evaluating:

- `better-sqlite3` — `prebuilds/darwin-*`, `prebuilds/linux-*`,
  `prebuilds/linuxmusl-*` are excluded, **and so are `build/**`, `deps/**` and
  `src/**`**. Taken together this strips every copy of the compiled module and
  its sources, which is correct for a Windows package but would leave a Linux
  build with no usable sqlite binary at all. `better-sqlite3` is pinned via
  `overrides` at `package.json:92-94`.
- `!node_modules/better-sqlite3/prebuilds/win32-arm64.node` — Windows ARM is
  currently unsupported.
- `@serialport/bindings-cpp/prebuilds/{darwin,linux}-*` and
  `win32-ia32` — Windows-only prebuild selection.
- `jazz-midi/bin/{linux64,linuxa7,macos64,macosa64,win32}` and `10_15/11_15` —
  the MIDI stack is pruned for Windows; the linux/mac entries are already
  present in the dependency but excluded here.

Note also that `"preload.js"` at `package.json:28` is a no-op entry: the file
actually lives at `src/preload.js` and is already covered by `src/**/*`.

### 2.4 Packaging targets

`package.json` defines only a Windows target:

- `build.win.target: ["nsis"]` (`package.json:79-84`)
- `build.nsis` (per-machine/per-user installer) (`package.json:85-90`)
- `build.icon: "src/favicon.ico"` (`package.json:81`) — a `.ico`, not a
  platform icon set. macOS needs `.icns`; Linux packaging would want PNG sizes.

There are no `mac`, `dmg`, `linux` or `AppImage` entries.

---

## 3. CI

`.github/workflows/build-release.yml` is the only workflow:

- `runs-on: windows-2022` (`:13`)
- Triggered by a push to `dev` whose `package.json` version changed (`:27-56`)
- `node-version: 22` (`:24`)
- `npm ci` → `npm run build` → publishes `v<version>` with the `.exe` and
  `.blockmap` (`:66-77`)

Two consequences for a cross-platform pass:

- The release path is `.exe`-only; `:74-75` globs `release/*.exe`.
- Because the trigger is a **version comparison against the previous push**, a
  no-op push is skipped by design. Bumping the version is the intended way to
  force a build. `package-lock.json` must be bumped in lockstep — the workflow
  runs `npm ci`, which fails on a lockfile whose version disagrees with
  `package.json`.

---

## 4. Application structure — the macOS `createWindow()` defect

This is the one **code** defect (as opposed to packaging) with real behavioural
consequences, and it is macOS-specific.

### 4.1 What happens

`main.js:3937-3941` re-creates the window when the app is activated with no
windows open:

```js
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
```

`main.js:3944-3951` only quits on non-darwin:

```js
app.on('window-all-closed', () => {
  ...
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
```

So on macOS, closing the window and then clicking the dock icon runs
`createWindow()` a second time.

### 4.2 Why that throws

`createWindow()` (`main.js:1136`) still contains roughly **65** `ipcMain.handle`
/ `ipcMain.on` registrations. `ipcMain.handle` throws when the same channel is
registered twice, so the second run aborts part-way through window setup and the
later registrations never take effect.

The four **project-file** handlers have already been moved to module scope as
part of the page-aware menu work, precisely to avoid this:

- `save-timeline-project` / `open-timeline-project` — `main.js:656-698`
- `save-shape-project` / `open-shape-project` — `main.js:709-747`

Both pairs now sit well above `createWindow()`, with the reason documented in a
comment above them.

### 4.3 What is left, and why it is not a mechanical fix

The remaining ~63 handlers are still inside `createWindow()`. They cannot simply
be hoisted, because they close over window-scoped state that would have to move
with them:

- the DAC frame accumulator and send loop (`dacFrameAccumulator`,
  `dacSendLoopTimer`, `stoppedDacIps`, `dacTargets`, `DAC_SEND_INTERVAL`)
- the Art-Net and TCNet UDP sockets (`artnetTcSocket`, `tcnetTimeSocket`)
- the Prolink client (`prolinkNetwork`, `prolinkTracker`, `prolinkOp`, ...)
- the StageLinq / DJ-Link listeners

A check confirmed none of the handlers reference the local `win` variable, so the
hoist is *possible* — but it is a real refactor of the DAC streaming and timecode
subsystems, not a cut-and-paste. It should be done as its own change with the DAC
path exercised, not folded into an unrelated one.

### 4.4 Impact today

- **Windows / Linux:** unaffected. `window-all-closed` quits the app, so
  `createWindow()` runs exactly once.
- **macOS:** broken. The second window creation throws part-way through setup.

---

## 5. Checks that came back clean

- No hardcoded drive letters or `%APPDATA%`-style paths in `main.js` or
  `main/*.cjs`. The one match is a comment (`main.js:63`); the code itself uses
  `app.getPath(...)` and `path.join`, both cross-platform.
- Renderer code has no platform branching; it talks to hardware over
  `main/` modules, which use `Buffer`, `dgram` and `net` rather than Win32 APIs.
- The DAC transports themselves are portable: Showbridge discovery uses
  `setBroadcast(true)` (`main/showbridge-communication.cjs:412`), EtherDream and
  IDN use TCP/UDP respectively.
- `src/preload.js` has no Node built-ins that would need shimming.

---

## 6. Suggested order for a future cross-platform pass

1. Make the NDI addon optional at install time, or add mac/linux branches to
   `native/binding.gyp`. Without this, `npm install` fails before the app can
   start.
2. Split `createWindow()` into window construction and a separate
   `registerIpcHandlers()` called once from `app.whenReady()`. This fixes the
   macOS defect (§4) and is worth doing on Windows anyway, since app-lifetime
   registration does not belong in window construction.
3. Re-tune the `package.json` `build.files` prebuild exclusions for the target
   platform (§2.3) and drop the stale `"preload.js"` entry.
4. Add `mac` / `dmg` and `linux` targets with a platform icon set.
5. Extend the workflow with a build matrix. Note that the version-change trigger
   and the `.exe`-only release glob will both need revisiting.