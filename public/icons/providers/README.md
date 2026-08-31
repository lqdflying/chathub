# Provider icon overrides

Local brand assets used when `@lobehub/icons` (ChatHub pins 2.x) does not ship the logo yet.

| File | Source |
| --- | --- |
| `mimo.svg` | `@lobehub/icons-static-svg` → `icons/xiaomimimo.svg` (MIT, [lobehub/lobe-icons](https://github.com/lobehub/lobe-icons)). Kept as source; UI mono uses inline `XiaomiMiMoMono` so `currentColor` works in dark mode |
| `mimo.png` | `@lobehub/icons-static-png` → `light/xiaomimimo.png` |
| `mimo-avatar.webp` | `@lobehub/icons-static-avatar` → `avatars/xiaomimimo.webp` — Settings/model avatar tiles |

Remove these overrides once ChatHub upgrades `@lobehub/icons` past the XiaomiMiMo release (v3+) and maps `mimo` → `xiaomimimo`.
