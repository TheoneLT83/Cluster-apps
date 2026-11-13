# kit

The app kit of [idrive7-apps](https://github.com/TheoneLT83/idrive7-apps) (MIT, `LICENSE`), copied
at its commit `ffc6a59` for the apps here that draw their own screens (`apps/robertn_waze_cluster`):

| Path | |
|---|---|
| `runtime/` | the kit runtime the app ships (`javascript/kit/`): screens, drawing, settings, signals, renderer client |
| `tools/build.py` | stages an app's package from `app.json` and its `.js` files; `--no-sdk` leaves out `node_modules/oap-sdk`, which the Store's deploy tool generates on the head unit |
| `tools/localize.py`, `tools/locale-revisions.json`, `tools/pack_data.py`, `tools/make_icon.js` | what `build.py` uses |
| `platform/permissions.json`, `localization/credit.*.json` | what `build.py` copies into a package |

Differences from that commit:

- `runtime/renderd.js`: the apps here draw on the Store's renderer (`mgu-render`,
  `/run/mgu-render/render.sock`) alone.
- `runtime/mgu.js`: an app's `background(bg)` runs from the start, with or without the app's screens (an app the
  platform starts by itself), and `start(ctx)` gets what it returned as `ctx.background`.
- `runtime/fonts.js`: Greek and accented Latin have supplemental atlases too, a script's `-bold` atlas draws bold
  text, and `useScripts({ script: family })` names an app's own atlas for a script.
- `runtime/display.js`, `runtime/mgu.js`: `ctx.display.settingsLabel` names the Settings tab and sheet (an app that
  follows the HMI's display language).
- `runtime/display.js`: a screen of the HMI's 1920 x 720 shape with fewer pixels (an NBT Evo display, 1440 x 540) is laid
  out as 1920 x 720 and given to the renderer scaled to it.
- `tools/build.py`: `--no-sdk`, and the app and output folders from `MGU_KIT_APPS` and `MGU_KIT_DIST`.
