import {chromium} from 'playwright-core';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const root=process.cwd(),out=`${root}/artifacts/native-v03`;
await fs.mkdir(out,{recursive:true});
const runtime=JSON.parse(await fs.readFile(`${root}/outputs/AsciiCity-Wallpaper/data/runtime.json`,'utf8'));
const headers={Authorization:`Bearer ${runtime.token}`};
const status=async()=>{const r=await fetch(`http://127.0.0.1:${runtime.port}/status`,{headers,signal:AbortSignal.timeout(5000)});return r.json();};
const browser=await chromium.connectOverCDP('http://127.0.0.1:9223');
const page=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().includes('tauri.localhost'));
assert.ok(page);
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const mode=process.argv[2]||'baseline';
try {
  await page.waitForFunction(()=>Boolean(window.asciiCity));
  await page.waitForFunction(()=>!document.getElementById('nogl').hidden?false:document.getElementById('weatherTemp').textContent!=='—',null,{timeout:45000});
  const current=await status();
  assert.match(current.version,/^0\.(3|4)\./);assert.equal(current.metrics.rejectedEvents,0);assert.ok(current.parent!==0);
  const exported=await page.evaluate(()=>window.asciiCity.export());
  const events=exported.trim().split('\n').slice(1).map(s=>JSON.parse(s));
  assert.ok(events.some(e=>e.type==='weather.real'));
  assert.ok(events.some(e=>e.type==='agent.tool'&&e.src==='codex'));
  assert.ok(!events.some(e=>e.session?.startsWith('demo-')));
  const recentTools=events.filter(e=>e.type==='agent.tool').map(e=>({src:e.src,kind:e.data.kind,ts:e.ts}));
  const weather=events.filter(e=>e.type==='weather.real').at(-1).data;
  assert.ok(Date.now()-weather.observedAt<3600000);
  const hud=await page.locator('#agentFeed').innerText();
  assert.match(hud,/Codex/);assert.match(hud,/实际工具活动/);
  const summary={version:current.version,counters:current.counters,metrics:current.metrics,sources:current.sources,weather,toolKinds:[...new Set(recentTools.map(e=>e.kind))],lastTool:recentTools.at(-1),hud,errors};
  if(mode==='witness') {
    const baseline=JSON.parse(await fs.readFile(`${out}/baseline.json`,'utf8'));
    assert.ok(current.counters['agent.tool']>baseline.counters['agent.tool'],'Real tool counter did not increase');
    assert.ok(recentTools.some(e=>e.kind==='edit'&&e.ts>baseline.lastTool.ts),'The real file edit was not delivered to the page');
    summary.realEditObserved=true;
  }
  await fs.writeFile(`${out}/${mode}.json`,JSON.stringify(summary,null,2));
  if(mode==='final') {
    const config=structuredClone(current.config);
    try {
      await page.evaluate(config=>window.__TAURI__.core.invoke('host_config',{config:{...config,pauseWhenCovered:false}}),config);
      await page.evaluate(()=>window.__TAURI__.core.invoke('host_command',{command:'resume'}));
      await page.waitForTimeout(1500);
      await page.screenshot({path:`${out}/wallpaper.png`});
      await page.evaluate(()=>window.__TAURI__.core.invoke('host_command',{command:'interactive'}));
      await page.waitForTimeout(1500);
      await page.screenshot({path:`${out}/console.png`});
      await page.locator('#nativeGroup summary').click();
      await page.locator('#weatherLocationMode').selectOption('fixed');
      await page.locator('#weatherCity').fill('南京');
      await page.locator('#weatherCityForm button').click();
      await page.waitForFunction(()=>document.getElementById('weatherCityLabel').textContent.includes('南京'),null,{timeout:45000});
      const cityStatus=await status();
      assert.equal(cityStatus.config.weatherCity,'南京');
      await fs.writeFile(`${out}/fixed-city.json`,JSON.stringify({city:await page.locator('#weatherCityLabel').textContent(),source:cityStatus.sources.weather},null,2));
      await page.locator('[data-source=weather]').uncheck();
      await page.waitForFunction(()=>document.getElementById('weatherCondition').textContent==='系统气候',null,{timeout:10000});
    } finally {
      await page.locator('#nativeGroup').evaluate(el=>{el.open=true;});
      await page.locator('[data-source=weather]').setChecked(config.weather);
      const mode=['auto','system'].includes(config.weatherCity)?config.weatherCity:'fixed';
      await page.locator('#weatherLocationMode').selectOption(mode);
      if(mode==='fixed')await page.locator('#weatherCity').fill(config.weatherCity);
      await page.locator('#weatherCityForm').evaluate(form=>form.requestSubmit());
      await page.evaluate(config=>window.__TAURI__.core.invoke('host_config',{config}),config);
      await page.evaluate(()=>window.__TAURI__.core.invoke('host_command',{command:'wallpaper'}));
    }
  }
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify(summary,null,2));process.exit(0);
}catch(error){console.error(error);process.exit(1);}
