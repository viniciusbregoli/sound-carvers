// Captures screenshots of the demo Sound Carvers instance for the tutorial video.
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const BASE = 'http://127.0.0.1:18791';
const OUT = process.argv[2] ?? new URL('../public/shots', import.meta.url).pathname;
const only = process.argv[3];
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ args: ['--lang=pt-BR'], env: { ...process.env, LANG: 'pt_BR.UTF-8', LANGUAGE: 'pt_BR:pt' }, executablePath: process.env.CHROME_PATH ?? `${process.env.HOME}/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome` });
const desktop = { viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', colorScheme: 'dark' };
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
const BOXES = `${OUT}/../boxes.json`;
const boxes = existsSync(BOXES) ? JSON.parse(readFileSync(BOXES, 'utf8')) : {};
/** Screenshot plus the rects of named elements, normalized to the viewport (0..1). */
const shot = async (page, name, opts = {}) => {
  if (only && !name.startsWith(only)) return;
  await page.waitForTimeout(opts.wait ?? 700);
  await page.screenshot({ path: `${OUT}/${name}.png`, ...opts.shot });
  const vp = page.viewportSize();
  const rects = {};
  for (const [key, loc] of Object.entries(opts.boxes ?? {})) {
    const b = await (typeof loc === 'string' ? page.locator(loc) : loc).first().boundingBox();
    if (b) rects[key] = { x: b.x / vp.width, y: b.y / vp.height, w: b.width / vp.width, h: b.height / vp.height };
    else console.warn('  no box for', name, key);
  }
  boxes[name] = rects;
  writeFileSync(BOXES, JSON.stringify(boxes, null, 2));
  console.log('shot', name, Object.keys(rects).join(','));
};

async function login(context, member = 'Vini', capture = false) {
  const page = await context.newPage();
  await page.goto(BASE + '/');
  await page.locator('input[type=password]').waitFor();
  if (capture) await shot(page, '01-login');
  await page.locator('input[type=password]').fill('demo-ensaio-2026');
  if (capture) await shot(page, '01b-login-filled', { wait: 200 });
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.getByRole('button', { name: new RegExp(`^${member}`) }).first().waitFor();
  if (capture) await shot(page, '02-whoami');
  await page.getByRole('button', { name: new RegExp(`^${member}`) }).first().click();
  await page.locator('.board, .column').first().waitFor();
  return page;
}


// Every run starts from the pristine demo data.
import { execFileSync } from 'node:child_process';
execFileSync(new URL('./run-server.sh', import.meta.url).pathname);

const ctx = await browser.newContext(desktop);
const page = await login(ctx, 'Vini', true);
await shot(page, '03-board', { wait: 1500, boxes: { todo: '.column.stage-todo', learning: '.column.stage-learning', shaky: '.column.stage-shaky', ready: '.column.stage-ready', filter: page.getByText('Só as que eu não domino'), dani: '[aria-label^="Dani California"]' } });

// Quick-add with autocomplete
await page.locator('.quick-add-btn').nth(2).click();
await page.locator('.quick-add input').first().pressSequentially('sweet child', { delay: 60 });
await page.locator('.combo-list li').first().waitFor({ timeout: 10000 });
await shot(page, '04-quickadd', { wait: 1500, boxes: { input: '.quick-add input', list: '.combo-list', first: '.combo-list li' } });
await page.keyboard.press('Escape');
await page.keyboard.press('Escape');

// Song sheet
await page.mouse.click(5, 5);
await page.getByText('Dani California', { exact: true }).first().click();
const sheet = page.locator('dialog.song-sheet[open]');
await sheet.waitFor();
await shot(page, '05-sheet-top', { wait: 1200, boxes: { sheet: 'dialog.song-sheet[open] .dialog-panel', stages: '.segmented-stages', confidence: '[aria-labelledby="confidence-title"]' } });
const body = sheet.locator('.dialog-body').first();
const scrollTo = async (sel) => body.evaluate((el, sel) => {
  const t = el.querySelector(sel);
  el.scrollTop = t.offsetTop - 24;
}, sel);
await scrollTo('[aria-labelledby="details-title"]');
await shot(page, '06-sheet-details', { boxes: { sheet: 'dialog.song-sheet[open] .dialog-panel', details: '[aria-labelledby="details-title"]', links: '[aria-labelledby="links-title"]' } });
await scrollTo('[aria-labelledby="parts-title"]');
await shot(page, '07-sheet-parts', { boxes: { sheet: 'dialog.song-sheet[open] .dialog-panel', parts: '[aria-labelledby="parts-title"]' } });
await page.keyboard.press('Escape');

// Everyone says Domino: Julio rates Everlong last
const julioCtx = await browser.newContext(desktop);
const julio = await login(julioCtx, 'Julio');
await julio.getByText('Everlong', { exact: true }).first().click();
const js = julio.locator('dialog.song-sheet[open]');
await js.waitFor();
await js.locator('.dialog-body').first().evaluate((el) => { el.scrollTop = el.querySelector('[aria-labelledby="confidence-title"]').offsetTop - 24; });
await julio.waitForTimeout(300);
await js.locator('label.segment.level-3').hover();
await shot(julio, '08-domino-before', { wait: 800, boxes: { sheet: 'dialog.song-sheet[open] .dialog-panel', confidence: '[aria-labelledby="confidence-title"]', domino: 'label.segment.level-3' } });
await js.locator('label.segment.level-3').click();
await shot(julio, '08-domino-after', { wait: 900, boxes: { sheet: 'dialog.song-sheet[open] .dialog-panel', confidence: '[aria-labelledby="confidence-title"]', domino: 'label.segment.level-3', toast: '.toast' } });
await julio.keyboard.press('Escape');
await shot(julio, '09-domino-board', { wait: 900, boxes: { ready: '.column.stage-ready', everlong: '[aria-label^="Everlong"]', toast: '.toast' } });
await julioCtx.close();

// Setlists
await page.reload();
await page.locator('.column').first().waitFor();
await page.getByRole('link', { name: 'Setlists' }).click();
await shot(page, '10-setlists', { wait: 1000, boxes: { show: page.getByText('Show no Bar do Zé') } });
await page.getByText('Show no Bar do Zé').first().click();
await shot(page, '11-setlist-editor', { wait: 1200, boxes: { summary: '.editor-summary', retune: '.retune', stageBtn: page.getByText('Modo palco'), picker: page.getByText('Adicionar músicas') } });
await page.mouse.wheel(0, 600);
await shot(page, '11b-setlist-editor-scrolled', { wait: 800 });
await page.getByText('Modo palco').first().click();
await shot(page, '12-stage', { wait: 1500, boxes: { song: '.stage-song', facts: '.stage-facts', parts: '.stage-parts', next: '.stage-next' } });
await page.getByRole('button', { name: 'Próxima' }).click();
await shot(page, '12b-stage-next', { wait: 1200, boxes: { song: '.stage-song', facts: '.stage-facts', parts: '.stage-parts', next: '.stage-next' } });
await page.getByRole('button', { name: 'Setlist inteiro' }).click();
await shot(page, '13-stage-overview', { wait: 1000 });
await page.getByRole('button', { name: 'Sair do modo palco' }).click();

// Band
await page.getByRole('link', { name: 'Banda' }).first().click();
await shot(page, '14-band', { wait: 1000, boxes: { members: page.getByText('Integrantes', { exact: true }), activity: page.getByText('Atividade recente') } });

// Phone
const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', colorScheme: 'dark' });
const mp = await login(phone, 'Vini');
await shot(mp, '15-phone-board', { wait: 1500 });
await mp.getByRole('link', { name: 'Setlists' }).first().click();
await mp.getByText('Show no Bar do Zé').first().click();
await mp.getByText('Modo palco').first().click();
await shot(mp, '16-phone-stage', { wait: 1500 });
await phone.close();

await browser.close();
