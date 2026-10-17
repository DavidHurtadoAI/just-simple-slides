// Optional live QA. Only connect to this project's isolated Obsidian vault/profile.
import {createRequire} from 'node:module';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
const {chromium}=createRequire(import.meta.url)('playwright');
const browser=await chromium.connectOverCDP(process.env.OBSIDIAN_CDP??'http://127.0.0.1:9234');
const page=browser.contexts()[0].pages().find(page=>page.url().includes('index.html'));
if(!page)throw Error('No Obsidian test window');
const errors=[];page.on('pageerror',e=>errors.push(e.message));
page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
await mkdir('qa',{recursive:true});
const note='Just Simple Slides - Demo.md';
const original=await readFile(`demo/${note}`,'utf8');
const results=[];
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const check=(name,result=true)=>{assert.ok(result,name);results.push(name);console.log('PASS '+name);};
const click=label=>page.getByRole('button',{name:label,exact:true}).click();
const tabs=()=>page.getByRole('tablist',{name:'Slide editor areas'}).getByRole('tab');
const area=()=>page.locator('.jss-editor .cm-content');
const state=()=>page.evaluate(()=>{
  const view=jssSlidesTestLeaf.view;
  return {data:view.getViewData(),native:jssNativeTestLeaf.view.editor?.getValue(),index:view.index,count:view.deck.slides.length,editor:view.editor.state.sliceDoc(),areaIndex:view.areaIndex,slides:view.deck.slides.map(s=>({markdown:s.markdown,areas:s.areas}))};
});
const native=async()=>{
  await page.evaluate(async()=>{await app.workspace.revealLeaf(jssNativeTestLeaf);app.workspace.setActiveLeaf(jssNativeTestLeaf,{focus:true});jssNativeTestLeaf.view.editor.focus();});
  await page.waitForFunction(()=>app.workspace.activeLeaf===jssNativeTestLeaf);await pause(50);
};
const slides=async()=>{
  await page.evaluate(async()=>{await app.workspace.revealLeaf(jssSlidesTestLeaf);app.workspace.setActiveLeaf(jssSlidesTestLeaf,{focus:true});});
  await page.waitForFunction(()=>app.workspace.activeLeaf===jssSlidesTestLeaf);await pause(50);
};
const setSource=async source=>{
  await page.evaluate(async source=>{jssNativeTestLeaf.view.editor.setValue(source);await jssNativeTestLeaf.view.save();},source);
  await pause(350);
  await page.evaluate(()=>jssSlidesTestLeaf.view.select(0));
};
try {
  const trust=page.getByRole('button',{name:'Confiar en el autor y activar complementos',exact:true});if(await trust.count())await trust.click();
  await page.evaluate(async({note,original})=>{
    const path=app.vault.adapter.basePath.split(String.fromCharCode(92)).join('/');
    if(path!=='C:/Users/dhtor/OneDrive/@Obsidian-dev/Development/just-simple-slides/qa/vault')throw Error('Refusing non-test vault');
    await new Promise(resolve=>app.workspace.onLayoutReady(resolve));
    for(const type of ['just-simple-slides','markdown'])for(const leaf of app.workspace.getLeavesOfType(type)){
      if(type==='just-simple-slides'||leaf.view.file?.path===note){if(leaf.view.file)await leaf.view.save();await leaf.setViewState({type:'empty',state:{}});}
    }
    await app.plugins.loadManifests();
    if(app.plugins.plugins['just-simple-slides'])await app.plugins.disablePlugin('just-simple-slides');
    await app.plugins.enablePlugin('just-simple-slides');
    const plugin=app.plugins.plugins['just-simple-slides'];if(!plugin)throw Error('Plugin did not load');
    plugin.updateLayout({sidebarWidth:208,sourceRatio:0.3,areaIndex:0});
    const file=app.vault.getAbstractFileByPath(note);await app.vault.modify(file,original);
    globalThis.jssNativeTestLeaf=app.workspace.getLeaf('tab');
    await jssNativeTestLeaf.setViewState({type:'markdown',state:{file:note,mode:'source'},active:true});
    await app.workspace.revealLeaf(jssNativeTestLeaf);
    jssNativeTestLeaf.view.editor.setCursor(jssNativeTestLeaf.view.editor.offsetToPos(original.indexOf('# Just Simple Slides')));
    globalThis.jssNativeCursor=jssNativeTestLeaf.view.editor.getCursor();
    await plugin.open(file);globalThis.jssSlidesTestLeaf=app.workspace.activeLeaf;
    for(const leaf of app.workspace.getLeavesOfType('empty'))leaf.detach();
    app.workspace.leftSplit.collapse();app.workspace.rightSplit.collapse();
    document.body.classList.remove('theme-dark');document.body.classList.add('theme-light');app.workspace.trigger('css-change');
  },{note,original});
  await page.waitForSelector('.workspace-leaf.mod-active .jss-stage .jss-slide:not(.jss-preparing)');await pause(350);
  check('slides open in a new tab while the exact native editor stays open',await page.evaluate(()=>jssSlidesTestLeaf!==jssNativeTestLeaf&&app.workspace.getLeavesOfType('markdown').includes(jssNativeTestLeaf)&&jssNativeTestLeaf.view.getViewType()==='markdown'));
  check('opening slides preserves the native selection',await page.evaluate(()=>JSON.stringify(jssNativeTestLeaf.view.editor.getCursor())===JSON.stringify(jssNativeCursor)));
  check('six slides and source bytes survive opening', (await state()).count===6&&(await state()).data===original&&(await state()).native===original);
  check('the lower editor starts with the first callout body', (await state()).editor==='Type: title\n\nOpen with one idea: Markdown stays the source.');
  check('full slide source is absent and the toolbar has no Markdown button',await page.getByRole('tab',{name:'full slide source',exact:true}).count()===0&&await page.getByRole('button',{name:'Open Markdown',exact:true}).count()===0);
  check('one area selector appears for the first slide',JSON.stringify(await tabs().allTextContents())===JSON.stringify(['Notes']));
  check('private content stays out of the preview and thumbnails',!(await page.locator('.jss-stage').innerText()).includes('Markdown stays the source')&&!(await page.locator('.jss-thumb-frame').allInnerTexts()).some(t=>t.includes('Markdown stays the source')));
  check('title and subtitle are inferred from headings',await page.locator('.jss-stage .jss-title').innerText()==='Just Simple Slides'&&await page.locator('.jss-stage .jss-subtitle').innerText()==='Your Markdown. Your theme. Your presentation.');

  await native();
  await page.evaluate(async()=>{await app.plugins.plugins['just-simple-slides'].open(jssNativeTestLeaf.view.file);globalThis.jssSecondSlidesLeaf=app.workspace.activeLeaf;});
  check('opening the same Markdown again creates another slide tab',await page.evaluate(()=>jssSecondSlidesLeaf!==jssSlidesTestLeaf&&jssSecondSlidesLeaf!==jssNativeTestLeaf&&app.workspace.getLeavesOfType('just-simple-slides').length===2));
  await page.keyboard.press('Control+End');await page.keyboard.insertText(' SECOND_TAB_PRIVATE');
  check('two slide tabs and the native editor share unsaved area edits',await page.evaluate(()=>jssSlidesTestLeaf.view.getViewData().includes('SECOND_TAB_PRIVATE')&&jssSlidesTestLeaf.view.getViewData()===jssSecondSlidesLeaf.view.getViewData()&&jssNativeTestLeaf.view.editor.getValue()===jssSecondSlidesLeaf.view.getViewData()));
  await pause(100);
  await page.keyboard.press('Control+w');await pause(200);
  check('native close-tab closes only the new slide tab',await page.evaluate(()=>!app.workspace.getLeavesOfType('just-simple-slides').includes(jssSecondSlidesLeaf)&&app.workspace.getLeavesOfType('markdown').includes(jssNativeTestLeaf)));
  await native();await page.keyboard.press('Control+z');await pause(250);
  check('native undo history survives opening and closing slide tabs',(await state()).data===original&&(await state()).native===original);
  await pause(2400);
  check('closing a tab with pending edits cannot overwrite a later native undo',await readFile(`qa/vault/${note}`,'utf8')===original);
  check('ordinary cross-tab edits produce no file-merge notices',!(await page.locator('.notice').allTextContents()).some(text=>text.includes(note)));
  await slides();

  const typography=await page.evaluate(()=>{
    const doc=document.body;const font=doc.style.getPropertyValue('--font-text');const size=doc.style.getPropertyValue('--font-text-size');
    const read=()=>{const n=getComputedStyle(jssNativeTestLeaf.view.contentEl.querySelector('.cm-content'));const a=getComputedStyle(jssSlidesTestLeaf.view.editor.contentDOM);return {nativeFont:n.fontFamily,areaFont:a.fontFamily,nativeSize:n.fontSize,areaSize:a.fontSize};};
    const normal=read();doc.style.setProperty('--font-text','Georgia, serif');doc.style.setProperty('--font-text-size','23px');app.workspace.trigger('css-change');const custom=read();
    font?doc.style.setProperty('--font-text',font):doc.style.removeProperty('--font-text');size?doc.style.setProperty('--font-text-size',size):doc.style.removeProperty('--font-text-size');app.workspace.trigger('css-change');
    return {normal,custom};
  });
  check('area content uses the native text font and size',typography.normal.areaFont===typography.normal.nativeFont&&typography.normal.areaSize===typography.normal.nativeSize);
  check('changing Obsidian text settings updates the actual area content',typography.custom.areaFont===typography.custom.nativeFont&&typography.custom.areaSize==='23px'&&typography.custom.nativeSize==='23px');

  const dragBefore=await state();const thumbs=page.locator('.jss-thumbnail');const third=await thumbs.nth(2).boundingBox();
  await thumbs.nth(0).dragTo(thumbs.nth(2),{targetPosition:{x:third.width/2,y:third.height-10}});await pause(250);
  const dragAfter=await state();const expected=[...dragBefore.slides];expected.splice(2,0,expected.splice(0,1)[0]);
  check('drag and drop reorders slides with their private areas',JSON.stringify(dragAfter.slides)===JSON.stringify(expected));
  check('the moved slide stays selected and native Markdown updates immediately',dragAfter.index===2&&dragAfter.native===dragAfter.data);
  check('drag feedback clears after dropping',await page.locator('.jss-dragging,.jss-drop-before,.jss-drop-after').count()===0);
  await page.keyboard.press('Control+z');check('drag and drop is one undo step',(await state()).data===dragBefore.data&&(await state()).native===dragBefore.data);
  await page.keyboard.press('Control+Shift+z');check('drag and drop can be redone',(await state()).data===dragAfter.data);
  const cancelled=(await state()).data;await thumbs.nth(2).dragTo(page.locator('.jss-editor'),{targetPosition:{x:60,y:20}});await pause(200);
  check('dropping outside the thumbnail rail leaves both editors unchanged',(await state()).data===cancelled&&(await state()).native===cancelled);
  await setSource(original);await slides();await thumbs.nth(1).click();await pause(250);
  check('mixed text and image still share two columns',await page.locator('.jss-stage .jss-slide').getAttribute('data-layout')==='split');
  check('local images resolve',await page.locator('.jss-stage img').evaluate(i=>i.complete&&i.naturalWidth>0));

  const multi='# Visible title\n\n> [!slide] Alpha PRIVATE_NAME\n> First private.\n\n> [!slide] Beta PRIVATE_NAME\n> Type: free\n>\n> Second private.\n\n> [!slide]\n\n> [!slide] Alpha PRIVATE_NAME\n> Fourth private.\n\n> [!tip] Visible tip\n> Ordinary content.\n';
  await setSource(multi);
  check('only callout selectors appear, including empty and repeated names',JSON.stringify(await tabs().allTextContents())===JSON.stringify(['Alpha PRIVATE_NAME','Beta PRIVATE_NAME','Area 3','Alpha PRIVATE_NAME']));
  await page.getByRole('tab',{name:'Beta PRIVATE_NAME',exact:true}).click();
  check('selecting an area leaves both documents unchanged',(await state()).data===multi&&(await state()).native===multi&&(await state()).editor==='Type: free\n\nSecond private.');
  await area().click();await page.keyboard.press('Control+End');await page.keyboard.insertText('\n\nPRIVATE_ADDED');await pause(250);
  const edited=await state();const expectedEdit=multi.replace('> Second private.','> Second private.\n>\n> PRIVATE_ADDED');
  check('area typing changes only the selected callout body',edited.data===expectedEdit);
  check('area typing appears in the original native Markdown editor',edited.native===expectedEdit);
  check('all private names and content remain hidden while normal callouts stay visible',!(await page.locator('.jss-stage').innerText()).includes('PRIVATE_')&&await page.locator('.jss-stage .callout[data-callout="tip"]').count()===1);
  await page.getByRole('tab',{name:'Alpha PRIVATE_NAME',exact:true}).nth(1).click();check('repeated names select independent areas',(await state()).editor==='Fourth private.');
  await page.keyboard.press('Control+z');check('undo restores the correct area after switching selectors',(await state()).data===multi&&(await state()).areaIndex===1&&(await state()).native===multi);
  await page.keyboard.press('Control+Shift+z');check('redo preserves content in both editors',(await state()).data===expectedEdit&&(await state()).native===expectedEdit);
  await page.getByRole('tab',{name:'Area 3',exact:true}).click();await area().click();await page.keyboard.insertText('Temporary');await page.keyboard.press('Control+a');await page.keyboard.press('Backspace');await pause(200);
  check('clearing an area retains its empty callout and selector',(await state()).slides[0].areas.length===4&&(await state()).editor==='');

  await native();await page.evaluate(()=>{const e=jssNativeTestLeaf.view.editor;const start=e.getValue().indexOf('Beta PRIVATE_NAME');e.setSelection(e.offsetToPos(start),e.offsetToPos(start+'Beta PRIVATE_NAME'.length));});
  await page.keyboard.insertText('Renamed PRIVATE_NAME');await pause(250);await slides();
  check('native Markdown rename updates the area selectors',await page.getByRole('tab',{name:'Renamed PRIVATE_NAME',exact:true}).count()===1&&await page.getByRole('tab',{name:'Beta PRIVATE_NAME',exact:true}).count()===0);
  await native();await page.keyboard.press('Control+End');await page.keyboard.insertText('\n\n> [!slide] Extra\n> Anything goes.');await pause(250);await slides();
  check('adding a callout in native Markdown creates its selector',await tabs().count()===5&&await page.getByRole('tab',{name:'Extra',exact:true}).count()===1);
  await native();await page.keyboard.press('Control+z');await pause(250);await slides();
  await page.waitForFunction(()=>jssSlidesTestLeaf.view.deck.slides[0].areas.length===4&&jssSlidesTestLeaf.view.contentEl.querySelectorAll('[role="tab"]').length===4);
  check('native undo removes the added selector',await tabs().count()===4&&await page.getByRole('tab',{name:'Extra',exact:true}).count()===0);
  await tabs().first().focus();await page.keyboard.press('End');check('End selects the last private area',(await state()).editor==='Fourth private.');await page.keyboard.press('Home');check('Home selects the first private area',(await state()).editor==='First private.');await page.keyboard.press('ArrowRight');check('arrow navigation moves through callout selectors',(await state()).areaIndex===1);
  await page.keyboard.press('Control+End');

  await setSource(multi);await slides();await page.getByRole('tab',{name:'Beta PRIVATE_NAME',exact:true}).click();
  await native();await page.evaluate(()=>{const e=jssNativeTestLeaf.view.editor;const start=e.getValue().indexOf('Visible title');e.setSelection(e.offsetToPos(start),e.offsetToPos(start+'Visible title'.length));});
  await page.keyboard.insertText('UNSAVED_NATIVE_TITLE');
  await slides();await area().click();await page.keyboard.press('Control+End');await page.keyboard.insertText(' QUICK_PRIVATE_EDIT');
  const rapid=await state();
  check('rapid native-to-area editing preserves unsaved native content',rapid.data.includes('# UNSAVED_NATIVE_TITLE')&&rapid.data.includes('Second private. QUICK_PRIVATE_EDIT')&&rapid.native===rapid.data);
  await pause(2400);check('autosave writes the combined native and private edits',(await readFile(`qa/vault/${note}`,'utf8'))===(await state()).data);

  await setSource('# Plain slide\n\nNo private areas.');await slides();
  const emptyBefore=(await state()).data;
  check('slides without callouts show a non-editable empty panel',await tabs().count()===0&&await page.locator('.jss-empty-areas').isVisible()&&await page.locator('.jss-editor').isHidden()&&(await state()).editor==='');
  check('an empty area panel never creates or exposes source',(await state()).data===emptyBefore&&(await state()).native===emptyBefore);
  await native();await page.keyboard.press('Control+End');await page.keyboard.insertText('\n\n> [!slide] New area\n> New private text.');await pause(250);await slides();
  check('the first native-added callout replaces the empty state',await tabs().count()===1&&await page.locator('.jss-empty-areas').isHidden()&&(await state()).editor==='New private text.');

  const crlf='# CRLF title\r\n\r\n> [!slide] Notes\r\n> First line.\r\n>\r\n> Last line.\r\n\r\n> [!slide] Other\r\n> Untouched.\r\n';
  // A file with CRLF is loaded through Obsidian's actual file lifecycle.
  await page.evaluate(async({note,crlf})=>{await jssNativeTestLeaf.view.save();await app.vault.modify(app.vault.getAbstractFileByPath(note),crlf);},{note,crlf});await pause(450);await slides();
  await page.evaluate(()=>jssSlidesTestLeaf.view.select(0));
  check('CRLF area bodies load as separate editor lines',await page.evaluate(()=>jssSlidesTestLeaf.view.editor.state.doc.lines)===3);
  await area().click();await page.keyboard.press('Control+End');await page.keyboard.insertText(' Added.');await pause(250);
  check('CRLF area edits preserve all bytes outside that callout',(await state()).data===crlf.replace('Last line.','Last line. Added.'));
  await pause(2400);check('native-owned autosave preserves every line through native newline normalization',(await readFile(`qa/vault/${note}`,'utf8')).replace(/\r\n/g,'\n')===crlf.replace('Last line.','Last line. Added.').replace(/\r\n/g,'\n'));

  await setSource(original);await slides();await thumbs.nth(1).click();await page.getByRole('tab',{name:'Cues',exact:true}).click();
  await page.locator('.jss-app').screenshot({path:'qa/details.png'});
  const sidebar=page.locator('.jss-sidebar'),bottom=page.locator('.jss-source');
  const leftBefore=(await sidebar.boundingBox()).width,bottomBefore=(await bottom.boundingBox()).height;
  const leftGrip=await page.getByRole('separator',{name:'Resize slide thumbnails'}).boundingBox();await page.mouse.move(leftGrip.x+2,leftGrip.y+leftGrip.height/2);await page.mouse.down();await page.mouse.move(leftGrip.x+62,leftGrip.y+leftGrip.height/2,{steps:6});await page.mouse.up();
  const leftAfter=(await sidebar.boundingBox()).width;check('left panel remains resizable',leftAfter>leftBefore+45);
  const grip=await page.getByRole('separator',{name:'Resize slide editor'}).boundingBox();await page.mouse.move(grip.x+grip.width/2,grip.y+2);await page.mouse.down();await page.mouse.move(grip.x+grip.width/2,grip.y-72,{steps:6});await page.mouse.up();
  const bottomAfter=(await bottom.boundingBox()).height;check('callout panel remains resizable',bottomAfter>bottomBefore+50);
  await page.getByRole('separator',{name:'Resize slide editor'}).focus();await page.keyboard.press('ArrowDown');check('divider keyboard resizing works',(await bottom.boundingBox()).height<bottomAfter-15);
  await pause(250);const saved=await page.evaluate(()=>app.plugins.plugins['just-simple-slides'].loadData());check('panel sizes and selected callout are saved without a source mode',saved.sidebarWidth>leftBefore+45&&saved.sourceRatio>0.3&&saved.areaIndex===1&&!('editorMode' in saved));
  await page.getByRole('separator',{name:'Resize slide thumbnails'}).dblclick();await page.getByRole('separator',{name:'Resize slide editor'}).dblclick();check('double-click restores panel defaults',Math.abs((await sidebar.boundingBox()).width-leftBefore)<2&&Math.abs((await bottom.boundingBox()).height-bottomBefore)<2);
  await page.getByRole('tab',{name:'Notes',exact:true}).click();await page.locator('.jss-app').screenshot({path:'qa/editor.png'});await page.screenshot({path:'qa/editor-with-tabs.png'});
  await area().click();await page.keyboard.press('Control+End');await page.keyboard.insertText('\n\nA private edit on slide two.');await pause(250);const areaEdited=await state();
  await thumbs.nth(4).click();await area().click();await page.keyboard.press('Control+z');check('undo returns to the edited slide after navigation',(await state()).data===original&&(await state()).index===1);
  await page.keyboard.press('Control+Shift+z');check('redo restores the entire document and native editor',(await state()).data===areaEdited.data&&(await state()).native===areaEdited.data);
  await page.keyboard.press('Control+z');await click('Duplicate slide');check('duplicate still works',(await state()).count===7);await click('Move slide down');check('move still works',(await state()).index===3);await click('Delete slide (undo with Ctrl/Cmd+Z)');check('delete still works',(await state()).count===6);

  await setSource(original);await slides();await thumbs.nth(1).click();await click('Present from this slide (F5)');await page.waitForSelector('.jss-presentation .jss-slide');await pause(250);
  check('presentation starts at the selected slide',await page.locator('.jss-player-counter').innerText()==='2 / 6');
  check('native fullscreen activates',await page.evaluate(()=>document.fullscreenElement?.classList.contains('jss-presentation')));
  check('private content stays out of presentation',!(await page.locator('.jss-presentation').innerText()).includes('Show the source editor'));
  await page.keyboard.press('ArrowRight');check('presentation arrow navigation',await page.locator('.jss-player-counter').innerText()==='3 / 6');await page.keyboard.press('Space');check('Space advances',await page.locator('.jss-player-counter').innerText()==='4 / 6');await page.keyboard.press('Home');check('Home selects the first slide',await page.locator('.jss-player-counter').innerText()==='1 / 6');await page.keyboard.press('End');check('End selects the last slide',await page.locator('.jss-player-counter').innerText()==='6 / 6');await page.keyboard.press('Escape');await page.waitForSelector('.jss-presentation',{state:'detached'});
  check('Esc returns to editing without closing native Markdown',(await state()).index===5&&await page.evaluate(()=>app.workspace.getLeavesOfType('markdown').includes(jssNativeTestLeaf)));
  check('presentation does not change the document',(await state()).data===original&&(await state()).native===original);
  // Callout privacy is checked against Obsidian's real Markdown parser, not a mock.
  for (const [markdown, layout] of [
    ['> [!SLIDE]- image\n> PRIVATE_FOLDED_NOTES\n> # PRIVATE_HEADING\n\n![[slides-demo.svg]]', 'image'],
    ['> [!slide]+ content\n> PRIVATE_EXPANDED_NOTES\n\n# Visible title', 'title'],
    ['> [!slide]\n> PRIVATE_NOTES_WITHOUT_TYPE\n\n# Visible title', 'title'],
    ['> [!slide] content\n> PRIVATE_FIRST_LINE\nPRIVATE_LAZY_CONTINUATION\n\n# Visible title', 'title'],
    ['# Visible title\n\nPlain Markdown without a callout.', 'text'],
    ['# Visible title\n\n> [!tip] Visible\n> Keep this.\n>\n> > [!slide] Nested\n> > PRIVATE_NESTED\n>\n> Keep this too.', 'text'],
  ]) {
    await page.evaluate(markdown => jssSlidesTestLeaf.view.setViewData(markdown, true), markdown);
    await pause(200);
    check(`callout rendering: ${layout}, ${markdown.split('\n')[0]}`, await page.locator('.jss-stage .jss-slide').getAttribute('data-layout') === layout
      && !(await page.locator('.jss-stage').innerText()).includes('PRIVATE_'));
  }
  await page.evaluate(() => jssSlidesTestLeaf.view.setViewData('# Visible title\n\n```md\n> [!slide] content\n> A literal code example.\n```\n\n> [!tip] Visible tip\n> Keep this callout on the slide.', true));
  await pause(200);
  check('literal slide-callout examples in code remain visible', (await page.locator('.jss-stage pre').innerText()).includes('[!slide] content'));
  check('ordinary content callouts remain visible', await page.locator('.jss-stage .callout[data-callout="tip"]').count() === 1);
  await page.evaluate(original => jssSlidesTestLeaf.view.setViewData(original, true), original);
  await pause(200);

  const fitting = await page.evaluate(async () => {
    const view = jssSlidesTestLeaf.view;
    const out = [];
    for (let index = 0; index < view.deck.slides.length; index++) {
      view.select(index);
      await new Promise(r => setTimeout(r, 220));
      view.surface.fit();
      const root = view.contentEl.querySelector('.jss-stage');
      const slide = root.querySelector('.jss-slide');
      const bounds = slide.getBoundingClientRect();
      const problems = [];
      for (const el of slide.querySelectorAll('.jss-title, .jss-subtitle, .jss-text > *, .jss-media img')) {
        const rect = el.getBoundingClientRect();
        if (rect.width && rect.height && (rect.left < bounds.left - 2 || rect.right > bounds.right + 2 || rect.top < bounds.top - 2 || rect.bottom > bounds.bottom + 2)) problems.push(el.tagName);
      }
      out.push({ index, layout: slide.dataset.layout, problems });
    }
    return out;
  });
  check('all demo content fits inside the slide', fitting.every(r => !r.problems.length));
  console.log(JSON.stringify(fitting));

  // Stress real rendering, delayed embeds and autoscaling without changing the fixture on disk.
  await page.evaluate(() => {
    const view = jssSlidesTestLeaf.view;
    view.setViewData('# A title '.repeat(18) + '\n\n## A subtitle '.repeat(12) + '\n\n' + Array.from({ length: 70 }, (_, i) => `- Item ${i}: a detailed point with enough words to wrap.`).join('\n') + '\n\n![[slides-demo.svg]]', true);
  });
  await pause(400);
  const stress = await page.locator('.jss-stage .jss-slide').evaluate(slide => {
    const bounds = slide.getBoundingClientRect();
    return { dense: slide.dataset.dense, fits: [...slide.querySelectorAll('.jss-text > *, .jss-title, .jss-subtitle, img')].every(el => {
      const r = el.getBoundingClientRect(); return r.bottom <= bounds.bottom + 1 && r.right <= bounds.right + 1;
    }) };
  });
  check('dense content shrinks to fit', stress.dense === 'true' && stress.fits);

  await page.evaluate(original => {
    const view = jssSlidesTestLeaf.view;
    view.setViewData(original, true); view.select(1);
    document.body.classList.remove('theme-light'); document.body.classList.add('theme-dark');
    app.workspace.trigger('css-change');
  }, original);
  await pause(300);
  await page.screenshot({ path: 'qa/editor-dark.png' });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await pause(300);
  check('narrow viewport keeps rail, editor and stage usable', await page.locator('.jss-app').evaluate(el => {
    const stage = el.querySelector('.jss-stage').getBoundingClientRect();
    const editor = el.querySelector('.jss-editor').getBoundingClientRect();
    const present = el.querySelector('.jss-toolbar .mod-cta').getBoundingClientRect();
    return stage.width > 120 && editor.width > 120 && stage.right <= innerWidth + 1 && stage.left >= 0 && present.right <= innerWidth + 1;
  }));
  await page.screenshot({ path: 'qa/editor-narrow.png' });
  await cdp.send('Emulation.clearDeviceMetricsOverride');
  await page.evaluate(async original => {
    const view = jssSlidesTestLeaf.view;
    view.setViewData(original, true); await view.save();
  }, original);
  await page.evaluate(async()=>{await jssSlidesTestLeaf.view.save();});
  await page.keyboard.press('Control+w');await pause(250);
  check('closing the slide tab leaves the original Markdown editor open',await page.evaluate(()=>!app.workspace.getLeavesOfType('just-simple-slides').includes(jssSlidesTestLeaf)&&app.workspace.getLeavesOfType('markdown').includes(jssNativeTestLeaf)));
  check('native Markdown contains the unchanged source after closing slides',await page.evaluate(original=>jssNativeTestLeaf.view.editor.getValue()===original,original));
  check('the source file stays byte-for-byte intact after the round trip',await readFile(`qa/vault/${note}`,'utf8')===original);
  await native();await page.evaluate(()=>{const e=jssNativeTestLeaf.view.editor;e.setCursor(e.offsetToPos(e.getValue().indexOf('# A little more detail')));});
  await page.evaluate(async()=>{await app.plugins.plugins['just-simple-slides'].open(jssNativeTestLeaf.view.file);globalThis.jssSlidesTestLeaf=app.workspace.activeLeaf;});await pause(250);
  check('a newly opened slide tab follows the native cursor',(await state()).index===4);
  await page.keyboard.press('F5');await page.waitForSelector('.jss-presentation .jss-slide');check('F5 presents the current slide',await page.locator('.jss-player-counter').innerText()==='5 / 6');await page.keyboard.press('Escape');await page.waitForSelector('.jss-presentation',{state:'detached'});

  await native();await page.evaluate(async()=>{await app.plugins.plugins['just-simple-slides'].open(jssNativeTestLeaf.view.file);globalThis.jssSecondSlidesLeaf=app.workspace.activeLeaf;});
  await native();await page.keyboard.press('Control+w');await pause(250);
  check('the native note can be closed independently of both slide tabs',await page.evaluate(()=>!app.workspace.getLeavesOfType('markdown').includes(jssNativeTestLeaf)&&app.workspace.getLeavesOfType('just-simple-slides').length===2));
  await page.evaluate(async()=>{await app.workspace.revealLeaf(jssSecondSlidesLeaf);jssSecondSlidesLeaf.view.focusEditor();});
  await page.keyboard.press('Control+End');await page.keyboard.insertText(' SLIDES_ONLY_EDIT');await pause(100);
  await page.keyboard.press('Control+w');await pause(250);
  check('closing an edited slide tab keeps its changes in the surviving slide tab',await page.evaluate(()=>!app.workspace.getLeavesOfType('just-simple-slides').includes(jssSecondSlidesLeaf)&&jssSlidesTestLeaf.view.getViewData().includes('SLIDES_ONLY_EDIT')));
  await slides();await page.evaluate(()=>jssSlidesTestLeaf.view.focusEditor());
  await page.keyboard.press('Control+End');await page.keyboard.insertText(' KEEP_LATEST');await pause(2400);
  check('a surviving slide tab saves without a native Markdown editor',await readFile(`qa/vault/${note}`,'utf8')===await page.evaluate(()=>jssSlidesTestLeaf.view.getViewData()));
  await page.evaluate(async({note,original})=>{const v=jssSlidesTestLeaf.view;v.setViewData(original,true);await v.save();globalThis.jssNativeTestLeaf=app.workspace.getLeaf('tab');await jssNativeTestLeaf.openFile(app.vault.getAbstractFileByPath(note));},{note,original});
  await pause(250);
  check('reopening the native Markdown editor retains the restored source',await page.evaluate(original=>jssNativeTestLeaf.view.editor.getValue()===original,original)&&await readFile(`qa/vault/${note}`,'utf8')===original);
  await slides();
  check('no plugin runtime errors',errors.filter(e=>/just-simple-slides|jss-|TypeError|ReferenceError/.test(e)).length===0);
  await writeFile('qa/results.json',JSON.stringify({pass:true,results,typography,fitting,stress,errors},null,2));
}catch(error){await page.screenshot({path:'qa/failure.png'});await writeFile('qa/results.json',JSON.stringify({pass:false,error:String(error),results,errors,state:await state()},null,2));throw error;}finally{await browser.close();}
