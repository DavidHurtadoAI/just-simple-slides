import { Modal, Setting, type App, type ButtonComponent, type TextComponent } from 'obsidian';

export class HeadingModal extends Modal {
  private previousFocus: HTMLElement | null;
  constructor(app: App, private ownerDocument: Document, private title: string, private apply: (title: string) => void) {
    super(app);
    this.previousFocus = ownerDocument.activeElement as HTMLElement | null;
  }

  onOpen(): void {
    // Plugin code may run in the main window after its view has been adopted by
    // a pop-out. Keep the native modal in the document that owns the button.
    if (this.containerEl.ownerDocument !== this.ownerDocument) this.ownerDocument.body.append(this.containerEl);
    this.setTitle('Normalize headings');
    this.contentEl.createEl('p', { text: 'Add a separate presentation title and normalize slide titles and subtitles. Private notes stay unchanged.' });
    let input: TextComponent | undefined;
    let button: ButtonComponent | undefined;
    const submit = () => {
      if (!this.title.trim()) return;
      this.close();
      this.apply(this.title.trim());
    };
    new Setting(this.contentEl).setName('Presentation title').addText(text => {
      input = text;
      text.setValue(this.title).setPlaceholder('Presentation title').onChange(value => {
        this.title = value;
        button?.setDisabled(!value.trim());
      });
      text.inputEl.setAttribute('aria-label', 'Presentation title');
      text.inputEl.addEventListener('keydown', event => {
        if (event.key === 'Enter') { event.preventDefault(); submit(); }
      });
    });
    new Setting(this.contentEl)
      .addButton(cancel => cancel.setButtonText('Cancel').onClick(() => this.close()))
      .addButton(apply => {
        button = apply;
        apply.setButtonText('Normalize headings').setCta().setDisabled(!this.title.trim()).onClick(submit);
      });
    input?.inputEl.focus();
    input?.inputEl.select();
  }

  close(): void {
    super.close();
    if (this.previousFocus?.isConnected) this.previousFocus.focus({ preventScroll: true });
  }

  onClose(): void { this.contentEl.empty(); }
}
