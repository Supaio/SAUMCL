# SAUMCL

**SAU Minecraft Launcher** is a Minecraft Java Edition launcher for the Sichuan Agricultural University (SAU) player community, based on [SJMCL](https://github.com/UNIkeEN/SJMCL).

[简体中文](docs/README.zh-Hans.md) · [繁體中文](docs/README.zh-Hant.md)

## Download

Download **Indev GL 19.3** from [Supaio/SAUMCL Releases](https://gitlab.com/Supaio/saumcl/-/releases).

- Windows x64: `SAUMCL.exe`.
- Linux x64: `SAUMCL`; run `chmod +x ./SAUMCL` before launching.
- `SHA256SUMS.txt` contains the download checksums.

The welcome window and About page display the community usage reminder for SAU students, alumni and members of the CLMC group (719489600).

## Current features

- Microsoft account login, game installation and Java downloads.
- Instance management and Modrinth resource downloads.
- Simplified Chinese, Traditional Chinese and English.
- SAUMCL branding, the campus background and adaptive left navigation.
- Update notifications from this repository's Releases, including newer Indev versions.

Microsoft authentication still uses SJMCL's OAuth application; the login panel and About page identify this. Intelligence and extension features are paused. School-server multiplayer validation is pending while the server is offline.

## Development

Use Node.js 22 or newer, pnpm **10.26.1**, Rust **1.98.1 or newer**, and the platform's Tauri build prerequisites.

```sh
git clone https://gitlab.com/Supaio/saumcl.git SAUMCL
cd SAUMCL
pnpm install --frozen-lockfile
pnpm tauri dev
```

`main` contains the current SAUMCL baseline. GitLab migration work uses `codex/gitlab-migration`; the shadcn/ui experiment remains on its own branch.

Application code is in `src/` and `src-tauri/`; frontend assets are in `public/`. Build, localization and installation helpers are in `scripts/`. GitLab CI builds and uploads the Windows/Linux packages. Publishing a Release requires explicit review of its update notes; the old GitHub workflows are retained for reference. Release notes are in `docs/releases/`.

Report SAUMCL issues at [Supaio/SAUMCL/issues](https://gitlab.com/Supaio/saumcl/-/issues).

## Upstream and license

SAUMCL is based on **SJMCL**: https://github.com/UNIkeEN/SJMCL. Original copyright © 2024–2026 SJMCL Team; SAUMCL modifications © 2026 SAUMCL contributors.

See [LICENSE](LICENSE) and [LICENSE.EXTRA](LICENSE.EXTRA). Existing third-party notices and upstream acknowledgements are retained.
