import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd(), dist = path.join(root, 'apps/web/dist');
let html = await fs.readFile(path.join(dist, 'index.html'), 'utf8');
const script = html.match(/<script\b[^>]*src="([^"]+)"[^>]*><\/script>/);
const stylesheet = html.match(/<link\b[^>]*href="([^"]+\.css)"[^>]*>/);
if (!script || !stylesheet) throw new Error('构建产物缺少脚本或样式');
const javascript = (await fs.readFile(path.join(dist, script[1]), 'utf8')).replace(/\/\/# sourceMappingURL=.*$/gm, '');
const css = await fs.readFile(path.join(dist, stylesheet[1]), 'utf8');
html = html.replace(script[0], () => `<script type="module">${javascript.replace(/<\/script/gi, '<\\/script')}</script>`);
html = html.replace(stylesheet[0], () => `<style>${css}</style>`);
await fs.mkdir(path.join(root, 'outputs'), { recursive: true });
const file = path.join(root, 'outputs/ASCII城市预览.html');
await fs.writeFile(file, html);
console.log(`离线预览已生成：${file}`);
