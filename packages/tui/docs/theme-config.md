# Theme Configuration Guide

The color scheme of the Rig TUI is defined by **named themes**, with each theme providing both dark and light palettes. Dark or light terminal backgrounds are automatically detected from terminal evidence by default. The `/theme` command allows users to switch themes, lock appearance, and write custom theme files.

## TL;DR

Enter `/theme` to open the theme picker panel:

- `↑` / `↓` moves the cursor with **live preview** of the selected theme; `Enter` saves and activates immediately, `Esc` / `Ctrl+C` cancels and restores the original theme.
- `a` cycles between "auto / light / dark". Auto mode follows terminal detection; locking prevents overriding by terminal evidence.
- The right side of each line shows a color preview strip; the bottom of the panel displays current appearance, source, and description.
- Theme selection is written to `tui/tui-settings.json` in the runtime data directory; on write failure the panel stays open with an error notice.
- `/theme` is a `search-only` command: type `/theme` directly or find it in command search, though it does not appear in the default slash list.

## Built-in Themes

| Theme ID | Name | Description |
| --- | --- | --- |
| `rig` | Rig | Default theme. Rig blue + Catppuccin syntax highlighting |
| `midnight` | Midnight | Deep blue-black background with higher foreground contrast |
| `graphite` | Graphite | Neutral low-chroma surface for quieter long output |
| `aurora` | Aurora | Cyan-tinted secondary tones |

Each theme defines complete dark and light versions, preventing missing or mismatched colors when switching terminal modes.

Built-in themes meet the [WCAG AA contrast](./tui-foundation.md) baseline (normal text 4.5:1, non-text 3:1), regression-tested by `packages/tui/test/unit/tui/theme/palettes.test.ts`.

## Configuration Storage

- File: `~/.rig/tui/tui-settings.json` (inside the runtime data directory).
- Key: `theme`, value is the theme ID, or `themeId/light`, `themeId/dark` to lock appearance.

```json
{
  "tuiMode": "regular",
  "theme": "midnight"
}
```

`theme` and `tuiMode` are stored in the same file without overwriting each other. Unrecognized theme values fall back to the default theme without blocking startup.

## Custom Theme Files

Rig reads user themes from `tui/themes/*.json` under the runtime data directory.

- Each file provides one appearance: `aurora.json` provides dark, `aurora-light.json` provides light; sharing the same `name` groups them into a selectable theme.
- Missing appearances fall back to the default theme's matching palette.
- Files can be any `.json` file; theme ID is taken from `name` inside the file.
- **Hot reload**: changes to active custom theme files take effect immediately on save.

### File Format

```json
{
  "name": "my-theme",
  "label": "My Theme",
  "description": "A custom Rig palette",
  "appearance": "dark",
  "vars": {
    "brand": "#68c0ff",
    "gray": "#949494"
  },
  "colors": {
    "brand": "brand",
    "signal": "brand",
    "accent": "brand",
    "text": "#d6d6d6",
    "muted": "gray",
    "line": "gray"
  },
  "syntax": {
    "text": "#cdd6f4",
    "mauve": "#cba6f7",
    "overlay2": "#9399b2"
  }
}
```

| Field | Required | Description |
| --- | --- | --- |
| `name` | Yes | Theme ID, `[a-z0-9][a-z0-9._-]{0,63}` |
| `appearance` | Yes | `dark` or `light` |
| `label` / `description` | No | Name and description shown in the picker |
| `vars` | No | Reusable color aliases |
| `colors` | Yes | UI colors object; fields can be partially overridden |
| `syntax` | No | Syntax highlighting palette; omitted tones fall back to default |

Values in `colors` and `syntax` can be:
- **hex literals**: `"#68c0ff"` or 3-digit shorthand `"#6cf"`.
- **`vars` reference**: name of an alias defined in `vars`.
- **Empty string** `""`: use terminal default color.

`vars` values must be hex literals or empty strings (nested references are not supported).

Partial `colors` overrides inherit remaining fields from the default theme.

### Available Fields

`colors` supports 21 keys:
`brand`, `wordmarkHighlight`, `wordmarkShadow`, `signal`, `orbit`, `accent`, `markdownHeading`, `markdownCode`, `markdownLink`, `userMessageBg`, `diffAddedBg`, `diffRemovedBg`, `text`, `muted`, `dim`, `border`, `line`, `success`, `warning`, `error`.

`syntax` supports 13 tones:
`blue`, `flamingo`, `green`, `mauve`, `overlay2`, `peach`, `pink`, `red`, `sapphire`, `subtext0`, `teal`, `text`, `yellow`.

## Related Files

| Path | Responsibility |
| --- | --- |
| `src/tui/theme/contracts.ts` | Theme, palette, and syntax types |
| `src/tui/theme/palettes.ts` | Built-in theme definitions |
| `src/tui/theme/custom-themes.ts` | Discovery, validation, loading, and reload |
| `src/tui/theme/registry.ts` | Theme merging and fallbacks |
| `src/tui/theme/controller.ts` | Selection, appearance locking, background detection |
| `src/tui/theme/runtime.ts` | Dynamic bindings for colors |
| `src/tui/features/settings/theme-picker.ts` | `/theme` picker UI |
| `src/host/tui-settings.ts` | `tui-settings.json` reading and writing |
