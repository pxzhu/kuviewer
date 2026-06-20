# Desktop Icon Artifacts

Platform icon generation uses the transparent YAML Flow source icon from `website/public/images/brand/kuviewer-icon-yaml-flow.png`.

Regenerate the committed desktop icons from the repository root:

```bash
node scripts/generate-desktop-icons.mjs
```

Committed outputs:

- `32x32.png`
- `128x128.png`
- `128x128@2x.png`
- `icon.png`
- `icon.icns` for macOS app icon containers
- `icon.ico` for Windows app icon containers

Only commit generated icon files that are derived from the public app icon. Do not place signing material or private credentials in this directory.
