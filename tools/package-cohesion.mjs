import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const root = process.cwd(),
  source = path.join(root, 'artifacts/cohesion');
const out = path.resolve(root, '../../outputs/Skylwp-0.9.1-preview');
await fs.mkdir(out, { recursive: true });
await fs.copyFile(path.join(root, 'outputs/ASCII城市预览.html'), path.join(out, 'Preview.html'));
await fs.copyFile(
  path.join(root, 'outputs/AsciiCity-Wallpaper.zip'),
  path.join(out, 'Skylwp-0.9.1-portable.zip'),
);
for (const version of ['before', 'after'])
  for (const hour of [12, 18.2, 20.5])
    await fs.copyFile(
      path.join(source, `${version}-bund-${hour}.png`),
      path.join(out, `${version}-${hour}.png`),
    );
for (const file of ['performance.json', 'native-checks.json', 'native-wallpaper.png', 'final-status.json'])
  await fs.copyFile(path.join(source, file), path.join(out, file));
await fs.copyFile(path.join(root, 'docs/COHESION-DESIGN.md'), path.join(out, 'Design.md'));
await fs.writeFile(
  path.join(out, 'Compare.html'),
  `<!doctype html>
<html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Skylwp 材质调整前后对照</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#111820;color:#d8e0e5;font:15px/1.7 system-ui,sans-serif;padding:28px clamp(16px,4vw,64px)}
main{max-width:1500px;margin:auto}h1{font-size:24px;font-weight:550;margin:0 0 6px}p{color:#aebbc4;margin:4px 0 20px}nav{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px}
button,a{font:inherit;color:inherit;border:1px solid #455765;background:#1a2630;padding:8px 16px;border-radius:5px;cursor:pointer;text-decoration:none}button[aria-pressed=true]{background:#354a50;border-color:#8caaa5}button:focus-visible,a:focus-visible,input:focus-visible{outline:2px solid #d1b280;outline-offset:4px}
.scene{position:relative;aspect-ratio:8/5;background:#080c12;overflow:hidden;border:1px solid #34434d}.scene img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain}
#after{clip-path:inset(0 0 0 50%)}#divider{position:absolute;left:50%;height:100%;width:1px;background:#c6d1d7;pointer-events:none}.label{position:absolute;top:12px;background:#111820d9;border:1px solid #4b626e;padding:4px 10px;border-radius:4px}.left{left:12px}.right{right:12px}
.control{display:flex;align-items:center;gap:18px;padding:16px 0}input{flex:1;accent-color:#a9c0b2;min-width:50px}.note{font-size:13px;color:#91a2ae}
</style><main><h1>Skylwp 材质调整前后对照</h1><p>楼宇补上明暗面与细纹理，树木、船体和铺装随同一片天空受光。</p>
<nav aria-label="时间"><button data-hour="12" aria-pressed="false">白天</button><button data-hour="18.2" aria-pressed="true">黄昏</button><button data-hour="20.5" aria-pressed="false">夜晚</button><a href="Preview.html">打开动态演示</a></nav>
<div class="scene"><img id="before" src="before-18.2.png" alt="调整前的外滩城市"><img id="after" src="after-18.2.png" alt="调整后的外滩城市"><div id="divider"></div><span class="label left">0.9.0 调整前</span><span class="label right">0.9.1 调整后</span></div>
<label class="control" for="split"><span>拖动对比</span><input id="split" type="range" min="0" max="100" value="50" aria-label="调整前画面的可见比例"></label>
<p class="note">同一种子 20261102、同一时间与输入。2560 × 1600，密度 7。对照图和动态演示使用前端模拟信号；native-wallpaper.png 是本机实际采集画面。</p></main>
<script>
const before=document.getElementById('before'),after=document.getElementById('after'),split=document.getElementById('split'),divider=document.getElementById('divider');
split.addEventListener('input',()=>{after.style.clipPath='inset(0 0 0 '+split.value+'%)';divider.style.left=split.value+'%'});
document.querySelectorAll('[data-hour]').forEach(button=>button.addEventListener('click',()=>{document.querySelectorAll('[data-hour]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));before.src='before-'+button.dataset.hour+'.png';after.src='after-'+button.dataset.hour+'.png'}));
</script></html>`,
);
await fs.writeFile(
  path.join(out, 'Readme.md'),
  `# Skylwp 0.9.1\n\n打开 Compare.html 拖动查看昼夜材质调整前后。Preview.html 是免安装动态演示，使用模拟信号。\n\n便携 ZIP 使用本机 WebView2，支持真实采集与桌面壁纸。请保留 DLL；用户数据和配对令牌不包含在分发包中。\n\n本次只改画面材质，保留树形、场景几何、居民互动、船群规则和采集方式。性能数据仅计 CPU 合成，不含 GPU 和原生宿主；本轮没有重复整机 CPU/内存采样。\n`,
);
const entries = [];
for (const name of await fs.readdir(out)) {
  if (name === 'Manifest.json') continue;
  const data = await fs.readFile(path.join(out, name));
  entries.push({
    name,
    bytes: data.length,
    sha256: createHash('sha256').update(data).digest('hex'),
  });
}
await fs.writeFile(
  path.join(out, 'Manifest.json'),
  JSON.stringify({ version: '0.9.1', files: entries }, null, 2),
);
console.log(JSON.stringify({ directory: out, files: entries.length }));
