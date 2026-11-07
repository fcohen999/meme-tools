// Browser checks for the menu editor. Run: node tests/menu-editor.test.js
// Uses the Playwright + Chromium already on the machine (no install needed).
const { chromium } = require('playwright');
const path = require('path');
const URL = 'file://' + path.resolve(__dirname, '..', 'editor.html') + '#menu';

let failed = 0;
const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) failed++; };

async function fresh(browser) {
  const page = await browser.newPage();
  page.on('pageerror', e => { console.log('PAGE ERROR', e.message); failed++; });
  await page.goto(URL);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  return page;
}
// compare menus without caring about key order
const norm = v => Array.isArray(v) ? v.map(norm) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, norm(v[k])])) : v;
const same = (a, b) => JSON.stringify(norm(a)) === JSON.stringify(norm(b));
const menu = page => page.evaluate(() => JSON.parse(JSON.stringify(M)));
// DOM-level clicks and typing: the Menu words section may be folded shut, which is fine for these checks
const click = (page, sel, text) => page.evaluate(([sel, text]) => {
  const b = [...document.querySelectorAll(sel)].find(x => !text || x.textContent.trim() === text);
  if (!b) throw new Error('no ' + sel + ' ' + (text || '')); b.click();
}, [sel, text]);
// Boxes or Text; 'Import' opens the Import / export view (Google Sheets and files)
const mode = (page, label) => label === 'Import'
  ? page.evaluate(() => { if (menuMode !== 'sheet') document.querySelector('.mimport button').click(); })
  : click(page, '#menuModes button', label);
// Move up / Move down from a ⋯ menu: the n-th (from 0; -1 = last) ⋯ button matching sel
const moveVia = async (page, sel, n, label) => {
  await page.evaluate(([sel, n]) => { const d = document.querySelectorAll(sel); (n < 0 ? d[d.length + n] : d[n]).click(); }, [sel, n]);
  await click(page, '.popmenu button', label);
};
const type = (page, sel, value, append) => page.$eval(sel, (el, [v, a]) => { el.value = a ? el.value + v : v; el.dispatchEvent(new Event('input', { bubbles: true })); }, [value, append]);
// a paste event with the clipboard holding a Google Doc (HTML) and its plain text
const paste = (page, sel, html, plain) => page.$eval(sel, (el, [html, plain]) => {
  const dt = new DataTransfer(); dt.setData('text/html', html); dt.setData('text/plain', plain);
  el.focus(); el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
}, [html, plain]);
const DOC = '<h2>Salads</h2><p><b>Greek Salad</b></p><p>Tomato, cucumber, feta</p><p><b>Fattoush</b></p><p>Pita, sumac, greens</p>';
const DOC_TXT = 'Salads\nGreek Salad\nTomato, cucumber, feta\nFattoush\nPita, sumac, greens';

(async () => {
  const browser = await chromium.launch();

  // ---- Bug 1: Boxes → finish a section → + Add a section → Text → paste a Google Doc
  {
    const page = await fresh(browser);
    await mode(page, 'Boxes');
    await type(page, '#menuEditor input[aria-label="Section name"]', 'Tapas');
    const before = await menu(page);
    await click(page, '#menuEditor button', '+ Add a section');
    await mode(page, 'Text');
    await paste(page, '#menuEditor textarea', DOC, DOC_TXT);
    const after = await menu(page);
    ok(after.length >= before.length, `bug 1: no section lost (${before.length} before, ${after.length} after)`);
    ok(before.every((s, i) => JSON.stringify(after[i]) === JSON.stringify(s)), 'bug 1: earlier sections unchanged');
    ok(after.some(s => s.title === 'Salads' && s.items.length === 2), 'bug 1: pasted Salads section is there');
    ok(!after.some(s => s.title === 'New section'), 'bug 1: paste filled the empty “New section”');
    // typing in the Docs box keeps the whole menu
    await type(page, '#menuEditor textarea', '\nExtra dish', true);
    ok((await menu(page)).length === after.length, 'bug 1: typing in the Text box keeps every section');
    // switching modes keeps everything
    const typed = await menu(page);
    for (const m of ['Boxes', 'Text', 'Import', 'Text', 'Boxes']) await mode(page, m);
    ok(JSON.stringify(await menu(page)) === JSON.stringify(typed), 'bug 1: switching modes keeps every section');
    await page.close();
  }

  // ---- pasting a whole Doc again updates matching sections instead of doubling them; Replace is offered
  {
    const page = await fresh(browser);
    await mode(page, 'Text');
    const doc = '<h2>Cocktails</h2><p><b>Negroni</b></p><p>Gin, Campari, vermouth</p>' + DOC;
    await paste(page, '#menuEditor textarea', doc, 'x');
    let m = await menu(page);
    ok(m.length === 3 && m[0].title === 'Cocktails' && m[0].items.length === 1 && m[1].title === 'Beers' && m[2].title === 'Salads', 'paste: same-name section updated, others kept, new one added');
    await click(page, '#menuEditor button.link', 'Replace the whole menu with what I pasted');
    m = await menu(page);
    ok(m.length === 2 && m[0].title === 'Cocktails' && m[1].title === 'Salads', 'paste: “Replace the whole menu” works');
    await click(page, '.mundo');
    ok((await menu(page)).length === 3, 'undo: back to before the replace');
    await click(page, '.mundo');
    m = await menu(page);
    ok(m.length === 2 && m[0].items.length === 12, 'undo: back to the sample menu before the paste');
    await click(page, '.mredo');
    ok((await menu(page)).length === 3, 'redo: the paste is back');
    await page.close();
  }

  // ---- Undo for deletes, clearing, and typing
  {
    const page = await fresh(browser);
    const start = await menu(page);
    await mode(page, 'Boxes');
    ok(await page.$eval('.mundo', b => b.disabled), 'undo: nothing to undo on a fresh page');
    await click(page, '.dots[aria-label="Section options"]');
    await click(page, '.popmenu button', 'Delete this section');
    await click(page, '.popmenu button', 'Click again to delete the whole section');
    ok((await menu(page)).length === 1, 'delete section: gone');
    await click(page, '.mundo');
    ok(JSON.stringify(await menu(page)) === JSON.stringify(start), 'undo: deleted section is back, unchanged');
    ok(/Undid: deleted the section “Cocktails”/.test(await page.$eval('.mst', e => e.textContent)), 'undo: says what it put back');
    await click(page, '.dots[aria-label="Options for dish 1"]');
    await click(page, '.popmenu button', 'Delete this dish');
    await click(page, '.popmenu button', 'Click again to delete this dish');
    ok((await menu(page))[0].items.length === 11, 'delete dish: gone');
    await page.keyboard.press('Control+z');
    ok((await menu(page))[0].items.length === 12, 'Ctrl+Z: dish is back');
    await page.keyboard.press('Control+Shift+z');
    ok((await menu(page))[0].items.length === 11, 'Ctrl+Shift+Z: redo');
    await page.keyboard.press('Control+z');
    // typing is one step after a pause
    await type(page, '#menuEditor input[aria-label="Section name"]', 'Drinks');
    await page.waitForTimeout(900);
    await click(page, '.mundo');
    ok((await menu(page))[0].title === 'Cocktails', 'undo: typed change undone');
    await click(page, '.mbar .dots');
    await click(page, '.popmenu button', 'Clear all the words');
    await click(page, '.popmenu button', 'Click again to clear the words of this menu');
    ok((await menu(page)).length === 1, 'clear: words cleared');
    await click(page, '.mundo');
    ok(JSON.stringify(await menu(page)) === JSON.stringify(start), 'undo: cleared words are back');
    await page.close();
  }

  // ---- Bug 2: opening files
  {
    const page = await fresh(browser);
    const txt = '# Mezze 14\nHummus: chickpeas, tahini\nLabneh: olive oil, za’atar\n\n# Salads\nFattoush (12): pita, sumac\n';
    const pick = async (name, mimeType, body) => {
      const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.evaluate(() => { document.querySelector('.mbar ~ input[type=file], #panel input[type=file]:not(#mFile)').click(); })]);
      await chooser.setFiles({ name, mimeType, buffer: Buffer.from(body) });
      await page.waitForTimeout(200);
      return page.$eval('.mst', e => e.textContent);
    };
    ok(await page.$eval('#panel > div input[type=file]', i => !i.accept), 'open: the picker greys nothing out');
    let msg = await pick('Lunch - meme on 10 menu.txt', 'text/plain', txt);
    let m = await menu(page);
    ok(m.length === 2 && m[0].title === 'Mezze' && m[1].items[0].price === '12' && /Opened/.test(msg), 'open: .txt reopens with its sections and dishes');
    ok(await page.$eval('.mbar select', s => s.value) === 'Lunch', 'open: named after the file');
    msg = await pick('menu.csv', 'text/csv', 'Section,Dish,What’s in it,Price\nDesserts,,,9\n,Baklava,honey,\n');
    m = await menu(page);
    ok(m.length === 1 && m[0].title === 'Desserts' && m[0].items[0].name === 'Baklava', 'open: .csv opens');
    msg = await pick('Lunch.pdf', 'application/pdf', '%PDF-1.4');
    ok(/is a PDF/.test(msg) && /meme on 10 menu\.txt/.test(msg), 'open: a PDF gets a clear explanation');
    msg = await pick('menu.png', 'image/png', 'x');
    ok(/picture of the menu/.test(msg), 'open: a picture gets a clear explanation');
    await page.close();
  }

  // ---- Structure: per-section columns, subheadings, choices — kept by every way of editing
  {
    const page = await fresh(browser);
    const RICH = [
      { title: '', price: '', items: [{ sub: 'Lunch', align: 'center' }] },
      { title: 'Tapas', price: '', cols: 2, items: [
        { name: 'Shipudim', desc: 'Grilled skewers, served with pita', price: '', opts: [{ name: 'Chicken', price: '24' }, { name: 'Lamb kebab', price: '28' }] },
        { name: 'Hummus', desc: 'Chickpeas, tahini, olive oil', price: '14', optsInline: true, opts: [{ name: 'Falafel', price: '18' }, { name: 'Lamb', price: '22' }] },
        { sub: 'From the grill', align: 'left' },
        { name: 'Halloumi', desc: 'Honey, za’atar', price: '12' },
        { name: 'Merguez', desc: 'Harissa', price: '13' }] },
      { title: 'Salads', price: '', cols: 1, items: [
        { sub: 'Small plates', align: 'right' },
        { name: 'Fattoush', desc: 'Pita, sumac, greens', price: '12' }] },
      { title: 'Beers', price: '10', items: [{ name: 'Pilsner', desc: '', price: '' }] },
    ];
    await page.evaluate(m => { M = JSON.parse(JSON.stringify(m)); buildPanel(); render(); }, RICH);
    ok(same(await menu(page), RICH), 'structure: menu set');
    for (const m of ['Text', 'Import', 'Boxes', 'Text', 'Boxes']) {
      await mode(page, m);
      if (m === 'Text') await type(page, '#menuEditor textarea', '', true);   // re-read the box
      ok(same(await menu(page), RICH), `structure: kept after ${m}`);
    }
    // Google Sheets: copy the rows and paste them back
    await mode(page, 'Import');
    const tsv = await page.evaluate(() => toTSV(menuRows()));
    await type(page, '#menuEditor textarea', tsv);
    ok(same(await menu(page), RICH), 'structure: kept through a Google Sheet (rows copied and pasted back)');
    // saved file → opened again
    const back = await page.evaluate(() => readMenuFile(menuFileText(), 'x.txt').words);
    ok(same(back, RICH), 'structure: kept through Save to my computer → Open');
    // drawn on the page
    const svg = await page.$eval('#canvas svg', e => e.outerHTML);
    ok(svg.includes('>LUNCH<') && svg.includes('text-anchor="middle"') && svg.includes('>FROM THE GRILL<'), 'drawn: subheadings, centered one included');
    ok(svg.includes('>Lamb kebab<') && svg.includes('>28<') && svg.includes('>Chicken<'), 'drawn: choices and their prices');
    const xs = await page.$$eval('#canvas svg text', ts => ts.map(t => [t.textContent, +t.getAttribute('x')]));
    const x = n => (xs.find(t => t[0] === n) || [])[1];
    ok(x('HALLOUMI') !== x('MERGUEZ'), 'drawn: Tapas in two columns');
    await page.close();
  }

  // ---- Choices side by side, and where a section's own price sits
  {
    const page = await fresh(browser);
    const M1 = [{ title: 'Beers', price: '10', items: [
      { name: 'Shipudim', desc: '', price: '', opts: [{ name: 'Chicken', price: '18' }, { name: 'Lamb', price: '22' }, { name: 'Shrimp', price: '24' }] }] }];
    await page.evaluate(m => { M = JSON.parse(JSON.stringify(m)); G.mn.columns = 1; buildPanel(); render(); }, M1);
    await mode(page, 'Boxes');
    const ys = () => page.$$eval('#canvas svg text', ts => Object.fromEntries(ts.map(t => [t.textContent, +t.getAttribute('y')])));
    let y = await ys();
    ok(y.Chicken !== y.Lamb, 'choices: one per line to start');
    await click(page, `.seg[aria-label="Choices for dish 1"] button`, 'Side by side');
    ok((await menu(page))[0].items[0].optsInline === true, 'choices: Side by side button sets it');
    y = await ys();
    ok(y.Chicken === y.Lamb && y.Lamb === y.Shrimp && y['22'] === y.Chicken, 'choices: side by side on one line, prices too');
    const t = await page.evaluate(() => menuToText());
    ok(t.includes('- Chicken (18) · Lamb (22) · Shrimp (24)'), 'choices: written as one line when typing');
    ok(same(await page.evaluate(() => parseMenuText('# A\nKebab\n- Beef (9) · Lamb (11)')), [{ title: 'A', price: '', items: [{ name: 'Kebab', desc: '', price: '', optsInline: true, opts: [{ name: 'Beef', price: '9' }, { name: 'Lamb', price: '11' }] }] }]), 'choices: a typed “ · ” line reads back side by side');
    await click(page, `.seg[aria-label="Choices for dish 1"] button`, 'One per line');
    ok(!('optsInline' in (await menu(page))[0].items[0]), 'choices: One per line turns it off');
    // section price: next to the name to start, then at the right edge
    const sp = () => page.$eval('#canvas svg [data-spr]', e => [e.getAttribute('text-anchor'), +e.getAttribute('x')]);
    let [anc, sx] = await sp();
    ok(anc === null && sx < 300, 'section price: next to the name to start');
    await page.evaluate(() => { G.mn.secPricePos = 'edge'; G.mn.priceIn = 20; render(); });
    [anc, sx] = await sp();
    const right = await page.evaluate(() => 850 - (G.mn.side ?? 64) - 20);
    ok(anc === 'end' && Math.abs(sx - right) < 0.5, 'section price: at the right edge, in by the same amount as the dish prices');
    ok(await page.evaluate(() => readMenuFile(menuFileText(), 'x.txt').look.secPricePos) === 'edge', 'section price: kept in a saved file');
    await page.close();
  }

  // ---- Boxes: column buttons, subheadings, choices, duplicate a section
  {
    const page = await fresh(browser);
    await mode(page, 'Boxes');
    await page.evaluate(() => { G.mn.columns = 2; render(); });
    await click(page, '.mcard:nth-of-type(2) .mcols button', '1 column');
    let m = await menu(page);
    ok(m[0].cols === 1 && m[1].cols === undefined, 'boxes: one section’s columns change, the others don’t');
    await click(page, '.mcard:nth-of-type(2) button', '+ Add a subheading');
    await type(page, '#menuEditor input[aria-label="Subheading"]', 'Classics');
    await click(page, '.msub .mcols button', 'Center');
    m = await menu(page);
    ok(same(m[0].items[m[0].items.length - 1], { sub: 'Classics', align: 'center' }), 'boxes: subheading added, typed and centered');
    // the first choice comes from the dish’s ⋯ menu; then “+ Add a choice” shows under it
    ok(!(await page.$('.mcard:nth-of-type(3) .mdish .madd-opt')), 'boxes: no “+ Add a choice” link under a dish without choices');
    await click(page, '.mcard:nth-of-type(3) .dots[aria-label="Options for dish 1"]');
    await click(page, '.popmenu button', 'Add a choice, like Chicken or Lamb');
    await click(page, '.mcard:nth-of-type(3) .mdish button', '+ Add a choice');
    await type(page, '#menuEditor input[aria-label="Dish 1, choice 1"]', 'Draft');
    await type(page, '#menuEditor input[aria-label="Dish 1, choice 2"]', 'Bottle');
    await type(page, '#menuEditor input[aria-label="Dish 1, choice 2 price"]', '8');
    await moveVia(page, '.dots[aria-label="Options for choice 2"]', 0, 'Move up');
    m = await menu(page);
    ok(same(m[1].items[0].opts, [{ name: 'Bottle', price: '8' }, { name: 'Draft', price: '' }]), 'boxes: choices added, priced and moved');
    await click(page, '.dots[aria-label="Options for choice 1"]');
    await click(page, '.popmenu button', 'Delete this choice');
    await click(page, '.popmenu button', 'Click again to delete this choice');
    ok((await menu(page))[1].items[0].opts.length === 1, 'boxes: choice deleted');
    // folding: sections start closed, the bar opens one, and that is remembered
    await page.evaluate(() => { localStorage.removeItem('meme10_boxopen'); BOXOPEN = null; renderMenuEditor(); });
    let shut = await page.$$eval('.mcard.msec', cs => cs.map(c => c.classList.contains('shut')));
    ok(shut.length > 1 && shut.every(Boolean), 'fold: sections start closed');
    ok(/dish/.test(await page.$eval('.mcard.msec .msum', e => e.textContent)), 'fold: a closed section lists its dishes');
    await click(page, '.mcard.msec:nth-of-type(3) .mfold');
    shut = await page.$$eval('.mcard.msec', cs => cs.map(c => c.classList.contains('shut')));
    ok(shut[0] && !shut[1], 'fold: clicking a bar opens just that section');
    await page.evaluate(() => { BOXOPEN = null; renderMenuEditor(); });
    ok(!(await page.$eval('.mcard.msec:nth-of-type(3)', c => c.classList.contains('shut'))), 'fold: an open section stays open after redrawing');
    await click(page, '.mfoldall button', 'Open all');
    ok(await page.$$eval('.mcard.msec.shut', cs => cs.length) === 0, 'fold: Open all');
    // a section with one price for all: no price box on its dishes until you ask for one
    await page.evaluate(() => { M[1].price = '10'; M[1].items[0].price = ''; renderMenuEditor(); });
    ok(!(await page.$('.mcard:nth-of-type(3) input[aria-label^="Dish 1 price"]')), 'price: hidden when the section has a price for all');
    await click(page, '.mcard:nth-of-type(3) .dots[aria-label="Options for dish 1"]');
    await click(page, '.popmenu button', 'Give this dish its own price');
    ok(!!(await page.$('.mcard:nth-of-type(3) input[aria-label^="Dish 1 price"]')), 'price: shown after “Give this dish its own price”');
    // duplicate Cocktails
    const before = await menu(page);
    await click(page, '.mcard:nth-of-type(2) .dots[aria-label="Section options"]');
    await click(page, '.popmenu button', 'Duplicate this section');
    m = await menu(page);
    ok(m.length === 3 && m[1].title === 'Cocktails copy' && same({ ...m[1], title: 'x' }, { ...before[0], title: 'x' }), 'duplicate: a full copy right after the original, with its columns');
    await type(page, '#menuEditor .mcard:nth-of-type(3) input[aria-label="Section name"]', 'Mocktails');
    await click(page, '.mcard:nth-of-type(3) .mcols button', '2 columns');
    m = await menu(page);
    ok(m[1].title === 'Mocktails' && m[1].cols === 2 && same(m[0], before[0]) && same(m[2], before[1]), 'duplicate: renaming and changing the copy leaves the others alone');
    await click(page, '.mundo'); await click(page, '.mundo'); await click(page, '.mundo');
    ok(same(await menu(page), before), 'duplicate: undo removes the copy');
    await page.close();
  }

  // ---- Google Docs: bullets under a dish are its choices; a label at the top is a subheading
  {
    const page = await fresh(browser);
    await page.evaluate(() => { M = BLANK_MENU(); buildPanel(); render(); });
    await mode(page, 'Text');
    const doc = '<h1 style="text-align:center">Lunch</h1><h2>Grill</h2><p><b>Shipudim</b></p><p>Grilled skewers with pita</p><ul><li><p>Chicken 24</p></li><li><p>Lamb 28</p></li></ul><p><b>Kebab</b></p><p>Spiced beef, onion</p><h2>Salads</h2><p><b>Fattoush</b></p><p>Pita, sumac</p>';
    await paste(page, '#menuEditor textarea', doc, 'x');
    const m = await menu(page);
    ok(same(m[0].items, [{ sub: 'Lunch', align: 'center' }]), 'docs: label at the top is a centered subheading');
    ok(m[1].title === 'Grill' && same(m[1].items[0].opts, [{ name: 'Chicken', price: '24' }, { name: 'Lamb', price: '28' }]) && m[1].items[1].name === 'Kebab', 'docs: bullets under a dish are its choices');
    ok(m[2] && m[2].title === 'Salads', 'docs: the sections are still sections');
    await page.close();
  }

  // ---- Two half pages on one sheet
  {
    const page = await fresh(browser);
    // a second menu, “Drink specials”, with its own words and look
    await page.evaluate(() => {
      addMenu('Drink specials', [{ title: 'Specials', price: '', items: [{ name: 'Arak spritz', desc: 'Arak, soda, mint', price: '14' }] }], Object.assign(lookOf(G.mn), { menuBg: '#ffffff' }));
      useMenu('Cocktails'); buildPanel(); render();
    });
    await click(page, '.row2 .seg button', 'Two half pages');
    ok(await page.evaluate(() => G.mn.sheet === 'halves'), 'halves: picked from the panel');
    ok(await page.$('#panel select[id] option[value="Drink specials"]') !== null, 'halves: right-half menu list shows the other menu');
    await page.$eval('#panel .row2.two select', s => { s.value = 'Drink specials'; s.dispatchEvent(new Event('change')); });
    const svg = await page.$eval('#canvas svg', e => e.outerHTML);
    ok(svg.includes('translate(425 0)') && svg.includes('>ARAK SPRITZ<') && svg.includes('>MÉMÉ’S MANHATTAN<'), 'halves: left is this menu, right is Drink specials');
    ok(svg.includes('x1="425"') && svg.includes('stroke-dasharray'), 'halves: dashed cutting line down the middle');
    ok(svg.includes('fill="#ffffff"') && svg.includes('<rect width="425"'), 'halves: each half has its own page color');
    const pos = await page.$$eval('#canvas svg text', ts => ts.map(t => { const b = t.getBBox(), m = t.getCTM(); return [t.textContent, m.e + b.x * m.a, m.e + (b.x + b.width) * m.a]; }));
    const leftOK = pos.filter(p => p[1] < 425 * 0.96).every(p => p[2] <= 425 + 1);
    ok(leftOK, 'halves: nothing on the left half crosses the cutting line');
    ok(pos.filter(p => /KITCHEN/.test(p[0])).length === 2, 'halves: each half has its own header');
    // saved file keeps it; header picture stays one page
    const r = await page.evaluate(() => readMenuFile(menuFileText(), 'x.txt').look);
    ok(r.sheet === 'halves' && r.rightMenu === 'Drink specials' && r.cutLine === true, 'halves: kept in the saved file');
    // renaming the right-hand menu keeps it in the right half
    await page.evaluate(() => { useMenu('Drink specials'); buildPanel(); render(); });
    await click(page, '.mbar .dots'); await click(page, '.popmenu button', 'Rename…');
    await page.$eval('.mform input', i => { i.value = 'Bar specials'; }); await click(page, '.mform button.primary');
    await page.evaluate(() => { useMenu('Cocktails'); buildPanel(); render(); });
    ok(await page.evaluate(() => G.mn.rightMenu === 'Bar specials') && (await page.$eval('#canvas svg', e => e.outerHTML)).includes('>ARAK SPRITZ<'), 'halves: renaming the right menu keeps it there');
    await page.waitForTimeout(800);
    await click(page, '.row2 .seg button', 'Whole page');
    await page.waitForTimeout(800);
    await click(page, '.mundo');
    ok(await page.evaluate(() => G.mn.sheet === 'halves'), 'halves: Undo brings back two half pages');
    await page.evaluate(() => { G.mn.sheet = 'full'; render(); });
    ok(!(await page.$eval('#canvas svg', e => e.outerHTML)).includes('translate(425 0)'), 'whole page: back to one menu');
    await page.close();
  }

  // ---- Boxes: ↑ ↓ arrows in view; the menu title under the logo is the first box
  {
    const page = await fresh(browser);
    await mode(page, 'Boxes');
    ok(await page.$eval('#menuEditor > .mcard', c => c.classList.contains('mtop')), 'title box: the first box is the menu title under the logo');
    await page.evaluate(() => { document.querySelector('#menuEditor').closest('.acc').classList.add('open'); document.querySelector('#menuEditor input[aria-label="Menu title under the logo"]').focus(); });
    await type(page, '#menuEditor input[aria-label="Menu title under the logo"]', 'Lunch');
    await page.waitForTimeout(50);
    let m = await menu(page);
    ok(same(m[0], { title: '', price: '', items: [{ sub: 'Lunch', align: 'center' }] }) && m[1].title === 'Cocktails', 'title box: typing “Lunch” puts it under the logo, centered, above the sections');
    ok((await page.$eval('#canvas svg', e => e.outerHTML)).includes('>LUNCH<'), 'title box: drawn on the page');
    ok(await page.$eval('#menuEditor input[aria-label="Menu title under the logo"]', i => document.activeElement === i), 'title box: cursor stays in the box');
    ok(!(await page.$('.mdish .marrows')), 'rows: no ↑ ↓ buttons on dish rows (they are in the ⋯ menu)');
    await moveVia(page, '.mcard:nth-of-type(2) .mdish .dots', 0, 'Move down');
    m = await menu(page);
    ok(m[1].items[0].name === 'Spicy Margarita' && m[1].items[1].name === 'Mémé’s Manhattan', '⋯ Move down moves a dish down');
    await moveVia(page, '.mcard:nth-of-type(2) .mdish:not(.msub) .dots', -1, 'Move down');
    m = await menu(page);
    ok(m[1].items.length === 11 && m[2].items[0].name === 'Amaro Carajillo', '⋯ Move down on the last dish moves it into the next section');
    await click(page, '.mcard:nth-of-type(3) .mhead button[aria-label="Move this section up"]');
    m = await menu(page);
    ok(m[0].items[0].sub === 'Lunch' && m[1].title === 'Beers' && m[2].title === 'Cocktails', 'arrows: ↑ moves a section up, the title stays on top');
    ok(await page.$eval('.mcard:nth-of-type(2) .mhead button[aria-label="Move this section up"]', b => b.disabled), 'arrows: the first section can’t go above the title');
    await page.close();
  }
  // ---- Mom’s case: “Lunch” typed as a subheading at the bottom of the first section → ↑ moves it under the logo
  {
    const page = await fresh(browser);
    await page.evaluate(() => { M = [{ title: 'woo', price: '', items: [{ name: '', desc: '' }, { sub: 'Lunch', align: 'center' }] }, { title: 'New section', price: '', items: [{ name: '', desc: '' }] }]; buildPanel(); render(); });
    await mode(page, 'Boxes');
    await moveVia(page, '.dots[aria-label="Options for this subheading"]', 0, 'Move up');
    await moveVia(page, '.dots[aria-label="Options for this subheading"]', 0, 'Move up');
    const m = await menu(page);
    ok(same(m[0], { title: '', price: '', items: [{ sub: 'Lunch', align: 'center' }] }) && m[1].title === 'woo' && m[1].items.length === 1, 'subheading ↑ out of the first section becomes the menu title');
    ok(await page.$eval('#menuEditor input[aria-label="Menu title under the logo"]', i => i.value) === 'Lunch', 'and it shows in the first box');
    await page.close();
  }

  // ---- Drag a dish by its ⠿ handle (real mouse)
  {
    const page = await fresh(browser);
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.evaluate(() => { M = [
      { title: 'Cocktails', price: '', items: [{ name: 'A', desc: '' }, { name: 'B', desc: '' }, { name: 'C', desc: '' }] },
      { title: 'Beers', price: '10', items: [{ name: 'Pils', desc: '' }, { name: 'IPA', desc: '' }] },
      { title: 'Wine', price: '', items: [{ name: 'Red', desc: '' }] }]; buildPanel(); render(); });
    await mode(page, 'Boxes');
    await page.evaluate(() => { const a = [...document.querySelectorAll('.acc')].find(a => a.querySelector('#menuEditor')); if (!a.classList.contains('open')) a.querySelector('.acc-h').click(); });
    await click(page, '.mfoldall button', 'Open all');
    await click(page, '.mcard.msec:nth-of-type(4) .mfold');   // close Wine (the menu title box is the first card)
    const names = async () => (await menu(page)).map(s => s.items.map(i => i.name).join(','));
    // grab the handle of dish `name`, drop it at y of a point given by fn(box of target)
    const drag = async (name, targetSel, where) => {
      const h = await page.evaluateHandle(n => [...document.querySelectorAll('#menuEditor .mdish')].find(r => r.querySelector('input').value === n).querySelector('.mgrip'), name);
      await h.scrollIntoViewIfNeeded();
      const hb = await h.boundingBox();
      await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2); await page.mouse.down();
      await page.mouse.move(hb.x + 10, hb.y + 20, { steps: 3 });
      const t = await (await page.evaluateHandle(tg => tg.sec
        ? [...document.querySelectorAll('#menuEditor .mcard.msec')].find(c => c.querySelector('.mname').textContent === tg.sec).querySelector('.mhead')
        : [...document.querySelectorAll('#menuEditor .mdish')].find(r => r.querySelector('input').value === tg), targetSel)).boundingBox();
      await page.mouse.move(t.x + 40, where === 'below' ? t.y + t.height - 3 : t.y + 3, { steps: 6 });
      await page.mouse.up();
    };
    await drag('A', 'C', 'below');
    ok((await names())[0] === 'B,C,A', 'drag: a dish moves down within its section');
    await drag('IPA', 'B', 'above');
    let n = await names();
    ok(n[0] === 'IPA,B,C,A' && n[1] === 'Pils', 'drag: a dish moves into another section, at the line');
    await drag('C', { sec: 'Wine' }, 'above');
    n = await names();
    ok(n[0] === 'IPA,B,A' && n[2] === 'Red,C', 'drag: dropped on a closed section, it goes at the end');
    ok(!(await page.$eval('.mcard.msec:nth-of-type(4)', c => c.classList.contains('shut'))), 'drag: and that section opens');
    ok(!(await page.$('.mghost')) && !(await page.$('.mdropline')), 'drag: nothing left floating after the drop');
    await click(page, '.mundo');
    ok((await names())[0] === 'IPA,B,C,A', 'drag: Undo puts it back');
    await page.close();
  }

  // ---- Panel cleanup (update 32): two ways to edit, Import / export, no Simple switch or Reset on the Menu page
  {
    const page = await fresh(browser);
    ok(await page.evaluate(() => menuMode) === 'boxes', 'cleanup: a first visit starts in Boxes');
    ok(await page.$$eval('#menuModes button', bs => bs.map(b => b.textContent).join()) === 'Boxes,Text', 'cleanup: the modes are Boxes and Text');
    ok(!(await page.$('#simpleSw')), 'cleanup: no Simple switch on the Menu page');
    ok(!(await page.$('#btnReset')), 'cleanup: no Reset everything button on the Menu page');
    ok(await page.$eval('#menuWarn', w => !!(w.compareDocumentPosition(document.getElementById('menuEditor')) & Node.DOCUMENT_POSITION_FOLLOWING)), 'cleanup: the “too long” warning sits above the boxes');
    const where = await page.evaluate(() => [...document.querySelectorAll('#panel .acc')].find(a => a.textContent.includes('Tagline order')).dataset.sec);
    ok(where === 'order', 'cleanup: Tagline order is under Page header');
    // Import / export opens the Sheets view and goes back to the mode you came from
    await mode(page, 'Text');
    await mode(page, 'Import');
    ok(!!(await page.$('#menuEditor #mCopy')) && await page.$$eval('#menuModes button.on', b => b.length) === 0, 'import: the Sheets view opens');
    await click(page, '.mimport button');
    ok(await page.evaluate(() => menuMode) === 'text', 'import: Back returns to Text');
    // a saved Google Docs mode comes back as Text, a saved Sheets mode as Boxes
    await page.evaluate(() => { const v = JSON.parse(localStorage.getItem('meme10_last')); v.menuMode = 'docs'; localStorage.setItem('meme10_last', JSON.stringify(v)); });
    await page.reload();
    ok(await page.evaluate(() => menuMode) === 'text', 'restore: a saved Google Docs mode opens as Text');
    await page.evaluate(() => { const v = JSON.parse(localStorage.getItem('meme10_last')); v.menuMode = 'sheet'; localStorage.setItem('meme10_last', JSON.stringify(v)); });
    await page.reload();
    ok(await page.evaluate(() => menuMode) === 'boxes', 'restore: a saved Google Sheets mode opens as Boxes');
    // ⋯ Put the look back: only the look changes, and Undo brings it back
    await page.evaluate(() => { G.mn.side = 120; G.mn.columns = 1; buildPanel(); render(); });
    const words = await menu(page);
    await click(page, '.mbar .dots');
    await click(page, '.popmenu button', 'Put the look back to how it started');
    await click(page, '.popmenu button', 'Click again to put back the starting look of this menu');
    ok(await page.evaluate(() => G.mn.side === LAYOUTS.mn.geo.side && G.mn.columns === LAYOUTS.mn.geo.columns), 'look reset: the look is back to how it started');
    ok(same(await menu(page), words), 'look reset: the words stay the same');
    await click(page, '.mundo');
    ok(await page.evaluate(() => G.mn.side === 120 && +G.mn.columns === 1), 'look reset: Undo brings the look back');
    // the logo pages keep the Simple switch and Reset everything
    await page.evaluate(() => { cur = '1b'; buildPanel(); render(); });
    ok(!!(await page.$('#simpleSw')) && !!(await page.$('#btnReset')), 'cleanup: logo pages keep the Simple switch and Reset everything');
    await page.close();
  }

  await browser.close();
  console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed');
  process.exit(failed ? 1 : 0);
})();
