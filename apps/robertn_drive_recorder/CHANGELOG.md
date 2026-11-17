# Changelog

## 1.0.7

- **The player answers this app** (Drive Recorder player 1.2.14): the player answers only the app in IterioDev's
  app record and runs as the uid it is given, so it refused this app and could not open its connection ("socket ...
  Permission denied"). It now runs as its own user with a record of this app that only it sees.

## 1.0.6

- **The player can open its connection again** (Drive Recorder player 1.2.13): before each start its folder in /run is
  made the player's own again and an old connection file removed ("socket ... Permission denied").

## 1.0.5

- **The player gets only clip folders it can open** (Drive Recorder player 1.2.12): one it cannot read (the
  `/var/opt/hdshare` one on some cars) made it stop at once ("no clip folders / bad uid").
- While the player restarts, the Record page says why it stopped (the player's own last words).

## 1.0.4

- **Clips where the car keeps them** (Drive Recorder player 1.2.11): a car whose recorder writes to
  `/var/opt/hdshare/ent/driverecorder` has its clips listed and played too.

## 1.0.3

- **The player starts on a car without a clip folder yet** (Drive Recorder player 1.2.10): the player waited for the
  folder the car's camera service makes, so Drive recorder said "player not running" although it was installed. The
  player's set-up now makes that folder as the car does. While the player waits or restarts, the Record page says why
  instead of asking to install it.

## 1.0.2

- **Installs in one go** (Drive Recorder player 1.2.8): the player, installed first, stopped while Drive recorder
  was not there yet, so the Store took the install back ("not healthy"). It now waits for the app and starts with it.

## 1.0.1

- **The player answers it** (Drive Recorder player 1.2.7): the player answered only IterioDev's own app, so Drive
  recorder said it was not installed. It now starts for Drive recorder (within 10 s of the app's install).

## 1.0.0

- **Drive recorder**: the car's cameras kept recording from the car's start, Save clip (the seconds before and after),
  the clips listed newest first, a clip watched while parked (its cameras, back and forward 10 s, speed and time),
  locked, deleted or copied to a USB stick (as recorded, or one camera as an MP4); the clip length and Start with the
  car. The recording and the clips are IterioDev's Drive Recorder player (`iteriodev-drplay`), installed with it.
