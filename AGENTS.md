# AGENTS.md

## Rules

- `old-salad-archive/` is reference-only.
- If any code, asset, config, or static file from `old-salad-archive/` is needed, copy it into the new project location first.
- Do not create runtime references to files inside `old-salad-archive/`.
- Do not import, fetch, link, or point manifest entries at `old-salad-archive/`.
- New extension code must remain runnable even if `old-salad-archive/` is deleted completely.
- When reusing logic from the archived project, adapt it into the new project structure instead of depending on the archive in place.
