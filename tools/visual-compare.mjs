import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const root = process.cwd(), directory = path.join(root, 'artifacts', 'comparison');
await fs.mkdir(directory, { recursive: true });
const original = await fs.readFile(path.join(root, 'reference/ascii-city.html'), 'utf8');
const fixture = original.replace(/start\(\);\r?\n\}\)\(\);/, `window.__prototype = { render(scene) {
  S.scene=scene; S.hour=20.5; S.flow='stop'; W=null; rebuild();
  W=createWorld(G.cols,G.rows,SEED,scene); W.hourNow=S.hour;
  compose(W,S);
  gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,texA);gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,W.cols,W.rows,gl.RGBA,gl.UNSIGNED_BYTE,W.A);
  gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,texB);gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,W.cols,W.rows,gl.RGBA,gl.UNSIGNED_BYTE,W.B);
  gl.uniform1i(U.uMode,0);gl.drawArrays(gl.TRIANGLES,0,3);
  document.getElementById('panel').hidden=true; document.getElementById('wake').hidden=true;
  return {a:Array.from(W.A),b:Array.from(W.B)};
} };\n})();`);
assert.ok(fixture !== original, 'Could not instrument the reference fixture');
const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--no-first-run', '--disable-background-networking'] });
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, colorScheme: 'dark' });
await context.route('https://**', route => route.abort());
await context.addInitScript(() => { window.requestAnimationFrame = () => 0; });
const page = await context.newPage(), reference = await context.newPage();
await reference.route('**/reference-fixture.html', route => route.fulfill({ body: fixture, contentType: 'text/html' }));
const result = {};
try {
  await reference.goto('http://127.0.0.1:4173/reference-fixture.html');
  await reference.waitForFunction(() => Boolean(window.__prototype));
  for (const scene of ['bund', 'nyc', 'hk']) {
    await page.goto(process.env.CITY_URL || 'http://127.0.0.1:4173/?qa=1');
    await page.waitForFunction(() => Boolean(window.__city));
    const before = await reference.evaluate(scene => window.__prototype.render(scene), scene);
    const after = await page.evaluate(scene => {
      const active = window.__city.engine();
      const config = { ...active.config, settings: { ...active.config.settings, scene, effects:0, waterMode:'mirror' } };
      const empty = new active.constructor(config, []);
      active.world = empty.world; active.settings = empty.settings;
      window.__city.setMode(false); window.__city.paint();
      document.getElementById('wake').hidden = true;
      return { a: Array.from(active.world.A), b: Array.from(active.world.B) };
    }, scene);
    assert.deepEqual(after.a, before.a, `${scene}: foreground/glyph buffer changed`);
    assert.deepEqual(after.b, before.b, `${scene}: background/glyph buffer changed`);
    await reference.locator('#world').screenshot({ path: path.join(directory, `${scene}-prototype.png`) });
    await page.locator('#world').screenshot({ path: path.join(directory, `${scene}-typescript.png`) });
    const hash = createHash('sha256').update(Buffer.from(after.a)).update(Buffer.from(after.b)).digest('hex');
    result[scene] = { buffersIdentical: true, hash, cols: 214, rows: 60 };
  }
  await fs.writeFile(path.join(directory, 'comparison-report.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally { await context.close(); await browser.close(); }
