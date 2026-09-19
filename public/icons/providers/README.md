# Provider icon overrides

Local brand assets so Settings tiles stay offline and match Xiaomi MiMo (full-bleed
rounded-square webp). Avatar files come from `@lobehub/icons-static-avatar` (MIT,
[lobehub/lobe-icons](https://github.com/lobehub/lobe-icons)).

| File | Source |
| --- | --- |
| `mimo.svg` | `@lobehub/icons-static-svg` → `icons/xiaomimimo.svg`. Kept as source; UI mono uses inline `XiaomiMiMoMono` so `currentColor` works in dark mode |
| `mimo.png` | `@lobehub/icons-static-png` → `light/xiaomimimo.png` |
| `mimo-avatar.webp` | `@lobehub/icons-static-avatar` → `avatars/xiaomimimo.webp` |
| `openai-avatar.webp` | `avatars/openai.webp` (also used by `openaicompatible`) |
| `azure-avatar.webp` | `avatars/azure.webp` |
| `azureai-avatar.webp` | `avatars/azureai.webp` |
| `anthropic-avatar.webp` | `avatars/anthropic.webp` (also used by `anthropiccompatible`) |
| `deepseek-avatar.webp` | `avatars/deepseek.webp` |
| `google-avatar.webp` | `avatars/google.webp` |
| `minimax-avatar.webp` | `avatars/minimax.webp` |
| `moonshot-avatar.webp` | `avatars/moonshot.webp` |
| `zhipu-avatar.webp` | `avatars/zhipu.webp` |
| `xai-avatar.webp` | Vendored xAI X mark on black (no `@lobehub/icons` 2.x key) |
| `xai.svg` | Source for the inline `XaiMono` mark |

`mimo` also vendors a mono SVG because `@lobehub/icons` 2.x has no XiaomiMiMo key
(`xiaomimimo` is v3+). Other providers still use the package for `type="mono"` /
`type="color"`.
