# Apply Hub ↔ Connect integration (AsperaDock 0.5.73)

This agent cannot push to `ramchandragada/AsperaDock` (403). Apply these files in the Hub repo:

## Files to copy into AsperaDock

| This folder | Destination in AsperaDock |
|---|---|
| `asperaConnectCall.js` | `src/asperaConnectCall.js` |
| `asperaConnectCallPolicy.js` | `src/asperaConnectCallPolicy.js` |
| `safeShell.js` | `src/safeShell.js` (replace) |
| `asperaConnectCall.test.mjs` | `test/asperaConnectCall.test.mjs` |

## Manual edits in `src/main.js`

1. Add import near other shell imports:
```js
import { openAsperaConnectApp } from './asperaConnectCall.js';
```

2. In Help submenu, after "Visit asperahub.com":
```js
{
  label: 'Open Aspera Connect…',
  click: () => openAsperaConnectApp(),
},
```

## Version

Bump `package.json` version to `0.5.73`.

## Verify

```bash
node --test test/asperaConnectCall.test.mjs
npm test
npm run make   # ship new Hub .deb
```

## What employees get

1. Install Aspera Connect (desktop + phone) and pair with Show QR
2. In Zoho inside Hub, click a phone number
3. Hub launches `/usr/bin/aspera-connect tel:…` → phone dials
4. Help → Open Aspera Connect… focuses the companion

No need to embed the full Connect UI inside Electron.
