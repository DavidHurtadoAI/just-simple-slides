type FileIdentity = { dev: number; ino: number };
type PdfHandle = {
  writeFile(data: Uint8Array): Promise<void>;
  stat(): Promise<FileIdentity>;
  close(): Promise<void>;
};
type PdfFiles = {
  open(path: string, flags: 'wx'): Promise<PdfHandle>;
  stat(path: string): Promise<FileIdentity>;
  unlink(path: string): Promise<void>;
};
type PdfPrinter = {
  printToPDF(options: { printBackground: boolean; preferCSSPageSize: boolean }): Promise<Uint8Array>;
};

export function pdfRuntime(win: Window): { printer: PdfPrinter; files: PdfFiles } | null {
  const host = win as Window & { require?: (id: string) => unknown };
  if (!host.require) return null;
  const electron = host.require('electron') as { remote?: { getCurrentWebContents?: () => PdfPrinter } };
  const printer = electron.remote?.getCurrentWebContents?.();
  if (typeof printer?.printToPDF !== 'function') return null;
  const { promises: files } = host.require('node:fs') as { promises?: PdfFiles };
  return files ? { printer, files } : null;
}

function pdfPath(sourcePath: string, index: number): string {
  const stem = sourcePath.replace(/\.md$/i, '');
  return index === 0 ? stem + '.pdf' : stem + ' ' + index + '.pdf';
}

/** Reserve and write through the same handle. Vault.createBinary checks the path
 * before writing, so an external creation between those operations could be lost. */
export async function saveUniquePdf(
  sourcePath: string, data: Uint8Array, fullPath: (path: string) => string, files: PdfFiles, signal: AbortSignal,
): Promise<string> {
  for (let index = 0; ; index++) {
    signal.throwIfAborted();
    const destination = pdfPath(sourcePath, index);
    const absolute = fullPath(destination);
    let file: PdfHandle;
    try {
      file = await files.open(absolute, 'wx');
    } catch (error) {
      if (typeof error === 'object' && error && 'code' in error && error.code === 'EEXIST') continue;
      throw error;
    }
    try {
      signal.throwIfAborted();
      await file.writeFile(data);
    } catch (error) {
      // Clean up our own partial file. A different file may now exist at this path.
      const [created, current] = await Promise.all([file.stat(), files.stat(absolute)]).catch(() => []);
      if (created && current && created.dev === current.dev && created.ino === current.ino) {
        await files.unlink(absolute).catch(() => {});
      }
      throw error;
    } finally {
      await file.close();
    }
    return destination;
  }
}

/** Resolve after the deck is printable, or fail without writing a partial export. */
export async function waitForDeckMedia(
  deckEl: HTMLElement, surfaces: { fit: () => void }[], win: Window, signal: AbortSignal, timeoutMs = 8000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let ready = false;
  for (;;) {
    signal.throwIfAborted();
    const images = [...deckEl.querySelectorAll('img')];
    for (const image of images) {
      if (image.loading === 'lazy') image.loading = 'eager';
      if (image.complete && (image.currentSrc || image.src) && !image.naturalWidth) {
        throw new Error('An image could not be loaded.');
      }
    }
    if (deckEl.querySelector('.jss-diagram-error, .internal-embed:is(.is-unresolved, .mod-empty-attachment)')) {
      throw new Error('A diagram or embed could not be rendered.');
    }
    const settled = deckEl.ownerDocument.fonts.status !== 'loading'
      && images.every(image => image.complete && image.naturalWidth > 0)
      && [...deckEl.querySelectorAll('.jss-diagram')].every(diagram => diagram.querySelector('svg'))
      && [...deckEl.querySelectorAll('.internal-embed')].every(embed =>
        embed.classList.contains('is-loaded') || embed.querySelector('img, svg, canvas, .markdown-rendered'));
    if (settled && ready) {
      for (const surface of surfaces) surface.fit();
      if (deckEl.querySelector('.jss-diagram-error')) throw new Error('A diagram could not be rendered.');
      return;
    }
    ready = settled;
    if (Date.now() >= deadline) throw new Error('Timed out waiting for slide media and fonts.');
    await new Promise<void>(resolve => win.setTimeout(resolve, 40));
  }
}
