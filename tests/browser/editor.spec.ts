import { test, expect } from '@playwright/test';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type AddressInfo } from 'node:net';
import { once } from 'node:events';
import { strings } from '../../src/shared/strings.js';

let root: string, base: string, server: ChildProcess;
const credentials = { username: 'browser', password: 'browser-test-password' };
test.use({ httpCredentials: credentials });

test.beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'folume-browser-'));
  await mkdir(path.join(root, 'notes'));
  await writeFile(path.join(root, 'notes/example.md'), '# Una nota tranquilla\n\nLa prima frase.\n\n- [ ] Un piccolo compito\n');
  await writeFile(path.join(root, 'conflict.md'), '# Conflitto\n\nOriginale.\n');
  const portServer = createServer().listen(0, '127.0.0.1');
  await once(portServer, 'listening');
  const port = (portServer.address() as AddressInfo).port;
  await new Promise<void>(resolve => portServer.close(() => resolve()));
  base = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ['dist/server/index.js'], {
    cwd: process.cwd(), env: { ...process.env, NODE_ENV: 'production', MARKDOWN_ROOT: root, HOST: '127.0.0.1', PORT: String(port), AUTH_MODE: 'basic', AUTH_USER: credentials.username, AUTH_PASSWORD: credentials.password },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  server.stdout?.on('data', chunk => { output += chunk; });
  server.stderr?.on('data', chunk => { output += chunk; });
  await expect.poll(async () => {
    if (server.exitCode !== null) throw new Error(output);
    try { return (await fetch(base)).status; } catch { return 0; }
  }).toBe(401);
});

test.afterAll(async () => {
  if (server && server.exitCode === null) { server.kill('SIGTERM'); await once(server, 'exit'); }
  if (root) await rm(root, { recursive: true, force: true });
});

test('milestone: visual edit, autosave, external update, terminal creation and GUI CRUD', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base);
  await page.getByRole('button', { name: 'notes', exact: true }).click();
  await page.getByRole('button', { name: 'example.md', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Una nota tranquilla' })).toBeVisible();
  const content = page.locator('.tiptap');
  await content.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Una frase dal browser.');
  await expect.poll(() => readFile(path.join(root, 'notes/example.md'), 'utf8')).toContain('Una frase dal browser.');
  await expect(page.getByRole('status')).toHaveText(strings.saveStatus.saved);
  await writeFile(path.join(root, 'notes/example.md'), '# Aggiornato fuori\n\nModifica esterna.\n');
  await expect(page.getByRole('heading', { name: 'Aggiornato fuori' })).toBeVisible();
  await writeFile(path.join(root, 'notes/terminal.md'), '# Dal terminale\n');
  await expect(page.getByRole('button', { name: 'terminal.md', exact: true })).toBeVisible();
  page.once('dialog', dialog => dialog.accept('notes/gui.md'));
  await page.getByRole('button', { name: strings.sidebar.newFile, exact: true }).click();
  await expect(page).toHaveURL(/file=notes%2Fgui.md/);
  await expect.poll(() => readFile(path.join(root, 'notes/gui.md'), 'utf8')).toBe('\n');
  page.once('dialog', dialog => dialog.accept('notes/renamed.md'));
  await page.getByRole('button', { name: strings.sidebar.renameSelection }).click();
  await expect(page).toHaveURL(/file=notes%2Frenamed.md/);
  await expect(page.getByRole('button', { name: 'renamed.md', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'notes', exact: true }).click();
  page.once('dialog', dialog => dialog.accept('renamed-folder'));
  await page.getByRole('button', { name: strings.sidebar.renameSelection }).click();
  await expect(page).toHaveURL(/file=renamed-folder%2Frenamed.md/);
  await expect.poll(() => readFile(path.join(root, 'renamed-folder/renamed.md'), 'utf8')).toBe('\n');
  await page.getByRole('button', { name: 'renamed.md', exact: true }).click();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: strings.sidebar.deleteSelection }).click();
  await expect(page.getByRole('alert')).toContainText(strings.session.fileMissing);
  await expect(page.getByRole('button', { name: strings.conflict.download })).toBeVisible();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'example.md', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Aggiornato fuori' })).toBeVisible();
  await page.screenshot({ path: info.outputPath('folume.png'), fullPage: true });
  expect(errors).toEqual([]);
});

test('external conflict preserves dirty text; explicit overwrite and source mode retain Markdown', async ({ page }) => {
  await page.goto(`${base}/?file=conflict.md`);
  await expect(page.getByRole('heading', { name: 'Conflitto', exact: true })).toBeVisible();
  await page.getByRole('button', { name: strings.workspace.source, exact: true }).click();
  const source = page.getByRole('textbox', { name: strings.workspace.sourceEditorLabel });
  await source.fill('# Versione locale\n\nDa conservare.\n');
  await writeFile(path.join(root, 'conflict.md'), '# Versione esterna\n');
  await expect(page.getByRole('status')).toHaveText(strings.saveStatus.conflict);
  await expect(source).toHaveValue('# Versione locale\n\nDa conservare.\n');
  expect(await readFile(path.join(root, 'conflict.md'), 'utf8')).toBe('# Versione esterna\n');
  await page.getByRole('button', { name: strings.conflict.keepLocal, exact: true }).click();
  await expect(page.getByRole('alert')).toContainText(strings.conflict.localKept);
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: strings.conflict.overwrite }).click();
  await expect(page.getByRole('status')).toHaveText(strings.saveStatus.saved);
  expect(await readFile(path.join(root, 'conflict.md'), 'utf8')).toBe('# Versione locale\n\nDa conservare.\n');
  await page.getByRole('button', { name: strings.workspace.visual, exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Versione locale' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Versione locale' })).toBeVisible();
});

test('local images retain relative Markdown URLs and links open sibling notes', async ({ page }) => {
  await mkdir(path.join(root, 'assets'), { recursive: true });
  await writeFile(path.join(root, 'assets/pixel.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64'));
  await writeFile(path.join(root, 'links.md'), '# Links\n\n![Pixel](assets/pixel.png)\n\n[Altra nota](conflict.md)\n');
  await page.goto(`${base}/?file=links.md`);
  const image = page.getByRole('img', { name: 'Pixel' });
  await expect(image).toHaveAttribute('src', '/api/assets?path=assets%2Fpixel.png');
  await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(1);
  await page.getByRole('link', { name: 'Altra nota' }).click({ modifiers: ['Control'] });
  await expect(page).toHaveURL(/file=conflict.md/);
  expect(await readFile(path.join(root, 'links.md'), 'utf8')).toContain('![Pixel](assets/pixel.png)');
});
