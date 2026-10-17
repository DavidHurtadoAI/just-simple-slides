# Changelog

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
