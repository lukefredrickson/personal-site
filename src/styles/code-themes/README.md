# Vendored code themes

`dawnfox.json` (light) and `duskfox.json` (dark) are the VS Code ports of the
[nightfox.nvim](https://github.com/EdenEast/nightfox.nvim) palettes, copied
verbatim from [nuromirg/nightfox-vscode](https://github.com/nuromirg/nightfox-vscode)
v1.0.7 (MIT — see `LICENSE`).

They are loaded by `astro.config.mjs` and drive Expressive Code's syntax
colors (ADR 0016). Vendoring is the pattern Expressive Code's own docs
recommend: once copied, the upstream's maintenance status stops mattering.
Only syntax colors come from these files — the card surface around the code is
the site's own tokens, set through `styleOverrides`.
