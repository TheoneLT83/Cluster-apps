# Changelog

## 0.9.6

- **Info bar**: a dark see-through bar (no tab); its items picked as the HUD's reading, a button each on the Display
  page: kW, battery charge, oil, coolant, boost, engine speed, torque (up to four; kW and charge with eDrive).
- **Green light alert** on the cluster: a smaller traffic light at the top of the cluster's middle.

## 0.9.5

- **Info bar on the cluster** (Display > Cluster, on by default): up to three values in the middle of the cluster, a
  little low, on a grey tab, while the Waze map shows there: the battery's kW with its bar (blue, green while
  recuperating, amber from 60 kW), its charge, oil, coolant (blue while cold), boost, engine speed or torque. Auto:
  kW, charge and oil with eDrive, else oil, coolant and engine speed.
- **Battery charge** between the HUD's turn signals (with eDrive).
- **Dimmer at night** (Display > HUD, on by default): the HUD's parts at 60 % after dark (the car's light sensor).
- **The kW is quicker**: with eDrive 2.8.4 the battery's power is read as fast as with eDrive's own screen open,
  each reading reaches the HUD and the cluster at once, and the bar eases between readings. The HUD's kW bar is
  coloured as the cluster's.

## 0.9.4

- **HUD installed: Yes / No** (Yes by default) in place of finding the HUD by itself, which did not work on every car.
- The HUD's and the cluster's settings are on the Display page only (no longer in Settings).
- **Display page**: the cluster on top, the HUD under it as wide as it (the part of the HUD the glass shows); each
  shows only what is switched on (the turn signals
  blink, the needles move, the traffic light comes now and then, the logo shows while not hidden).
- With idrive7-apps' Redline 1.15.2: the shared HUD folder can be written by every app, so Redline's HUD takes
  the HUD over and the map gives way.

## 0.9.3

- **Hide logo on the cluster** (the switch's new name).
- **Green light alert**: the Display page says whether the car's traffic-light camera was found (looked for 30 s
  after the start); without one the alert cannot show.
- The Store shows this update log (the catalog names CHANGELOG.md from this release on).

## 0.9.2

- **The green light alert is a traffic light**: red and yellow faint, green lit, on the cluster and the HUD.
- **Display page**: the switches on the left, the pictures of the cluster and the HUD on the right.
- **Hide BMW logo on cluster** is on the Display page only (Cluster tab), no longer on the Maps page.
- **Sharing the HUD with Redline**: Cluster functions says it is there in /dev/shm/mgu-hud (with
  idrive7-apps' kit/hud_claim.js), where Redline can read it.

## 0.9.1

- **Display page: a HUD tab and a Cluster tab.** HUD: Displays on HUD, turn signals, gear, real speed, the green
  light alert and the reading between the turn signals. Cluster: the map, hiding BMW's logo and the green light
  alert. On the left, the cluster and the HUD as pictures that move (the needles, the turn signals, "GO" now and
  then), each with what of the app is on there. The Display page is there on a car without a HUD too (Cluster only).
- **Green light alert on each display**: its own switch for the HUD and for the cluster.
- In Settings, the HUD's settings are under "On the HUD", the cluster's under "Cluster".

## 0.9.0

- **Green light alert** (setting, on by default): when the traffic light ahead turns green while the car waits at it,
  "GO" shows in the middle of the cluster and on the HUD for 4 s. From BMW's own traffic-light display
  (driver assistance), and the front camera's traffic lights where the car has them; the camera's colour codes are
  logged once each, so they can be checked. Not while driving; at most once each 10 s.

## 0.8.9

- **Head-up display: Auto / On / Off** in the settings: Auto goes by what the car answers (as in 0.8.8), On and
  Off say it outright.
- **Another app on the HUD**: while another app holds the HUD (Redline's Show on HUD, from idrive7-apps with
  kit/hud_claim.js), the HUD map and the turn signals, gear and data give way; the HUD map reads "Given to another
  app". Redline gives the HUD back when the car is switched off or the head unit starts again, and all of it shows
  as before. The choice where the map shows is kept throughout.

## 0.8.8

- **Full screen by default, once more**: the screen layout goes back to Full screen once on a car that kept
  Standard from before; a later choice is kept.
- **Cars without a head-up display**: the app asks the HUD's control unit (0x3D) over the head unit's diagnostic
  channel, the instrument cluster first, and keeps the answer. Without a HUD there is no Display page, no HUD map
  panel, no HUD choice under Show on, no HUD settings, and nothing of the app on the HUD; a map set to the HUD
  shows on the cluster. When the cluster does not answer either, the HUD's settings stay shown.
- **The HUD map's size moves nothing else**: the turn signals, the gear and the data are placed by a
  Standard-size box at the map's centre, so a bigger or smaller map leaves them where they are; moving the map
  still moves them with it.
- **CarPlay multitouch is no other tool**: with waze-on-cluster 0.9.11, the drop-in of mgu-store's CarPlay
  multitouch (which the iDrive7 Assistant installs with the Store) is not a conflict, so the patch shows as
  Patch, not as changed by another tool.

## 0.8.7

- **Why a patch cannot be applied**: under CarPlay's or Android Auto's status, the patch helper's reason (for
  example the head unit's variant it does not know), and in the log each time it changes.

## 0.8.6

- **Own settings for this driver** (Maps page, beside Hide BMW logo on cluster): the map's settings (where it
  shows, the HUD map's size, place and brightness) per driver profile, as the head unit's user account; unticked,
  the profile uses the shared ones. Greyed while no profile is known. From robertnisipeanu/idrive-apps'
  robertn_waze_cluster 0.6.3 (waze-on-cluster 0.9.3, here 0.9.9).

## 0.8.5

- **Gear**: S1 ... S8 in sport and M1 ... M8 in manual, as the cluster shows them (MDrive's gearbox programme, else
  the gearbox status's selector); the values the car sends are in the log. The gear's letters are centred in the
  row, level with the arrows.
- **Faster readings**: boost, power and torque, engine speed, the temperatures and the real speed reach the HUD
  within about a tenth of a second (each looked at every 80 ms, the layers up to 25 frames a second); the electric
  range and the battery's power four times a second (with eDrive 2.7.11).
- **HUD map**: its top and sides fade out more (56 px), its bottom less (16 px) (waze-on-cluster 0.9.8,
  cluster-render 0.4.5).

## 0.8.4

- **Display page** draws again: it stopped with an error before drawing anything, and while open the screen
  stopped updating, so the Maps page's choices (Cluster / HUD / Cluster + HUD, Hide BMW logo on cluster) seemed
  not to take.

## 0.8.3

- **A phone call shows on the HUD**: the HUD steps aside while BMW's call notification shows (its slot 0x321;
  cluster-render 0.4.3), as it does for the media pop-ups.
- **HUD map**: its edges fade out over 40 px each side, as the cluster's own map fades, a little narrower
  (waze-on-cluster 0.9.6).
- **Electric range** comes from idrive7-apps' eDrive (its power and its real range), and is offered only while eDrive
  is installed: this app no longer reads the battery unit itself, which disturbed eDrive's own reads.
- **Power and torque**: on a hybrid the power counts what the battery gives the motor (from eDrive), so electric
  driving shows its power.
- **Turn arrows**: one size, smaller, with a shorter tail; they blink at BMW's own pace (330 ms), the first flash
  whole; the row under the map sits closer to it, and the reading between the arrows is wider.
- **Displays on HUD** is on once more on every car (on by default).

## 0.8.2

- **Turn signals on the HUD from the car**: the arrows follow the indicator stalk and the hazard switch (both arrows),
  from `de.bmw.body.Light` `StatusFunctionsIndicators`.
- **Displays on HUD** (Settings): off, nothing of this app shows on the HUD, and the cluster renderer gives the HUD
  back to BMW's own layout a few seconds later (the HUD map stays under Maps' Show on).
- The cluster renderer 0.4.2 (with waze-on-cluster 0.9.5) logs what BMW shows in the HUD's slots, so where a phone
  call's notification goes while this app has the HUD can be read from the saved logs.

## 0.8.1

- **HUD**: the map's edges fade out, 16 px each side, instead of a hard cut (waze-on-cluster 0.9.4 with cluster-render
  0.4.1); the cluster's map is as it was.
- **Display**: the switches and the reading on the left, a larger picture of the HUD on the right. Test left / Test
  right and the gear's readout are gone; the HUD overlay's state, where the gear comes from (the car or demo data) and
  the signal catalog's turn-signal fields are in the log, each when it changes.
- **HUD**: the reading fills the space between the gear and the right arrow: the eDrive slider takes what the range
  leaves, oil and coolant are spread across it; the gear is slimmer and next to the left arrow.
- **Between the turn signals**, three more readings: **Boost** (the sport display's, a slider up to M Vitals' boost
  limit, else 2 bar, with the value in the knob), **Power and torque** (the car's crankshaft torque and torque x rpm)
  and **Engine speed** (a 0-7000 rpm slider with the rpm in the knob). **Power unit**, **Torque unit** and **Boost
  unit** in Settings: Auto takes M Vitals', Dyno's or Live Data's where one is installed and readable, else kW, Nm, bar.

## 0.8.0

- **HUD**: the turn arrows, the gear and one reading in one row under the map, BMW's own speed and limit sign left
  as they are: the left arrow right after BMW's speed, the gear beside it, the right arrow at the map's right edge,
  and between them the reading chosen: **Electric range** with the eDrive power (a slider with its kW, green while
  regenerating) or **Oil and coolant**.
- **Real speed on HUD** (Settings): the car's own speed left of BMW's speed reading, for a car whose mileage blocker
  stops BMW's.
- **Display** (was Info): **Turn signals** and **Gear** on or off, the reading **Between the turn signals** (None,
  Electric range, Oil and coolant), with a picture of the HUD.
- **Maps**: **Reinstall patch** while another tool's or an older app's patch is on carplay, and **Restart head unit**
  after a patch applied without one too (waze-on-cluster 0.9.3). **Hide BMW logo on cluster** names the switch that was
  Hide BMW's turn box.
- The HUD map starts at 65 % wide, 50 % brightness, 20 px right and 30 px up (waze-on-cluster 0.9.3).

## 0.7.0

Cluster functions: the app is named so, with a new icon (an instrument cluster), and is drawn by the Store's
renderer with the idrive7-apps kit, in its look: tabs Maps, Info, Log and the kit's Settings sheet. It starts
with the head unit, as waze-on-cluster does: the HUD's turn signals and gear need no opening of the app.

- **Maps**: Show on (Cluster, HUD, Cluster + HUD), the cluster map's and HUD map's state, Hide BMW's turn box;
  CarPlay or Android Auto, each with its patch (Patch, Remove patch), CarPlay's Wi-Fi band, Android Auto's zoom and
  turn card, Restart head unit while a change waits for it; the HUD map's Size, Position and **Brightness** (10 % a
  step, 10-100 %: the map alone dims, BMW's own HUD content keeps its brightness), with a picture of the HUD.
- **Turn signals and gear on the HUD**: small arrows over the map's top corners, within its sides, blinking while
  their side is on, and the gear under the map at its right side, drawn through the cluster renderer. The gear comes from
  the car; the turn signals show for Test left / Test right on the Info page, which lists the fields of the car's
  signal catalog that may carry them.
- **Log**: the app's log and the saved logs for a phone on the car's hotspot.
- **Settings**: turn signals and gear on the HUD, the arrows' size, colours, layout.
- In the HMI's display language, every page, the settings and the tile; Arabic, Hebrew and Thai pages in English.

Requires waze-on-cluster 0.9.2 (the brightness), the Store's renderer mgu-render 0.6.17 and the controller gate
mgu-inputgate 1.0.0 (the iDrive controller on the app's screen; from mgu-store, or idrive7-apps' own).

## 0.6.1

Android Auto's Patch is offered on an `Untested version` too, and patches
it; an install leaves such a version as it is. While Android Auto reports
any other conflict, Zoom out, Zoom in and Hide phone's turn card are greyed
and its Status names the conflict (`Changed by another tool`, `Not
supported on this car`, `Unavailable`), also while it is patched.

Remove patch, for CarPlay and Android Auto, is offered whenever something
of the patch is on disk, also while it waits for a restart (`Patched after
restart`). A patch waiting over the original is removed at once and the
Status reads `Not patched`; one waiting over a running patch leaves a
removal that waits too (`Removed after restart`). Requires
waze-on-cluster 0.9.1, which finds Android Auto's edit sites in any aapd
build, undoes the proven builds without their backups, and refuses a
removal of the tool while an edit of its own is left.

## 0.6.0

The map on the HUD, contributed by eroobeeroo and wesleyredhat. Show on, a
drop-down in General, chooses where the map shows: Cluster (the default),
HUD (experimental) or Cluster and HUD (experimental); with both the HUD uses
up to half the upload bandwidth, only what it needs. With the map not on
the cluster, `Cluster map: Off` and the Hide BMW's turn box checkbox is
greyed. A HUD section: `HUD map: …`, the Size slider (5 %
a step from 30 % to 85 %) and `Position: …` with Move left, Move right, Move
up, Move down and Centre, greyed while the HUD is off, and while the
cluster renderer keeps it off after errors (`HUD map: Disabled after
errors`). The settings take effect at once and are kept for the next
start, in a file of their own that waze-on-cluster 0.8 does not read, so
going back to it keeps working. These rows are in the head unit's display language, as is the rest
of the page. Requires waze-on-cluster 0.9.0.

The page's sections: General first, then HUD, CarPlay, Android Auto.
Restart head unit and its Restart row are the page's last rows, so nothing
above them moves when they show.

CarPlay's section shows `CarPlay Wi-Fi: 5 GHz` or `CarPlay Wi-Fi: 2.4 GHz`
while CarPlay runs over Wi-Fi and waze-on-cluster knows the band. On 2.4
GHz a line under it says `Audio may cut out. On your iPhone, turn Wi-Fi off
and on.` Saved logs include CarPlay's Wi-Fi band, the Wi-Fi interfaces'
counters and the kernel's Wi-Fi connection lines.

## 0.5.7

The map's capture starts at boot after the head unit's media bus is up,
ordered after BMW's own media services and never holding any of them up.
Requires waze-on-cluster 0.8.6.

## 0.5.6

When boot recovery removed a patch because the head unit kept restarting
with it, its Status row reads `Removed — head unit kept restarting`, in the
display language, also with part of the patch left, until its Patch button
applies the patch again. On a head unit that refuses the tool, `Not
supported on this car` comes first. Requires waze-on-cluster 0.8.5.

## 0.5.5

On a HIGH F car where waze-on-cluster 0.8.2 removed the patch at boot, the
update puts it back by itself: the app shows `Status: Patched after
restart`, and the map returns at the next head-unit start or drive.
Requires waze-on-cluster 0.8.4.

## 0.5.4

HIGH F head units are supported again, as every variant is; only a head
unit whose variant cannot be read shows `Not supported on this car`.
Requires waze-on-cluster 0.8.3.

## 0.5.3

Every word on both pages, and the tile's name, in the head unit's display
language: each language the iDrive 7 HMI offers, English where a language
has no translation. A change of the display language shows at once. Values
from the tools (reasons, addresses, numbers) are shown as they are.

## 0.5.2

On a head unit that refuses the tool (HIGH F, or a variant it cannot
read), CarPlay and Android Auto both read `Status: Not supported on this
car`, also while a patch from before is on disk or an apply of it waits
for the next start, which boot recovery turns into a restore; Restart head
unit stays offered while one is needed. Neither Patch button, Zoom out,
Zoom in nor the turn card checkbox is offered there; Remove patch stays.
`Cluster map: Unavailable` while the tool reports itself unsupported, and
the Hide BMW's turn box row is greyed. Requires waze-on-cluster 0.8.2.

## 0.5.1

The main page in three sections under header rows. CarPlay and Android Auto
have the same rows with the same words: `Status: …`, Patch and Remove
patch; Android Auto adds Zoom (`Zoom: 170 dpi`), Zoom out, Zoom in and the
Hide phone's turn card checkbox. General: `Cluster map: …` (the map the
shared render draws for either phone), the Hide BMW's turn box checkbox,
Logs, and Restart head unit with its `Restart: …` row. Info rows read
`Name: Value`; on/off settings are `Hide …` checkboxes; `(after restart)`
marks a value that waits for the next head-unit start. Both Status rows
use one set of words (`Patched`, `Not patched`, `Patching…`, `Patched after
restart`, `Failed`, `Not supported on this car`, …). Rows stay in place and
are greyed when they cannot act; while any change runs, every change in
both sections is greyed. Restart head unit, the last row, shows only while
a change waits for a restart; its row says when it failed, why, and when
the 10-minute limit allows the next. The log lines and the setup line are
off the main page; Start capture is on the Logs page. Restart head unit
asks the Node State Manager for a normal restart. Requires
waze-on-cluster 0.8.1.

## 0.5.0

Android Auto next to CarPlay: a line with its state (patched and its
density, off, pending, not supported on this car, untested aapd build),
Enable Android Auto, Disable Android Auto, Zoom out and Zoom in for the
density, and Hide turn card / Show turn card. Restart head unit also
activates a pending Android Auto change. Requires waze-on-cluster 0.8.0.

## 0.4.4

Hide BMW turn box: a checkbox on the main page. Ticked (the default), BMW's
own CarPlay turn-by-turn box on the cluster stays hidden while the Waze map
shows; unticked, it shows. The choice takes effect at once and is kept
across restarts and updates. While the cluster renderer keeps the box shown
(its mapping guard), the checkbox is greyed and labelled unavailable.
Requires waze-on-cluster 0.7.13.

## 0.4.3

A Logs page: Save logs saves an archive of the tools' logs, the journal
lines they keep and their status, and a phone on the car's Wi-Fi hotspot
downloads the saved archives from the address the page shows, as text and as
a QR code. Requires waze-on-cluster 0.7.11.

## 0.4.1

While CarPlay's stream is live but shows no map, the status says why, from
waze-on-cluster 0.7.2 on: "Stream lost — reconnect CarPlay", or "Stream
lost — restarting CarPlay" where the tool restarts CarPlay itself.

## 0.4.0

The page says to set Instrument cluster > Central display area to Map view:
the Waze map replaces the stock map while CarPlay streams it, and the stock
map is back when the stream ends or freezes. A frozen stream shows "Map
frozen — reconnect CarPlay". Requires waze-on-cluster 0.6.0.

## 0.3.1

The page says to set Instrument cluster > Central display area to Off: with
Map view, Route preview or Assisted Driving View there, the cluster shows its
own content in the centre instead of the map.

## 0.3.0

Installing the app from the Store installs the Waze tool and the cluster
renderer too. The tool writes the CarPlay patch as it installs, without
restarting CarPlay; until the next head-unit start the app shows "Patch
pending — reboot to activate". Enable map appears only when the patch is
off, unknown or out of date, Disable map only when it is on. When the install
leaves CarPlay unpatched (an unknown CarPlay build, or another tool starting
CarPlay), the app says why and offers Enable map. The Store can remove the
app and then the Waze tool, which restores CarPlay.

## 0.2.11

When a patch change waits for the next head-unit start, the app says so and
offers a Restart head unit button. A boot recovery service restores the
original CarPlay binary after repeated failed starts with the patch.

## 0.2.10

The map appears on the cluster by itself when CarPlay streams it and goes
away when the stream stops; there is no Show or Stop button. Disable map
turns the feature off.

## 0.2.9

Enable map sets the area where the phone places its guidance, so Waze's
next-turn banner stays visible between the gauges. Units patched with a
full-frame area are prompted to update.

## 0.2.8

The map is drawn in the cluster's native map area (1088x480), under the
gauges. Units patched at another size are prompted to Enable map again.

## 0.2.7

Enable map applies a single patch configuration, including the size the
phone renders the map at. Units on another panel setting are prompted to
update.

## 0.2.6

Enable map uses a single capture path; the capture mode row is removed.
Capture logs has its own button.

## 0.2.5

The status line reads "Patch state unknown — enable the map" until the patch
daemon reports, so the page opens cleanly.

## 0.2.4

After Enable map, the cluster stream starts with the CarPlay session. A patch
waiting for the next head-unit start reads "Patch pending — …".

## 0.2.3

The diagnostic capture window is up to 5 minutes.

## 0.2.2

Capture mode offers a UDP stream sink.

## 0.2.1

Capture logs: a bounded DLT capture, with its status and an early stop.

## 0.2.0

A capture mode choice for Enable map.

## 0.1.0

First release: a page to apply and revert the CarPlay patch, show and stop
the map on the cluster, and read both tools' logs.
