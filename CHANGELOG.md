# Changelog

## 0.2.8

- Use Obsidian's own Pele runtime when available, without installing or bundling Pele or increasing the minimum Obsidian version (1.7.2). Fall back to native Markdown rendering when the optional host engine is unavailable. Extract genuine Mermaid fences before rendering with Pele, preserving literal examples, nested fences, comments, private notes, line endings and diagram-internal frontmatter.
- Compose diagrams as visual resources alongside text and existing images. Use the same logical geometry in editor, thumbnails, sorter, player and floating windows, retaining authored direction and matching measured/displayed fonts.
- Follow theme colors with readable chart series, show diagram errors as text without stale SVGs, isolate SVG IDs, and refresh hidden/font-changing surfaces with complete observer cleanup. Keep diagram zoom and network resources disabled.

## 0.2.7

- Prevent a late save from writing the empty buffer of a cleared or closing slide view. Only fully loaded views can save or own document synchronization; native editor unload events no longer propagate their cleared content.
- Wait for in-flight slide saves before flushing the final edits on close. Clear a closing view only after saving succeeds, and never clear a different file loaded during an earlier save.
- Reuse the existing slide tab for the same Markdown file, including restored tabs and tabs in other windows. Serialize repeated invocations so they cannot create duplicates while a tab loads.
- Reduce slide sorter gaps from 22px to 14px on desktop and from 16px to 12px in narrow windows, with matching drag insertion markers.

## 0.2.6

- Add a subtle **2px progress bar** at the bottom of presentation mode. The current slide's position fills the bar smoothly, reaching 100% on the last slide and moving back when navigating to earlier slides. It uses the theme accent at low opacity, stays visible while controls fade, and respects system reduced motion.
- Expose slide progress to screen readers without adding a focus stop or blocking presentation controls. No new settings or changes to the Markdown.

## 0.2.5

- Use a **0.70-second Fade** when changing slides in presentation mode. The incoming slide dissolves over the previous one with the current Obsidian theme. Fade is the only transition and has no settings; the first slide appears immediately and reduced motion follows the system preference.
- Keep navigation responsive during an unfinished fade, discard superseded renders, and clean up outgoing slide components and animations on completion or exit. Both slides stay fitted during fullscreen/window resizing; outgoing links are excluded from interaction and keyboard focus. Editor and sorter previews keep their immediate updates.

## 0.2.4

- Navigate the normal slide editor with **Right/Down** for the next slide and **Left/Up** for the previous slide. Opening the slide view and returning from the sorter focus the preview, ready for arrow navigation. Clicking the preview restores that focus after editing notes.
- Preserve normal arrow-key behavior in private notes, text fields, area selectors, and resizable dividers. Modified shortcuts, thumbnail reordering, grid navigation, and presentation controls keep their existing behavior. Navigation stops at the first/last slide without changing the Markdown.

## 0.2.3

- Fix thumbnails briefly appearing cropped or too small when switching between the slide editor and **Slide sorter**. Reused previews now receive their new scale during the layout change, including while changing thumbnail size or resizing the sidebar.
- Resize the fixed slide canvas without recalculating its text layout. Content, font, and image changes still trigger full fitting; repeated pending requests share one animation frame. Floating views reconnect their resize observers to the window that owns them.

## 0.2.2

- Add **Create slide notes** to the lower panel when the selected slide has no private `[!slide]` areas. The button appends an empty `> [!slide] Slide notes` callout at the end of that slide, with a blank line before the following `---`, and focuses the notes editor so you can start writing immediately.
- Keep existing slide content and other slides unchanged. Creation syncs to the native Markdown editor and other slide tabs, saves normally, and can be undone/redone as one operation. Existing private areas keep their usual selectors; the button does not add duplicates.

## 0.2.1

- Add a **Normalize headings** toolbar button in the editor and slide sorter. This is a **file-wide edit**: applying it rewrites slide heading levels throughout the current Markdown file and saves the original note. Choose a presentation title, initially the file name, to create one independent H1 above the slides. Every slide title becomes H2 and its subtitle H3; later body headings stay below them.
- Preserve slide count, private areas, images, frontmatter, code examples, and selection. The separate presentation title is kept outside previews and the player and survives slide operations. Existing unmarked cover slides keep their meaning.
- Undo/redo normalization as one change. Repeating it makes no changes, and editing the presentation title updates the existing H1 instead of adding another.
- Prevent an older autosave from resetting newer edits or undo in other open slide tabs. Continue accepting genuine external file updates, including when only slide tabs are open.

## 0.2.0

- Add **Slide sorter**, a full-pane grid of slide previews for arranging the whole presentation. Drag cards between rows; an insertion marker shows the destination, and the grid scrolls near its edges. Each move keeps the complete Markdown slide and private areas together and is one undo step.
- Adjust thumbnail size with the **Slide size** slider. The grid follows the available pane width and your Obsidian theme; nearby previews render lazily for large decks.
- Click to select; double-click, press Enter or Escape, or click **Slide editor** to return to editing. Keep the same selection, private notes, panel sizes, and undo history when switching views, including in floating windows.
- Navigate with arrows and Home/End. Hold Ctrl/Cmd with those keys to reorder without dragging. Existing add, duplicate, delete, source navigation, and presentation controls also work from the sorter.

## 0.1.10

- Fix private notes becoming blank or unresponsive after moving the slide view into a floating Obsidian window. Reconnect the notes editor to its new document while preserving unsaved content, selection, and undo history.
- Schedule slide fitting in the destination window after a move, keeping floating previews responsive when resized.

## 0.1.9

- Wait for a restored Markdown tab to finish loading before **Edit source** moves the cursor. This keeps Obsidian's saved cursor from overriding the selected slide after restarting the app.

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
