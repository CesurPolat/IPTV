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
tsconfig.json              Shared TypeScript and Angular compiler settings
turbo.json                 Task dependencies and build cache configuration
```

## Setup

Install dependencies from the repository root:

```sh
npm ci
```

The existing local Capacitor updater dependency is still required alongside this
repository at `../capacitor-web-updater`. Its package must include its compiled
`dist/` files, as before this migration. The application references it through
`file:../../../capacitor-web-updater` from `apps/client`.

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

The build compiles `@iptv/node-bridge` first, then `@iptv/client`. Angular copies the
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
