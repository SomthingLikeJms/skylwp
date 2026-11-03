import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const out = `${process.cwd()}/artifacts/climate-water`, phase = process.argv[2] || 'exercise';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
const page = browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().includes('tauri.localhost'));
assert.ok(page); const errors=[]; page.on('pageerror',e=>errors.push(e.message));
const invoke = (command,args={})=>page.evaluate(({command,args})=>window.__TAURI__.core.invoke(command,args),{command,args});
const status = ()=>invoke('host_status');
const ids={cloud:'cloudThreshold',rain:'rainThreshold',storm:'stormThreshold',memoryFog:'fogThreshold',responseSeconds:'weatherResponse',holdSeconds:'weatherHold'};
async function climate(mode, thresholds) {
  await page.locator('#weatherMode').selectOption(mode);
  for(const [key,id] of Object.entries(ids)) await page.locator(`#${id}`).fill(String(thresholds[key]*(['responseSeconds','holdSeconds'].includes(key)?1:100)));
  await page.locator('#weatherApply').click();
  await page.waitForTimeout(250);
  assert.deepEqual((await status()).config.weatherThresholds,thresholds);
}
async function water(config) {
  await page.locator('#waterMode').selectOption(config.waterMode);
  await page.locator('#waterSource').selectOption(config.waterSource);
  await page.locator('#waterStrength').evaluate((input,value)=>{input.value=String(value*100);input.dispatchEvent(new Event('change',{bubbles:true}));},config.waterStrength);
  await page.waitForTimeout(200);
}
async function restore(original) {
  await invoke('host_command',{command:'interactive'});
  await page.waitForFunction(()=>document.body.classList.contains('live'));
  await water(original);
  await climate(original.weatherMode,original.weatherThresholds);
  const final=(await status()).config;
  for(const key of ['widgetPositions','effects','density','weatherCity','scene','theme','privacy','waterMode','waterSource','waterStrength','weatherMode','weatherThresholds']) assert.deepEqual(final[key],original[key],`Preference changed: ${key}`);
  await invoke('host_command',{command:'wallpaper'});
}
let original, keepTestConfig=false;
try {
  await page.waitForFunction(()=>Boolean(window.asciiCity));
  const initial=await status(); assert.equal(initial.version,'0.5.0'); assert.equal(initial.metrics.rejectedEvents,0);
  assert.equal(initial.config.weatherCity,'system');
  await invoke('host_command',{command:'interactive'});
  await page.waitForFunction(()=>document.body.classList.contains('live'));
  await page.waitForFunction(()=>!document.getElementById('weatherMoon').hidden,null,{timeout:30000});
  if(phase==='exercise') {
    original=structuredClone(initial.config);
    await fs.writeFile(`${out}/native-test-original-config.json`,JSON.stringify(original,null,2));
    const recording=(await page.evaluate(()=>window.asciiCity.export())).trim().split('\n').map(l=>JSON.parse(l));
    assert.ok(recording.some(e=>e.type==='sys.sample'&&e.src==='system'));
    assert.ok(recording.some(e=>e.type==='agent.session'&&['codex','claude-code'].includes(e.src)));
    assert.ok(!recording.some(e=>e.session?.startsWith('demo-')));
    const realWeather=recording.filter(e=>e.type==='weather.real').at(-1);
    assert.ok(realWeather); assert.ok(!('latitude' in realWeather.data));
    await water({...original,waterMode:'binary',waterSource:'cpu',waterStrength:.12});
    assert.equal((await status()).config.waterStrength,.12);
    const low={cloud:0,rain:.01,storm:.02,memoryFog:.95,responseSeconds:1,holdSeconds:0};
    await climate('load',low);
    await page.waitForFunction(()=>/本机负载：(?:多云|雨|雷暴)/.test(document.getElementById('climateStatus').textContent),null,{timeout:15000});
    await page.waitForTimeout(3500);
    const lowState=await page.locator('#climateStatus').textContent();
    await climate('load',{...low,cloud:.98,rain:.99,storm:1,memoryFog:1});
    await page.waitForFunction(()=>/本机负载：晴/.test(document.getElementById('climateStatus').textContent),null,{timeout:15000});
    const highState=await page.locator('#climateStatus').textContent();
    await water(original);
    const persisted={...original.weatherThresholds,responseSeconds:original.weatherThresholds.responseSeconds===9?10:9};
    await climate(original.weatherMode,persisted);
    const expected=(await status()).config;
    await fs.writeFile(`${out}/native-restart-expected-config.json`,JSON.stringify(expected,null,2));
    await page.screenshot({path:`${out}/native-controls.png`});
    await fs.writeFile(`${out}/native-climate-exercise.json`,JSON.stringify({version:initial.version,realInputs:true,actualWeather:realWeather.data,lowState,highState,expected,errors},null,2));
    assert.deepEqual(errors,[]); keepTestConfig=true;
    await invoke('host_command',{command:'wallpaper'});
    console.log(JSON.stringify({realInputs:true,actualWeatherCode:realWeather.data.code,lowState,highState,persistedResponse:persisted.responseSeconds,errors},null,2));
  } else {
    original=JSON.parse(await fs.readFile(`${out}/native-test-original-config.json`,'utf8'));
    const expected=JSON.parse(await fs.readFile(`${out}/native-restart-expected-config.json`,'utf8'));
    assert.deepEqual(initial.config,expected,'Settings did not survive a real process restart');
    assert.equal(Number(await page.locator('#weatherResponse').inputValue()),expected.weatherThresholds.responseSeconds);
    await restore(original);
    await page.waitForTimeout(1300);
    await page.screenshot({path:`${out}/native-final-wallpaper.png`});
    await page.locator('#weatherMoon').screenshot({path:`${out}/native-final-moon.png`});
    const final=await status(); assert.equal(final.mode,'wallpaper');assert.equal(final.metrics.rejectedEvents,0);assert.deepEqual(errors,[]);
    await fs.writeFile(`${out}/native-climate-verified.json`,JSON.stringify({restartPersisted:true,preferencesRestored:true,final,errors},null,2));
    console.log(JSON.stringify({restartPersisted:true,preferencesRestored:true,density:final.config.density,weatherCity:final.config.weatherCity,errors},null,2));
    original=null;
  }
} catch(error) { console.error(error); process.exitCode=1; }
finally { if(original&&!keepTestConfig) { try {await restore(original);}catch(e){console.error('Restore failed:',e);process.exitCode=1;} } }
process.exit(process.exitCode||0);
