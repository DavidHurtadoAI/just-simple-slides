# Changelog

## 0.1.8

- Add **Edit source** to jump to the selected slide in the existing native Markdown editor, including pop-out windows, without closing the slide tab or creating duplicate note tabs.
- Switch reading view into editing when needed. If the native note was closed, open a new tab at the selected slide. Preserve pending notes and handle native editor offsets for CRLF files.

## 0.1.7

- Open slides from Markdown in a new Obsidian tab, preserving the original editor, selection, and undo history. Close the slide tab using Obsidian's normal controls.
- Remove the full slide source selector and the Markdown toolbar button. The lower panel now edits only private `[!slide]` callout bodies, with an empty state when none exist.
- Use Obsidian's configured text font and size in the private-area editor.
- Synchronize notes, slide operations, and native Markdown edits across open views, including unsaved changes. Keep saving with the native editor while it is open to prevent stale writes when closing a slide tab.

## 0.1.6

- Declare Obsidian 1.7.2 as the minimum version required by the workspace and keyboard-scope APIs.
- Replace all CSS `!important` declarations with scoped selectors and use a compatible scrollbar style.
- Remove redundant non-null assertions from source offset handling.
- Add the official Obsidian ESLint checks and CSS compatibility checks to every build; fail on warnings.
- Build and attest all three installable assets in GitHub Actions, verify their provenance, and publish only `main.js`, `manifest.json`, and `styles.css`.


## 0.1.5

- Add one lower-editor selector per private `[!slide]` callout, beside **full slide source**.
- Treat optional callout titles as selector names and their bodies as free Markdown. Support multiple, unnamed, repeated-name, and empty areas without imposing metadata fields.
- Edit only the selected area's body; preserve its header, other areas, and visible source. Update selectors live when source changes.
- Keep all private areas hidden in previews, thumbnails, and fullscreen; ordinary callouts remain visible.
- Recommend one Notes area for slide type and presenter notes in the README and starter examples.


## 0.1.4

- Use the monitor-with-play icon consistently in the ribbon, slide tabs, toolbar, commands, and file menu.

## 0.1.3

- Drag thumbnails in the left panel to reorder slides, with an insertion marker and edge scrolling.
- Keep the moved slide selected and save its content and private notes in the new Markdown order.
- Undo/redo each drop as a single operation; dropping outside the rail leaves the file unchanged.

## 0.1.2

- Switch the lower editor between Markdown and Slide details, with optional Type and Presenter notes fields.
- Keep details in the private `[!slide]` callout without changing visible slide content.
- Resize the thumbnail sidebar and lower editor by dragging their dividers or using the keyboard. Double-click to reset; sizes and editor mode are remembered.

## 0.1.1

- Optional `[!slide]` callouts for slide type and presenter notes.
- Slide details stay in Markdown and are excluded from previews, thumbnails, and presentations.
- Small English callouts in new presentations, new slides, and the demo. No additional panels or settings.
- Keep keyboard focus and slide undo/redo scoped to the slide editor.

## 0.1.0

- First local development version.
- Ordinary Markdown slides, thumbnails, selected-slide editor, and document-wide undo.
- Automatic title, subtitle, text/image composition, and content fitting.
- Theme-aware fullscreen presentation with keyboard and pointer navigation.
