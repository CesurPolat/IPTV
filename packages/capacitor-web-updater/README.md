# capacitor-web-updater

A auto updater plugin for capacitor

## Workspace development

This plugin is part of the IPTV npm workspace. Install dependencies from the
repository root, then build the plugin:

```bash
npm ci
npm run build --workspace=capacitor-web-updater
```

The client depends on this workspace directly. `npm run cap:sync` from the
repository root builds the plugin and client before syncing Android.

## API

<docgen-index>

* [`echo(...)`](#echo)
* [`listAssets()`](#listassets)
* [`listVersions()`](#listversions)
* [`getVersion(...)`](#getversion)

</docgen-index>

<docgen-api>
<!--Update the source file JSDoc comments and rerun docgen to update the docs below-->

### echo(...)

```typescript
echo(options: { value: string; }) => Promise<{ value: string; }>
```

| Param         | Type                            |
| ------------- | ------------------------------- |
| **`options`** | <code>{ value: string; }</code> |

**Returns:** <code>Promise&lt;{ value: string; }&gt;</code>

--------------------


### listAssets()

```typescript
listAssets() => Promise<{ value: string[]; }>
```

**Returns:** <code>Promise&lt;{ value: string[]; }&gt;</code>

--------------------


### listVersions()

```typescript
listVersions() => Promise<{ value: string; }>
```

**Returns:** <code>Promise&lt;{ value: string; }&gt;</code>

--------------------


### getVersion(...)

```typescript
getVersion(options: { value: string; }) => Promise<{ value: boolean; }>
```

| Param         | Type                            |
| ------------- | ------------------------------- |
| **`options`** | <code>{ value: string; }</code> |

**Returns:** <code>Promise&lt;{ value: boolean; }&gt;</code>

--------------------

</docgen-api>
