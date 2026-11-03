const port=document.getElementById('port'),token=document.getElementById('token'),status=document.getElementById('status');
chrome.storage.local.get(['port','token']).then(value=>{port.value=value.port||'';token.value=value.token||'';});
document.getElementById('save').addEventListener('click',async()=>{
  const number=Number(port.value),value=token.value.trim();
  if(!Number.isInteger(number)||number<1024||number>65535||!/^[a-f0-9]{64}$/.test(value)){status.textContent='请输入有效端口和 64 位令牌';return;}
  await chrome.storage.local.set({port:number,token:value});status.textContent='已保存连接';
});
