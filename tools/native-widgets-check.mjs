import {chromium} from 'playwright-core';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const root=process.cwd(),out=`${root}/artifacts/code-style`;
await fs.mkdir(out,{recursive:true});
const browser=await chromium.connectOverCDP('http://127.0.0.1:9223');
const page=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().includes('tauri.localhost'));
assert.ok(page);const errors=[];page.on('pageerror',e=>errors.push(e.message));
const status=()=>page.evaluate(()=>window.__TAURI__.core.invoke('host_status'));
const phase=process.argv[2]||'exercise';
try {
  await page.waitForFunction(()=>Boolean(window.asciiCity));
  await page.waitForFunction(()=>document.getElementById('weatherTemp').textContent!=='—',null,{timeout:30000});
  const initial=await status();assert.equal(initial.version,'0.4.0');assert.equal(initial.config.density,9);assert.ok(initial.metrics.cols>400);
  assert.equal(initial.config.weatherCity,'system');assert.equal(initial.metrics.rejectedEvents,0);
  const weather=page.locator('[data-widget=weather]'),agents=page.locator('[data-widget=agents]');
  if(phase==='exercise') {
    await fs.writeFile(`${out}/original-widget-positions.json`,JSON.stringify(initial.config.widgetPositions,null,2));
    const temp={...initial.config,pauseWhenCovered:false};
    await page.evaluate(config=>window.__TAURI__.core.invoke('host_config',{config}),temp);
    await page.evaluate(()=>window.__TAURI__.core.invoke('host_command',{command:'resume'}));
    await page.waitForTimeout(800);await page.screenshot({path:`${out}/native-wallpaper.png`});
    await page.evaluate(()=>window.__TAURI__.core.invoke('host_command',{command:'interactive'}));
    await page.locator('#layoutBtn').click();
    const originalAgent=await agents.boundingBox();
    async function drag(widget,dx,dy){const b=await widget.locator('.widget-handle').boundingBox();await page.mouse.move(b.x+70,b.y+12);await page.mouse.down();await page.mouse.move(b.x+70+dx,b.y+12+dy,{steps:10});await page.mouse.up();}
    await drag(weather,250,160);
    assert.ok(Math.abs((await agents.boundingBox()).x-originalAgent.x)<1);
    await drag(agents,470,190);
    await weather.locator('.widget-handle').focus();const before=(await weather.boundingBox()).x;
    await page.keyboard.press('Shift+ArrowRight');assert.ok(Math.abs((await weather.boundingBox()).x-before-10)<1);
    await page.waitForTimeout(250);const after=await status();
    const disk=JSON.parse(await fs.readFile(`${root}/outputs/AsciiCity-Wallpaper/data/settings.json`,'utf8'));
    assert.deepEqual(disk.widgetPositions,after.config.widgetPositions);
    await fs.writeFile(`${out}/expected-widget-positions.json`,JSON.stringify({positions:after.config.widgetPositions,weather:await weather.boundingBox(),agents:await agents.boundingBox(),pauseWhenCovered:initial.config.pauseWhenCovered},null,2));
    await page.screenshot({path:`${out}/native-layout-editor.png`});
    await page.locator('#layoutDone').click();
    // Keep settings coherent with the UI's current copy before the restart.
    const latest=await status();latest.config.pauseWhenCovered=initial.config.pauseWhenCovered;
    await page.evaluate(config=>window.__TAURI__.core.invoke('host_config',{config}),latest.config);
    await page.evaluate(()=>window.__TAURI__.core.invoke('host_command',{command:'wallpaper'}));
    console.log(JSON.stringify({independentDragging:true,keyboardNudge:true,savedToPortableSettings:true,positions:after.config.widgetPositions,grid:initial.metrics.cols+'x'+initial.metrics.rows,errors},null,2));
  }else{
    const expected=JSON.parse(await fs.readFile(`${out}/expected-widget-positions.json`,'utf8'));
    assert.deepEqual(initial.config.widgetPositions,expected.positions);
    const w=await weather.boundingBox(),a=await agents.boundingBox();
    for(const [actual,saved] of [[w,expected.weather],[a,expected.agents]])assert.ok(Math.abs(actual.x-saved.x)<2&&Math.abs(actual.y-saved.y)<2);
    await page.screenshot({path:`${out}/native-restored-layout.png`});
    const original=JSON.parse(await fs.readFile(`${out}/original-widget-positions.json`,'utf8'));
    const config={...initial.config,widgetPositions:original,pauseWhenCovered:expected.pauseWhenCovered};
    await page.evaluate(config=>window.__TAURI__.core.invoke('host_config',{config}),config);
    const report={persistedAfterRestart:true,independentDragging:true,keyboardNudge:true,restoredUserLayout:true,weatherCity:config.weatherCity,grid:{cols:initial.metrics.cols,rows:initial.metrics.rows},errors};
    await fs.writeFile(`${out}/native-widget-report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
  }
  assert.deepEqual(errors,[]);process.exit(0);
}catch(e){console.error(e);process.exit(1);}
