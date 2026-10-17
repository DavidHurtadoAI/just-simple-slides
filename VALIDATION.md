# Local validation — 0.1.6

Checked on 17 October 2026, Windows desktop, in the actual Obsidian application with an isolated vault and application profile.

- `npm run check`: the full official Obsidian ESLint recommended configuration, CSS compatibility checks, 32 unit tests, strict TypeScript, production build, and version/asset packaging passed with zero lint warnings. The sentence-case rule preserves the plugin name as a brand; no rules are disabled.
- `scripts/qa-obsidian.mjs`: 91 integration checks passed against the actual Obsidian application, with no runtime errors. The JSON report and original screenshots are in the ignored `qa/` folder.
- Checked **full slide source** followed by one selector per private callout, source order, optional names, repeated names, unnamed and empty areas, and slides without callouts.
- Checked actual editor input into the second area, byte-for-byte preservation outside that body, arbitrary Markdown without a type form, independent same-name areas, clearing a body without deleting the callout, undo/redo across area selection, and autosave to the real file. Checked CRLF area bodies as separate logical editor lines, editing without changing other bytes or newline style, and returning to full source.
- Checked live selector updates after renaming, adding and removing callouts in source, plus Left/Right, Home and End navigation.
- Checked all private callouts and their names stay out of previews, thumbnails and native fullscreen while ordinary callouts remain visible. Names do not set slide types or layout attributes. Folded/expanded/case-insensitive callouts, private headings, nested callouts, lazy continuation and literal code examples were also checked.
- Unit coverage checks exact header preservation, CRLF, Markdown indentation, nested editing, missing areas, duplicate areas, empty bodies, quoted separators, and final newline handling. Saved layouts migrate the former details mode and validate selected area indices.
- Checked native Markdown → slides → native Markdown without changing the fixture's contents; the native editor cursor selects the matching slide.
- Checked real source input, autosave, external file reload, source-written slide separators, undo/redo across slide navigation, duplicate, move, and delete.
- Checked all six demo slides and a dense stress slide for content bounds, local images, image-only composition, and text/image columns.
- Checked native fullscreen, starting from the selected slide, arrows, Space, Home, End, Esc, and F5. Presentation leaves Markdown unchanged and inherits the theme background.
- Checked pointer drags on both panel dividers, keyboard resizing, double-click reset, saved dimensions/mode, and restoring them after reopening the view.
- Checked native thumbnail drag-and-drop down and back to the start, selection following the moved slide, cleanup of drag feedback, autosave, single-step undo/redo, image/callout preservation, and cancellation outside the rail. Unit tests cover all position pairs, blank slides, frontmatter, separator formatting, and missing final newlines.
- Inspected screenshots in light/dark modes with the vault's Border theme, including the lower editor's Notes and Cues selectors. Checked the editor in a 390px desktop viewport with the native sidebar collapsed and a scrolling selector row.
- Minimum API version is 1.7.2, matching `Workspace.revealLeaf` (since 1.7.2) and `View.scope` (since 1.5.7) in the official Obsidian API declarations. The public 0.1.5 entry in `versions.json` is also corrected so older apps are not directed to an unsupported version.
- CSS uses no `!important` or unsupported Chromium 114 features. The CSS gate was checked against the published 0.1.5 stylesheet: it detects both its scrollbar warning and its `!important` declarations, while accepting the corrected stylesheet.
- `npm audit` reports zero known vulnerabilities, including development dependencies. The development-only Moment dependency from the Obsidian type package is pinned to its compatible fixed version.
- Tagged releases build and attest all three installable files in GitHub Actions, verify provenance before publishing, and then download and verify the published bytes and attestations. Only `main.js`, `manifest.json`, and `styles.css` are attached.

This is desktop validation. A narrow desktop viewport does not establish physical iOS/Android compatibility. Third-party interactive embeds have not been comprehensively tested.

The optional integration script requires Playwright on `NODE_PATH` and an isolated Obsidian instance listening at `http://127.0.0.1:9234`. It refuses a vault whose name/path do not match the test vault under this project. Playwright is a development test tool, not a plugin runtime dependency.
