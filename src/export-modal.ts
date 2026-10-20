import { Modal, Setting, type App } from 'obsidian';

export type ExportConflictChoice = { action: 'overwrite' } | { action: 'copy'; path: string } | { action: 'cancel' };

/** Present an explicit overwrite choice when the target PDF already exists. */
export class ExportConflictModal extends Modal {
  private resolved = false;
  private previousFocus: HTMLElement | null;

  constructor(
    app: App,
    private ownerDocument: Document,
    private existingPath: string,
    private copyPath: string,
    private onChoice: (choice: ExportConflictChoice) => void,
  ) {
    super(app);
    this.previousFocus = ownerDocument.activeElement as HTMLElement | null;
  }

  onOpen(): void {
    if (this.containerEl.ownerDocument !== this.ownerDocument) {
      this.ownerDocument.body.append(this.containerEl);
    }
    this.setTitle('Export slides to PDF');
    const existingFilename = this.existingPath.split('/').pop() ?? this.existingPath;
    const copyFilename = this.copyPath.split('/').pop() ?? this.copyPath;

    this.contentEl.createEl('p', {
      text: `"${existingFilename}" already exists. Do you want to overwrite it or save as a copy?`,
    });

    new Setting(this.contentEl)
      .addButton(cancel => {
        cancel.setButtonText('Cancel').onClick(() => this.choose({ action: 'cancel' }));
      })
      .addButton(copy => {
        copy
          .setButtonText(`Save copy (${copyFilename})`)
          .setCta()
          .onClick(() => this.choose({ action: 'copy', path: this.copyPath }));
      })
      .addButton(overwrite => {
        overwrite
          .setButtonText('Overwrite');
        overwrite.buttonEl.addClass('mod-warning');
        overwrite.onClick(() => this.choose({ action: 'overwrite' }));
      });
  }

  private choose(choice: ExportConflictChoice): void {
    if (this.resolved) return;
    this.resolved = true;
    this.close();
    this.onChoice(choice);
  }

  close(): void {
    super.close();
    if (this.previousFocus?.isConnected) {
      this.previousFocus.focus({ preventScroll: true });
    }
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.resolved) {
      this.resolved = true;
      this.onChoice({ action: 'cancel' });
    }
  }
}
