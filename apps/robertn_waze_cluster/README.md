# robertn_waze_cluster: Cluster functions

The iDrive app for [waze-on-cluster](../../native/waze-on-cluster), which shows the phone's map (CarPlay: Waze,
Apple Maps or Google Maps; Android Auto) on the instrument cluster and the HUD of an iDrive 7 (MGU) head unit, and
for the HUD's turn signals and gear. Its screens are drawn by the Store's renderer (mgu-render) with the
[idrive7-apps](https://github.com/TheoneLT83/idrive7-apps) kit (`../../kit`), in that kit's look: the header's
tabs, the settings sheet, the colour themes. Everything is done from the HMI; no shell is needed.

Install it from this repository's catalog through the [mgu Store](https://github.com/robertnisipeanu/mgu-store).
It requires waze-on-cluster 0.9.2, which brings the cluster renderer and writes the CarPlay patch, and the Android
Auto patch where the car supports it, as it installs (one head-unit start activates them), and the Store's
renderer `mgu-render` 0.6.17, which every car with the Store has: the Store updates it first where it is older, and
the controller gate `mgu-inputgate` 1.0.0, loaded into the HMI at the next start, which gives the app's screen the
iDrive controller (the tabs, buttons and settings sheet with the knob). Both come from mgu-store; the controller gate
of idrive7-apps, where installed, is the same and counts. Nothing else of idrive7-apps is needed. After that the map is on the cluster
whenever the phone streams it, whether or not this app is open.

Set **Instrument cluster > Central display area** to **Map view**: the phone's map replaces the stock map while
its cluster stream shows a map (waze-on-cluster's README has the details).

To remove, remove the app in the Store, then the Waze tool, which reverts the patch.

## Pages

| Tab | |
|---|---|
| **Maps** | **Show on**: Cluster, HUD or Cluster + HUD; the cluster map's and the HUD map's state; **Hide BMW's turn box**. **CarPlay** or **Android Auto**: its patch's state, **Patch** and **Remove patch** (a confirm step), CarPlay's Wi-Fi band, Android Auto's zoom (- / +) and **Hide phone's turn card**, and **Restart head unit** (a confirm step) while a change waits for it. **HUD map**: a picture of the HUD with the map, the turn arrows and the gear where they show; **Size** (5 % a step, 30-85 %), **Brightness** (10 % a step, 10-100 %: the map alone dims, BMW's own HUD content keeps its brightness), **Position** (10 px a press, the middle button centres it). The HUD map's settings are greyed while the map is not on the HUD or the cluster renderer keeps the HUD off after errors |
| **Info** | **Turn signals**: the arrows as the HUD shows them, **Test left** / **Test right** (that arrow blinks on the HUD for 6 s), and the fields of the car's own signal catalog whose names say turn signal; **Gear**: the gear the car reports (P, R, N, D, D1 ... D9); the HUD overlay's state |
| **Log** | the app's log, and the saved logs: **Save logs**, the archives, and the address and QR code a phone on the car's hotspot opens them with |
| **Settings** | the kit's settings sheet: **Turn signals on the HUD**, **Turn arrow size** (small, medium, large), **Gear on the HUD**, the colour theme, the screen layout, demo data |

Every word is in the HMI's display language, read at the start and on each change, English where a language has
none: the pages, the kit's header, Settings tab and settings sheet, the tile and the HMI's own screens. The drawn
screens' letters beyond the kit's come from the app's glyph atlases (`fonts/`, `tools/bake_fonts.py`: accented
Latin, Vietnamese, Greek, Cyrillic, Chinese, Japanese, Korean). Arabic, Hebrew and Thai are drawn in English (the kit
draws no shaping or right-to-left), as the Store's drawn screens are; their words show on the tile and the HMI's own
screens.

## The HUD overlay

`app/hud_overlay.js` draws on the HUD through the cluster renderer (target `hud`, 800 x 480, class `overlay`, over
the map and BMW's content), with the app's screen closed too: the left and right turn arrows over the map's top
corners (just above the map where the HUD has room, else inside its top edge, never past its sides), 52 x 34 px
(small 40 x 26, large 66 x 44), blinking 400 ms on, 400 ms off while their side is on, and the gear under the map at
its right side (inside its bottom edge where the HUD has no room under it), both following the map's size and place. Each is an image layer drawn on transparent pixels, which the
HUD shows as nothing; an arrow that is off is blank, not dropped, so a blink asks nothing of the HUD's slot. Nothing
is asked of the renderer while there is nothing to show. The gear shows only from the car (`VehicleInformation`
`DataPowerTrain2` and `statusGearboxDrive`, as Live Data reads them), never from demo data.

Which of the car's signals carries the turn signals is not known yet: `app/turn_signals.js` searches the car's
signal catalog (`/etc/oap/someip/someip-interfaces.json`) for fields named for turn signals and the Info page lists
them; until one is read, the arrows show for **Test left** / **Test right**.

## Started with the car

The package starts with the platform (`"mguAppStartType": "autostart"` in its `package.json`, which the Store's
deploy tool lists for the app manager): the app manager starts it with the head unit, starts it again if it stops
and never stops it for running in the background, so the HUD overlay works without the app being opened, as
waze-on-cluster's map does. What needs no screen (the waze-on-cluster clients, the gear, the turn signals, the HUD
overlay, the display language) is `background()` in `app/main.js`, which the kit runs from the start with or without
the app's screens; the pages are `start()`.

## The sockets

Unix stream sockets, newline-delimited JSON, group `tm_oap_app`. The app
holds the first two while it runs (the HUD overlay follows the map's size and
place) and the third while the Log page is shown, and retries each once a
second; the tools keep running without it. The render takes one owner at a
time: `waze-on-cluster run` from a shell is told `busy` while the app runs.

- **Render** `/dev/shm/waze-on-cluster/ctl.sock`. The app sends
  `{"cmd":"guide","hide":0|1}` (Hide BMW's turn box), `{"cmd":"cluster"|"hud","on"}` (Show on),
  `{"cmd":"hud","hud_width_pct"}`, `{"cmd":"hud","hud_x","hud_y"}` and `{"cmd":"hud","hud_brightness_pct"}`. The tool sends
  `{"ev":"status","state","target","page","reason","upload_cap_kb_per_s","upload_reason","hide_bmw_guidance","guide_disabled",
  "cluster","hud","hud_state","hud_width_pct","hud_brightness_pct","hud_x","hud_y"}`
  (`state` idle, starting, showing, frozen or error; `hide_bmw_guidance` 0
  or 1; `guide_disabled` 1 while the cluster renderer keeps the box shown),
  and `{"ev":"log","line"}`, which the app does not show.
- **Patch daemon** `/dev/shm/waze-on-cluster/patch.sock` (root). The app sends
  `{"cmd":"apply","panel":"high","mode":"avb"}`, `{"cmd":"revert"}`,
  `{"cmd":"aa-apply"}`, `{"cmd":"aa-revert"}`, `{"cmd":"aa-density","value"}`, `{"cmd":"aa-card","value"}`,
  `{"cmd":"reboot"}`, `{"cmd":"capture-start"|"capture-stop"}`, and saves the map settings:
  `{"cmd":"cluster"|"hud","on"}`, `{"cmd":"hud-size"}`, `{"cmd":"hud-pos"}`, `{"cmd":"hud-brightness"}`. The daemon sends
  `{"ev":"status","state","panel","mode","res","safe","carplay","reason","pending","conflict","busy","restart","aa","wifi"}`
  (`aa`: `{"state","reason","conflict","pending","aapd","dpi","diskCard","runDpi","runCard","density","card","densities","changeAt","error"}`;
  `restart`: `{"state","code","reason","possibleAt"}`; `wifi`: `{"band","iface","freq"}`, `band` `"5"` or
  `"2.4"`, while CarPlay runs over Wi-Fi and its band is known, else `null`)
  (`state` original, patched, unknown, busy or error; `carplay: "deferred"`
  while a change waits for the next start), `{"ev":"capture",…}`,
  `{"ev":"reboot-reply","ok","reason"}`, `{"ev":"refused","cmd","reason"}`
  (a command not taken; it changes nothing on the page) and
  `{"ev":"log","line"}`, which the app does not show. waze-on-cluster's
  PATCH.md, "Activation", has the fields.
- **Logs** `/dev/shm/waze-on-cluster/logs.sock`; a connection starts the
  logs service. The app sends `{"cmd":"save"}`. The service sends
  `{"ev":"state","url","saving","error","saved","archives":[{"name","size","mtime"}]}`
  on connect and on each change (`url` null without the hotspot's address;
  `error` `no-space`, `too-large` or `failed`).

A patch with another sink, panel, size (not `1088x480`) or safe area (not
`504x368+286+72`) shows `Status: Update needed`.

## Build and test

```sh
python3 tools/bake_fonts.py <fontdir> # fonts/ from locales/ (Pillow; the fonts it names), after a change of words
node tools/stage.js                  # robertn_waze_cluster@<version>/ from app/, src/, fonts/, locales/ and kit/ (Python 3), committed
node tools/build.js                  # robertn_waze_cluster@<version>.tgz from it
node tools/test_control.js           # the socket clients against fake sockets
node tools/test_i18n.js              # every language: its words, placeholders and glyphs
make -C ../../native/cluster-render build/host/host_service
node tools/test_hud.js ../../native/cluster-render/build/host/host_service   # the HUD overlay against the renderer on the host
```

The package has no `node_modules/oap-sdk`, which is BMW's: the Store's deploy tool generates it on the head unit
from the unit's own apps (mgu-store `tools/oap_link.js` `preparePackage`).

`node tools/fakes.js <render.sock> <patch.sock>` runs the fakes by hand; Enter starts or stops a fake CarPlay stream.

| Path | |
|---|---|
| `app/app.json` | the kit's description of the app: its screen, settings and signals |
| `app/main.js` | the pages |
| `app/hud_overlay.js`, `app/turn_signals.js` | the HUD's turn arrows and gear; which turn signal is on |
| `app/icon.png` | the tile's icon (`tools/icon.svg`) |
| `fonts/` | the app's glyph atlases and their fonts' licences (`tools/bake_fonts.py`) |
| `src/waze_cluster_control.js` | the render and patch socket clients and the status logic |
| `src/logs_control.js` | the logs socket client |
| `src/i18n.js`, `src/locales.js`, `locales/<code>.json` | the clients' words; the languages, written by `tools/gen_locales.js` |
| `src/qrcodegen.js` | Project Nayuki's QR code generator (MIT, `LICENSE-qrcodegen.txt`) |
| `tools/` | stage, build, fakes, tests, icon |
| `robertn_waze_cluster@<version>/` | the package tree (`tools/stage.js`) |

## License

GPL-3.0-or-later (`LICENSE`). The kit is MIT (`../../kit/LICENSE`, shipped as `LICENSE-kit.txt`); the cluster
renderer's client is MPL-2.0; the glyph atlases are drawn from the Ubuntu font family (Ubuntu Font Licence) and Noto
Sans (SIL Open Font License), their licences in `fonts/`. Third-party files keep their own licenses.
