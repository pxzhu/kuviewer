# Kuviewer Desktop Packaging Spike

This folder tracks the installable read-only desktop cluster explorer goal.

The recommended packaging path is Tauri first, with Electron kept as a fallback if the desktop shell needs browser APIs or extension behavior that Tauri cannot cover cleanly. The first installable targets are macOS `.dmg` and Windows `.exe`.

## Scope

- Reuse the existing React/Vite UI and Go read-only API.
- Keep the desktop app read-only: resource inventory, topology, relations, Events, and Pod logs.
- Keep upload/mock mode available without a server.
- Start with remote API connection to an existing Kuviewer server.
- Evaluate a local Go sidecar only after the shell scaffold is stable.

## Security Defaults

- Do not ask users to paste kubeconfigs into the browser UI.
- Do not persist kubeconfigs, admin tokens, cloud credentials, private keys, Secret values, Events, or logs in the app bundle.
- Do not add operational actions such as exec, port-forward, restart, scale, delete, apply, or edit in the packaging spike.
- Treat desktop connection settings as UI/session state until a dedicated keychain-backed design is implemented.

## Validation

Run the packaging spec check from the repository root:

```bash
node scripts/check-desktop-packaging-spec.mjs
```

The check keeps the spike honest by verifying the target artifacts, read-only security defaults, and package phase ordering.
