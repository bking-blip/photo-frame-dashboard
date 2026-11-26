#!/usr/bin/env node
// Builds print-ready recipe pages from the Markdown files in recipes/.
//   node build.js            -> out/<recipe>.pdf for each recipe, plus out/recipe-book.pdf and .html
//   node build.js cranberry  -> only recipes whose filename contains "cranberry"
// The build never rewrites recipe text. It only lays it out, and shrinks the type
// a little when that is what it takes to keep a recipe on one page.

const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');
const { chromium } = require('playwright');

const ROOT = __dirname;
const SRC = path.join(ROOT, 'recipes');
const OUT = path.join(ROOT, 'out');

const MAX_PT = 11.5; // preferred body size
const MIN_PT = 9.25; // smallest size still comfortable at arm's length in a kitchen
const TWO_PAGE_PT = 10.5; // used when a recipe cannot fit one page even at MIN_PT

// ---------- parsing ----------

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Typographic fractions only: "2 1/2" -> "2½". The amounts are untouched.
const FRACTIONS = { '1/2': '½', '1/3': '⅓', '2/3': '⅔', '1/4': '¼', '3/4': '¾', '1/8': '⅛', '3/8': '⅜', '5/8': '⅝', '7/8': '⅞' };
function fractions(s) {
  return s
    .replace(/(\d) (\d)\/(\d)(?![\d/])/g, (m, w, a, b) => (FRACTIONS[`${a}/${b}`] ? w + FRACTIONS[`${a}/${b}`] : m))
    .replace(/(^|[^\d/])(\d)\/(\d)(?![\d/])/g, (m, pre, a, b) => (FRACTIONS[`${a}/${b}`] ? pre + FRACTIONS[`${a}/${b}`] : m));
}

// Inline Markdown -> HTML: **bold**, <b>bold</b> (Notion exports these), *italic*, [text](url).
function inline(raw) {
  let s = raw.replace(/<\/?b>/g, '**').replace(/<\/?strong>/g, '**');
  s = esc(fractions(s));
  s = s.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '$1');
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/(^|\W)\*(.+?)\*(?=\W|$)/g, '$1<em>$2</em>');
  return s;
}

function parseRecipe(text, file) {
  const r = { file, title: '', description: '', meta: {}, ingredients: [], steps: [], notes: [] };
  let section = 'head';
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    let m;
    if ((m = t.match(/^#\s+(.*)$/))) { r.title = m[1].replace(/^\P{L}+/u, '').trim(); continue; }
    if ((m = t.match(/^##\s+(.*)$/))) {
      const h = m[1].toLowerCase();
      section = /ingredient/.test(h) ? 'ingredients' : /step|direction|instruction|method/.test(h) ? 'steps' : /note|tip/.test(h) ? 'notes' : 'skip';
      continue;
    }
    if (section === 'skip') continue;
    if ((m = t.match(/^###\s+(.*)$/))) { if (r[section]) r[section].push({ heading: m[1] }); continue; }
    const item = t.replace(/^([-*]|\d+[.)])\s+/, '');
    if (section === 'head') {
      if ((m = item.match(/^([A-Za-z ]{2,14}):\s*(.*)$/)) && t !== item) {
        const key = m[1].trim().toLowerCase();
        const link = m[2].match(/\[([^\]]+)\]\((https?:[^)\s]+)\)/);
        if (key === 'source' && link) { r.meta.source = link[2]; r.meta.site = r.meta.site || link[1]; }
        else r.meta[key] = m[2].trim();
      } else r.description += (r.description ? ' ' : '') + item.replace(/^>\s*/, '');
    } else r[section].push({ text: item });
  }
  const need = [['title', r.title], ['Source', r.meta.source], ['Author', r.meta.author], ['ingredients', r.ingredients.length], ['steps', r.steps.length]];
  const missing = need.filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) throw new Error(`${file}: missing ${missing.join(', ')}`);
  return r;
}

// ---------- rendering ----------

function list(items, tag) {
  let html = '', open = false;
  for (const it of items) {
    if (it.heading) {
      if (open) { html += `</${tag}>`; open = false; }
      html += `<h3>${inline(it.heading)}</h3>`;
    } else {
      if (!open) { html += `<${tag}>`; open = true; }
      html += `<li>${inline(it.text)}</li>`;
    }
  }
  return html + (open ? `</${tag}>` : '');
}

async function sheet(r, i) {
  const m = r.meta;
  const qr = await QRCode.toString(m.source, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' });
  const facts = [['Serves', m.serves], ['Yield', m.yield || m.makes], ['Time', m.time], ['Oven', m.oven], ['Equipment', m.equipment]]
    .filter(([, v]) => v)
    .map(([k, v]) => `<div class="fact"><dt>${k}</dt><dd>${inline(v)}</dd></div>`).join('');
  const shortUrl = m.source.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
  return `
<article class="sheet" id="r${i}" data-file="${esc(r.file)}">
  <header>
    ${m.category ? `<p class="eyebrow">${inline(m.category)}</p>` : ''}
    <h1>${inline(r.title)}</h1>
    ${r.description ? `<p class="desc">${inline(r.description)}</p>` : ''}
    <p class="byline">Recipe by <strong>${inline(m.author)}</strong>${m.site ? ` <span class="dot">·</span> ${inline(m.site)}` : ''}</p>
  </header>
  ${facts ? `<dl class="facts">${facts}</dl>` : ''}
  <div class="body">
    <section class="ingredients"><h2>Ingredients</h2>${list(r.ingredients, 'ul')}</section>
    <section class="method">
      <h2>Steps</h2>${list(r.steps, 'ol')}
      ${r.notes.length ? `<div class="notes"><h2>Notes</h2>${list(r.notes, 'ul')}</div>` : ''}
    </section>
  </div>
  <div class="ours"><span>Our notes</span></div>
  <footer>
    <div class="qr">${qr}</div>
    <div class="src">
      <span class="label">Original recipe</span>
      <span class="url">${esc(shortUrl)}</span>
      <span class="credit">${inline(m.author)}${m.site ? `, ${inline(m.site)}` : ''}. Scan the code to open the original page.</span>
    </div>
  </footer>
</article>`;
}

function fontFace(pkg, file, family, weight, style) {
  const p = path.join(ROOT, 'node_modules', '@fontsource', pkg, 'files', file);
  const b64 = fs.readFileSync(p).toString('base64');
  return `@font-face{font-family:"${family}";font-weight:${weight};font-style:${style};src:url(data:font/woff2;base64,${b64}) format("woff2")}`;
}

function css() {
  const fonts = [
    fontFace('source-serif-4', 'source-serif-4-latin-400-normal.woff2', 'Source Serif 4', 400, 'normal'),
    fontFace('source-serif-4', 'source-serif-4-latin-400-italic.woff2', 'Source Serif 4', 400, 'italic'),
    fontFace('source-serif-4', 'source-serif-4-latin-600-normal.woff2', 'Source Serif 4', 600, 'normal'),
    fontFace('source-serif-4', 'source-serif-4-latin-700-normal.woff2', 'Source Serif 4', 700, 'normal'),
    fontFace('inter', 'inter-latin-500-normal.woff2', 'Inter', 500, 'normal'),
    fontFace('inter', 'inter-latin-700-normal.woff2', 'Inter', 700, 'normal'),
  ].join('\n');
  return fonts + fs.readFileSync(path.join(ROOT, 'recipe.css'), 'utf8');
}

// ---------- build ----------

(async () => {
  const filter = process.argv[2];
  const files = fs.readdirSync(SRC).filter((f) => f.endsWith('.md') && !f.startsWith('_') && (!filter || f.includes(filter))).sort();
  if (!files.length) { console.error('No recipes matched.'); process.exit(1); }
  const recipes = files.map((f) => parseRecipe(fs.readFileSync(path.join(SRC, f), 'utf8'), f));
  recipes.sort((a, b) => a.title.localeCompare(b.title));
  const sheets = (await Promise.all(recipes.map(sheet))).join('\n');
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Recipe Book</title><style>${css()}</style></head><body>${sheets}</body></html>`;

  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);

  // Fit each recipe: step the type down until it sits on one page; fall back to two pages.
  const fits = await page.evaluate(({ MAX_PT, MIN_PT, TWO_PAGE_PT }) => {
    return [...document.querySelectorAll('.sheet')].map((el) => {
      const overflows = () => el.scrollHeight > el.clientHeight + 1;
      let pt = MAX_PT;
      el.style.fontSize = pt + 'pt';
      while (overflows() && pt > MIN_PT) { pt = Math.round((pt - 0.25) * 100) / 100; el.style.fontSize = pt + 'pt'; }
      let pages = 1;
      if (overflows()) { pages = 2; pt = TWO_PAGE_PT; el.style.fontSize = pt + 'pt'; el.classList.add('long'); }
      const ours = el.querySelector('.ours');
      if (ours.getBoundingClientRect().height < 56) ours.classList.add('none');
      return { file: el.dataset.file, pt, pages };
    });
  }, { MAX_PT, MIN_PT, TWO_PAGE_PT });

  const pdfOpts = { format: 'Letter', printBackground: true, margin: { top: 0, right: 0, bottom: 0, left: 0 }, preferCSSPageSize: true };
  await page.pdf({ ...pdfOpts, path: path.join(OUT, 'recipe-book.pdf') });
  fs.writeFileSync(path.join(OUT, 'recipe-book.html'), await page.content());
  for (let i = 0; i < recipes.length; i++) {
    await page.evaluate((id) => document.querySelectorAll('.sheet').forEach((s) => { s.hidden = s.id !== id; }), `r${i}`);
    await page.pdf({ ...pdfOpts, path: path.join(OUT, recipes[i].file.replace(/\.md$/, '.pdf')) });
  }
  await browser.close();
  for (const f of fits) console.log(`${f.file.padEnd(40)} ${f.pages} page${f.pages > 1 ? 's' : ''} at ${f.pt}pt`);
})().catch((e) => { console.error(e.message); process.exit(1); });
