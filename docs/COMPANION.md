# Laser Zone Tool (phone companion)

Adjust projector zones from the floor instead of from a fixed desk position. A phone or tablet on the **same LAN** opens a browser page served by the desktop app and drags safety zones / output area with live laser feedback.

## When to use it

- The projector is rigged where the operator cannot see the projection.
- You need to walk the beam landing and align an edge from where it hits the truss, wall, or ceiling.
- Venue staff should see the box move while you adjust it, without taking over the desk.

## Enable it

1. On the laptop, open **General Settings > Laser Zone Tool (phone companion)**.
2. Click **Enable companion**. The panel shows a **QR code**, a **6-digit PIN**, and the **LAN link** (`http://<LAN-IP>:5180/?pin=…`).
3. On the phone/tablet: connect to the **same Wi-Fi** (e.g. ShowNet), disable VPN, point the camera at the QR. The browser opens the zone tool — no app to install. Enter the PIN if asked.
4. Pick an output chip, drag the red safety zones / blue output area, toggle outlines / test lines, then release. The laser moves as you drag.
5. Click **Disable** when done (stops the server, discovery, and PIN immediately). Closing TrueLazer also stops it.

> The PIN **rotates on every enable** and on **New PIN** (stale QRs cannot reopen a later show). Rotating disconnects phones — they re-scan the new QR.

## What you can change remotely

| Remote (phone) | Desktop-only |
| --- | --- |
| Safety zones (add / drag / resize / nudge / clear) | PPS / timing target (speed preset, override, FPS target) |
| Output area + transformation on/off + Crop/Scale | Timeline, clips, effects |
| Zone outlines (canvas + laser) | |
| Horizontal / vertical test lines + positions | |
| Flip X / Flip Y, dimmer, output name | |

The server rejects PPS fields outright (`400 PPS_NOT_ALLOWED`) so a misbehaving client can never change the scanner clock from a phone.

## Working two devices

- **Presence:** the header shows connection state and how many devices are connected.
- **One editor per output:** the first phone to drag an output **locks** it (10s TTL, renewed on each save). A second phone sees *Locked by … — view only*. Switch output or press **Release** to free it. Disconnecting releases instantly.
- **Desktop always wins:** the desk can edit through a phone lock. The desktop sees phone edits live (and vice versa) via the same settings map.
- **No surprises:** every edit carries a per-output revision. A stale save returns `409` and refreshes instead of clobbering.

## Safety

Safety zones are beam blanking. Remote edits rely on:

- **Off by default, LAN only.** The server binds the local network only, requires the PIN for every read/write, and never exposes the PIN via mDNS.
- **Fail-safe disconnect.** If the phone drops, the laser keeps the last zones — the beam never re-aims on reconnect.
- **Audit trail.** The desktop panel lists the last remote edits (amber ⚠ for **shrinks** — total blanked area decreased, i.e. more beam). Every edit is also logged with `[Companion]` in `main.log`.

Laser safety remains the operator's responsibility: confirm every edge **from where you stand, watching the real beam**, not from the phone render.

## Pre-show checklist

- [ ] Reserve a static DHCP IP for the TrueLazer laptop on ShowNet (QR never breaks).
- [ ] Allow TrueLazer on **Windows Firewall (Private)**.
- [ ] Router **client isolation off**; annouce the service as `TrueLazer Zones._truelazer._tcp.local.` (mDNS) — IP/QR fallback if mDNS is blocked.
- [ ] Enable the companion **per show** (new PIN each time); disable between shows.
- [ ] Walk test: roam desk → audience while dragging; lock test with a second device; disconnect test (Wi-Fi off keeps zones).

## Troubleshooting

- **Camera does nothing** — same Wi-Fi? VPN off? Try the LAN link by hand (`http://192.168.x.x:5180/?pin=…`).
- **“Wrong PIN”** — PIN rotated since (re-enable / press *New PIN* on the desktop and re-scan).
- **“Locked by …”** — another device holds that output. Wait for release (~10s) or press **Release** on that device.
- **Phone sees stale zones** — pull **Refresh**; a `409` self-heals by re-reading.

## Under the hood

- **Server:** `main/companion-server.cjs` (HTTP JSON + SSE for live push/presence, per-output revisions + locks) and `main/companion-mdns.cjs` (Bonjour announcer, no third-party dependency). Port `5180`.
- **Phone UI:** `src/companion/` (second Vite entry → `dist/companion/`, served by the same server; no MUI, thumb-first canvas mirroring `OutputSettingsWindow` coordinates).
- **Desktop wiring:** `GeneralSettingsWindow` + `CompanionSettingsSection.jsx`, IPC `companion-start/stop/status/rotate-pin/qr`, store merge + `dac-output-settings-changed` broadcast shared with Show Control / Timeline.
- **Tests:** `src/companionServer.test.js` (PIN, allow/forbid lists, revisions, locks, shrink audit).
- Full plan and decision log: `C:\Users\USER\.opencode\plan\laser-zone-tool-plan.md` (repo-external).
