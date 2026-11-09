# IPTV

Angular 17 and Capacitor application managed with npm workspaces and Turborepo.

The .NET 8 API is included as the `@iptv/server` workspace.

## Repository layout

```text
apps/client/                 Angular application and Capacitor configuration
  src/                     Application source and environments
  android/                 Native Android project
  dist/iptv/browser/        Web build output (generated)
apps/server/               .NET 8 API solution and its five C# projects
packages/node-bridge/       Embedded Node.js bridge
  src/                     Bridge source and type declarations
  dist/                    Compiled bridge (generated)
packages/capacitor-web-updater/  Capacitor updater plugin (web, Android and iOS)
  src/                     Plugin source and type declarations
  dist/                    Compiled plugin (generated)
tsconfig.json              Shared TypeScript and Angular compiler settings
turbo.json                 Task dependencies and build cache configuration
```

## Setup

Install dependencies from the repository root:

```sh
npm ci
```

The Capacitor updater plugin is included in `packages/capacitor-web-updater` as
an npm workspace. No sibling checkout is required. Turbo builds the plugin before
the client during development, builds and Capacitor sync.

On Windows PowerShell, use `npm.cmd` if execution policy blocks `npm.ps1`.

## Development

```sh
npm run dev
```

Open `http://localhost:4200`. `npm start` is also supported. Development environment
settings are in `apps/client/src/environments/environment.development.ts`.

This starts both the client and server. Install the .NET 8 SDK (or a newer SDK
with the .NET 8 runtime) for the server. The API runs at `https://localhost:7288`
with Swagger at `/swagger`; this matches the client's development API URL.
If HTTPS is not trusted locally, run `dotnet dev-certs https --trust` once.
The existing server CORS policy already accepts the client origin.

Use `npm run dev:client` or `npm run dev:server` to start only one application.

Turbo builds the Node bridge before starting Angular. After changing bridge source,
restart the development server to rebuild it. `npm run watch` provides Angular's
development build watcher with the same initial bridge build.

Generate Angular code from the root with, for example:

```sh
npm run ng -- generate component components/example
```

## Build and checks

```sh
npm run build
npm run typecheck
npm test
```

The build compiles `@iptv/node-bridge` and `capacitor-web-updater` before
`@iptv/client`. Angular copies the
bridge output into `dist/iptv/browser/nodejs/` inside the application workspace.
Turbo caches each package's `dist/` output locally in `.turbo/`.

The root build also builds the server solution in Release mode. Server builds use
.NET's incremental build instead of Turbo's output cache, so NuGet restore assets
and machine-specific `obj/` paths are never restored from a shared cache.
`npm run build:server` builds only the API. There are currently no server test
projects; `npm test` runs the existing client tests.

Tests run once using ChromeHeadless, which requires Chrome or Chromium. Set
`CHROME_BIN` if the browser is installed in a nonstandard location. Use
`npm run test:watch` for interactive Karma tests.

Build only the bridge with `npm run build:nodejs`. To pass Angular-specific build
options directly, first build the bridge, then use the application workspace:

```sh
npm run build:nodejs
npm run build --workspace=@iptv/client -- --configuration development
```

## FTP deployment (Windows)

Copy `deploy.example.json` to `deploy.local.json` and set the FTP host, port,
username, API directory and client ZIP directory. Paths are absolute inside the
FTP account (for example `/api` and `/versions`). Keep the local file out of Git.
Set `protocol` to `ftp`, `ftps` (explicit TLS, normally port 21) or
`ftps-implicit` (normally port 990). Set `api.iis` to `false` for a server where
IIS offline handling is not required; the remote host must otherwise arrange
its own application restart.

```sh
npm run deploy
npm run deploy:api
npm run deploy:client
npm run deploy -- -DryRun
npm run deploy:api -- -Force
```

`deploy` publishes the Release API, uploads changed API files, builds the
production client and uploads its ZIP. `-DryRun` still builds and packages both
projects, but never connects to FTP or changes deployment state. `-Force`
uploads every non-excluded API file. Firebase remains available through
`npm run deploy:firebase`.

The script reads `IPTV_FTP_PASSWORD` first, then an optional `password` field in
the ignored `deploy.local.json`, and prompts if neither is set. The local JSON
stores that optional password as plain text; keep it out of shared files.
Credentials are passed to curl
over stdin. Windows PowerShell, `curl.exe`, Node/npm and the .NET SDK are required.

API comparison uses SHA-256 against the last successful deployment on this
computer, separately for each FTP account and API directory. The first deploy
uploads every non-excluded file. State and publish artifacts live in ignored
`dist/deploy/`. Remote files are never deleted. Remote edits are not detected;
use `-Force` after changing files manually or switching deployment computers.
Concurrent commands from this checkout are blocked; coordinate deployments
from other checkouts/computers separately.

By default, API `appsettings*.json` files listed in `api.exclude` are preserved.
Provision production settings on the server before the first deploy, or adjust
the explicit exclusion list. Never publish Development or local secrets.
IIS deploys put `app_offline.htm` in place, wait for shutdown, upload changed
files and remove the marker on success. A failed upload leaves the API offline
and keeps the previous hash state: fix the error and rerun. This is not an atomic
release or automatic rollback. After manually restoring a working release,
remove `app_offline.htm` to bring it online.

The client ZIP contains the **contents** of `apps/client/dist/iptv/browser`, with
`index.html` at the archive root. Its filename comes from the production
`environment.ts` version: `0.8.1` produces `dist/deploy/0_8_1.zip`, uploaded to
`client.remoteDir/0_8_1.zip`. Update that version before a new client release;
the current source version is `0.8.0`. The upload uses a `.uploading` suffix and
renames the completed archive to `.zip`. Use a new version for each release;
an existing filename is moved to a temporary backup before the completed ZIP
is renamed into place. A failed rename attempts to restore that backup; after
success the backup is deleted. Use unique versions so already installed clients
can recognize new releases.
Serve the versions directory at the URL expected by the Capacitor updater.

Run the isolated deployment behavior checks (no FTP connection) with
`powershell -NoProfile -ExecutionPolicy Bypass -File scripts/deploy.tests.ps1`.

## Android

```sh
npm run cap:sync
npm run cap:open
```

`cap:sync` builds the web assets and syncs them to the Android project.
`cap:open` opens `apps/client/android` in Android Studio. Native compilation still
requires the Android SDK and the JDK required by the existing Gradle project.

Run Capacitor commands from `apps/client`, or through the root scripts above, so
Capacitor can find its configuration. To add another application or shared package,
create a package with a unique name under `apps/*` or `packages/*`, declare any
workspace dependencies in its `package.json`, then run `npm install` at the root.

## Server configuration

The API solution lives at `apps/server/IPTVAPI.sln`. Its Application, Domain,
Infrastructure, Persistence and web projects retain their existing references.
The original external `IPTVAPI` directory was copied, and is unchanged.

Tracked `appsettings.json` and `appsettings.Development.json` contain example
connection settings and empty credential fields. Existing local settings were
preserved in `apps/server/IPTVAPI/appsettings.Local.json`. This file is ignored by
Git, excluded from publish output and loaded only in Development. Environment
variables override local settings (for example `Storage__Provider` or
`GoogleOAuth__ClientSecret`). A fresh checkout needs its own local settings or
environment variables for any external services it uses.

The server retains its original background channel refresh and automatic
recording behavior. Set `Recording__Enabled=false` to disable startup recording,
and `Storage__Provider=LocalDisk` to use local recording storage. Runtime recordings,
FileStorage contents, build output and IDE caches are not imported into Git.
The original `apps/server/README.md` retains the API's channel notes.
