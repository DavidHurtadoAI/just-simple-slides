import { type App } from 'obsidian';
import { ExportConflictModal, type ExportConflictChoice } from './export-modal';

/** Convert markdown vault path to default PDF counterpart. */
export function defaultPdfPath(markdownPath: string): string {
  return markdownPath.replace(/\.md$/i, '') + '.pdf';
}

/** Generate a copy path by appending an incremental index. */
export function copyPdfPath(filePath: string, index: number): string {
  const base = filePath.replace(/\.pdf$/i, '');
  return `${base} ${index}.pdf`;
}

/** Determine the next available non-colliding copy destination. */
export async function nextAvailablePdfPath(
  filePath: string,
  exists: (path: string) => Promise<boolean>,
): Promise<string> {
  let index = 1;
  while (await exists(copyPdfPath(filePath, index))) {
    index++;
  }
  return copyPdfPath(filePath, index);
}

/** Prompt the user with the conflict modal and resolve with their decision. */
export function promptExportConflict(
  app: App,
  ownerDocument: Document,
  existingPath: string,
  copyPath: string,
): Promise<ExportConflictChoice> {
  return new Promise(resolve => {
    new ExportConflictModal(app, ownerDocument, existingPath, copyPath, resolve).open();
  });
}

/** Await loaded fonts, decoded images, and rendered diagrams before print rasterization. */
export async function waitForDeckMedia(
  deckEl: HTMLElement,
  surfaces: { fit: () => void }[],
  win: Window,
  timeoutMs = 3000,
): Promise<void> {
  const doc = deckEl.ownerDocument;
  if (doc?.fonts && 'ready' in doc.fonts) {
    try {
      await doc.fonts.ready;
    } catch {
      // Font load failures should not block export.
    }
  }

  const start = Date.now();
  const setTimeoutFn = win?.setTimeout?.bind(win) ?? setTimeout;

  while (Date.now() - start < timeoutMs) {
    const images = Array.from(deckEl.querySelectorAll<HTMLImageElement>('img'));
    const pendingImages = images.filter(img => !img.complete);

    const diagrams = Array.from(deckEl.querySelectorAll<HTMLElement>('.jss-diagram'));
    const pendingDiagrams = diagrams.filter(el => !el.querySelector('svg') && !el.classList.contains('jss-diagram-error'));

    const embeds = Array.from(deckEl.querySelectorAll<HTMLElement>('.internal-embed'));
    const pendingEmbeds = embeds.filter(el => !el.classList.contains('is-loaded') && !el.querySelector('img, svg, canvas, .markdown-rendered'));

    if (!pendingImages.length && !pendingDiagrams.length && !pendingEmbeds.length) break;

    if (pendingImages.length) {
      await Promise.race([
        Promise.all(pendingImages.map(img => img.decode?.().catch(() => {}))),
        new Promise(resolve => setTimeoutFn(resolve, 40)),
      ]);
    } else {
      await new Promise(resolve => setTimeoutFn(resolve, 40));
    }
  }

  // Refit surfaces once media and font dimensions are settled.
  for (const surface of surfaces) {
    surface.fit();
  }
}
