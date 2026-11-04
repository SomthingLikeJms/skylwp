import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=process.cwd(), out=path.join(root,'artifacts/frontend');
const runtime=JSON.parse(await fs.readFile(path.join(root,'outputs/AsciiCity-Wallpaper/data/runtime.json'),'utf8'));
const request=async(route,body)=>{
  const r=await fetch('http://127.0.0.1:'+runtime.port+route,{headers:{Authorization:'Bearer '+runtime.token,'Content-Type':'application/json'},
    ...(body?{method:'POST',body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(8000)});
  assert.ok(r.ok); return r.json();
};
const browser=await chromium.connectOverCDP('http://127.0.0.1:9223');
const page=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().includes('tauri.localhost'));
assert.ok(page);
await page.waitForFunction(()=>window.asciiCity);
const phase=process.argv[2]||'exercise';
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const status=()=>request('/status'), command=c=>request('/command',{command:c});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const originalPath=path.join(out,'native-original-config.json');
try{
  const initial=await status();assert.equal(initial.version,'0.6.0');
  if(phase==='capture'){
    assert.equal(initial.mode,'wallpaper');assert.ok(initial.parent>0);
    await wait(1600);
    await page.screenshot({path:path.join(out,'native-wallpaper.png')});
    assert.deepEqual(errors,[]);
    console.log('Final native build captured in wallpaper mode.');
  }else if(phase==='exercise'){
    await fs.writeFile(originalPath,JSON.stringify(initial.config,null,2));
    await command('interactive');
    await page.waitForFunction(()=>document.body.classList.contains('live'));
    await page.locator('#layoutBtn').click();
    for(const id of ['weather','agents']){
      if(await page.locator(`[data-widget=${id}]`).isVisible()) await page.locator(`[data-widget-remove=${id}]`).click();
    }
    await page.locator('#widgetOpacity').fill('94');
    await page.locator('#widgetOpacity').dispatchEvent('change');
    await page.locator('#layoutDone').click();
    await wait(600);
    const saved=(await status()).config;
    assert.equal(saved.widgetAppearance.weather,false);assert.equal(saved.widgetAppearance.agents,false);
    assert.ok(Math.abs(saved.widgetAppearance.opacity-.06)<1e-8);
    assert.deepEqual(saved.widgetPositions,initial.config.widgetPositions);
    const disk=JSON.parse(await fs.readFile(path.join(root,'outputs/AsciiCity-Wallpaper/data/settings.json'),'utf8'));
    assert.deepEqual(disk.widgetAppearance,saved.widgetAppearance);
    await fs.writeFile(path.join(out,'native-expected-appearance.json'),JSON.stringify(saved.widgetAppearance));
    console.log('Native settings saved; awaiting restart to verify persistence.');
  }else{
    const expected=JSON.parse(await fs.readFile(path.join(out,'native-expected-appearance.json'),'utf8'));
    assert.deepEqual(initial.config.widgetAppearance,expected);
    assert.equal(await page.locator('[data-widget=weather]').isVisible(),false);
    assert.equal(await page.locator('[data-widget=agents]').isVisible(),false);
    const original=JSON.parse(await fs.readFile(originalPath,'utf8'));
    await command('interactive');await page.waitForFunction(()=>document.body.classList.contains('live'));
    await page.locator('#layoutBtn').click();
    for(const id of ['weather','agents']) await page.locator(`[data-widget-toggle=${id}]`).click();
    await page.screenshot({path:path.join(out,'native-editor.png')});
    await page.locator('#layoutDone').click();
    await request('/config',original);
    await page.reload();await page.waitForFunction(()=>window.asciiCity);
    await command('wallpaper');
    await wait(1600);
    const restored=await status();assert.deepEqual(restored.config,original);
    assert.equal(restored.metrics.rejectedEvents,0);
    await page.screenshot({path:path.join(out,'native-wallpaper.png')});
    assert.deepEqual(errors,[]);
    const report={version:restored.version,delete:true,addBack:true,persistedAfterProcessRestart:true,originalConfigRestored:true,
      mode:restored.mode,grid:{cols:restored.metrics.cols,rows:restored.metrics.rows},config:restored.config,errors};
    await fs.writeFile(path.join(out,'native-checks.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify({version:report.version,persistedAfterProcessRestart:true,originalConfigRestored:true,mode:report.mode,errors}));
  }
}finally{await browser.close();}
