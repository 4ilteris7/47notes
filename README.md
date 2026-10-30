# 47Notes

A locally running Windows desktop app for notes, tasks, a calendar, and diagrams. No account or internet connection is required.

Current source version: **1.5.3**.

## Features

- Local notes with categories, tabs, search, and a trash bin.
- Tasks with optional dated reminders.
- Calendar with day, month, and year selection.
- Desktop notifications, calendar alarms, and five-minute snooze.
- Background alarms while the app stays in the system tray.
- Multiple diagram projects with editable cards and connections.
- Local JSON backup and restore.
- Windows taskbar integration and a shared red accent across the interface.

## Download

Published Windows installers are available in [Releases](https://github.com/4ilteris7/47notes/releases). The current source version may be newer than the latest published installer.

## System requirements

- Windows 10/11, 64-bit.
- Node.js and npm for development.

## Development

The application source code is included in this repository.

```sh
npm ci
npm start
```

Run the automated tests:

```sh
npm test
```

Build the Windows installer:

```sh
npm run build
```

The installer is written to `release/Notes-Setup-1.5.3.exe`.

## Local data

Notes and settings are stored in the Windows user profile, separately from the application files. User data, local update backups, QA profiles, dependencies, and generated installers are excluded from this repository.

Closing the window keeps Notes running in the system tray. Use the tray menu to quit completely; alarms stop while the app is fully closed or the computer is asleep.

See [the Turkish development and usage notes](docs/DEVELOPMENT.tr.md) and [the update notes](CHANGELOG.md) for more details.
