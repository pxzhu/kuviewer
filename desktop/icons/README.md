# Desktop Icon Artifacts

Platform icon generation is deferred. Use the transparent YAML Flow source icons from `website/public` when generating desktop assets:

- `favicon-32x32.png`
- `favicon-192x192.png`
- `apple-touch-icon.png`

Expected future outputs:

- `icon.icns` for macOS `.dmg`
- `icon.ico` for Windows `.exe`

Only commit generated icon files that are derived from the public app icon. Do not place signing material or private credentials in this directory.
