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
const menu = page => page.evaluate(() => JSON.parse(JSON.stringify(M)));
// DOM-level clicks and typing: the Menu words section may be folded shut, which is fine for these checks
const click = (page, sel, text) => page.evaluate(([sel, text]) => {
  const b = [...document.querySelectorAll(sel)].find(x => !text || x.textContent.trim() === text);
  if (!b) throw new Error('no ' + sel + ' ' + (text || '')); b.click();
}, [sel, text]);
const mode = (page, label) => click(page, '#menuModes button', label);
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

  // ---- Bug 1: Boxes → finish a section → + Add a section → Google Docs → paste
  {
    const page = await fresh(browser);
    await mode(page, 'Boxes');
    await type(page, '#menuEditor input[aria-label="Section name"]', 'Tapas');
    const before = await menu(page);
    await click(page, '#menuEditor button', '+ Add a section');
    await mode(page, 'Google Docs');
    await paste(page, '#menuEditor textarea', DOC, DOC_TXT);
    const after = await menu(page);
    ok(after.length >= before.length, `bug 1: no section lost (${before.length} before, ${after.length} after)`);
    ok(before.every((s, i) => JSON.stringify(after[i]) === JSON.stringify(s)), 'bug 1: earlier sections unchanged');
    ok(after.some(s => s.title === 'Salads' && s.items.length === 2), 'bug 1: pasted Salads section is there');
    ok(!after.some(s => s.title === 'New section'), 'bug 1: paste filled the empty “New section”');
    // typing in the Docs box keeps the whole menu
    await type(page, '#menuEditor textarea', '\nExtra dish', true);
    ok((await menu(page)).length === after.length, 'bug 1: typing in the Docs box keeps every section');
    // switching modes keeps everything
    const typed = await menu(page);
    for (const m of ['Boxes', 'Typing', 'Google Docs', 'Boxes']) await mode(page, m);
    ok(JSON.stringify(await menu(page)) === JSON.stringify(typed), 'bug 1: switching modes keeps every section');
    await page.close();
  }

  // ---- pasting a whole Doc again updates matching sections instead of doubling them; Replace is offered
  {
    const page = await fresh(browser);
    await mode(page, 'Google Docs');
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

  await browser.close();
  console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed');
  process.exit(failed ? 1 : 0);
})();
