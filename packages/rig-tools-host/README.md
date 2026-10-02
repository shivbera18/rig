# @rig/rig-tools-host

Host-neutral Node.js lifecycle for an embedded `rig-tools` artifact. The package validates the
versioned artifact, starts the local OAuth lease broker, installs profile-scoped launchers and owns
their cleanup.

The host remains the only credential-store, Refresh Token, refresh and logout owner. The host OAuth
Core persists credentials in its profile-scoped `auth.json`; this package and the embedded child
only receive short-lived Access Token leases. This package depends on `@rig/oauth-lease-protocol`;
it must not depend on Electron, `@rig/oauth-core` or a credential store.

Generated launchers clear inherited sandbox, API/auth URL, client and scope overrides before setting
the host-owned shared-broker coordinates. This keeps Desktop and TUI on the artifact's baked
business API profile while a lease is in use.

## Embedded Resources and System Proxy

System proxy discovery and Node fetch initialization are handled by the rig-tools CLI itself. The host only provides the auth broker and resource distribution, without injecting proxy addresses or duplicating CLI business domain mappings.

Resource validation remains backwards-compatible with schema v3. Schema v4 permits CLI, registry-js licenses, and Windows x64/arm64/ia32 precompiled binaries, verifying the complete resource set, SHA-256 hashes, and rejecting symlinks. `resource-manifest.mjs` is used by runtime, Desktop/TUI packaging, and artifact acceptance; packaging locks the v4 manifest SHA-256, and native resource integrity hashes are compiled into the CLI.
