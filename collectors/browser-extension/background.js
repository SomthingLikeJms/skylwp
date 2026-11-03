function category(url) {
  let host='';try {host=new URL(url).hostname.toLowerCase();}catch{return '其他';}
  if (/github|gitlab|bitbucket|stackoverflow/.test(host)) return '代码';
  if (/youtube|bilibili|vimeo|netflix|iqiyi|youku/.test(host)) return '视频';
  if (/docs\.|developer\.|learn\.|readthedocs|wikipedia|arxiv|pubmed|nature\.com/.test(host)) return '文档';
  if (/google|bing|baidu|duckduckgo/.test(host)) return '搜索';
  if (/weibo|reddit|twitter|x\.com|facebook|zhihu|discord/.test(host)) return '社交';
  return '其他';
}
async function send() {
  const {port,token}=await chrome.storage.local.get(['port','token']);
  if(!Number.isInteger(port)||port<1024||port>65535||!/^[a-f0-9]{64}$/.test(token||''))return;
  const tabs=await chrome.tabs.query({});
  // URL is used only for local classification; it is never sent or persisted here.
  const data=tabs.slice(0,500).map(tab=>({id:`extension-${tab.id}`,cat:category(tab.url||'')}));
  try {await fetch(`http://127.0.0.1:${port}/event`,{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${token}`},body:JSON.stringify({v:1,ts:Date.now(),src:'browser',type:'browser.tabs',data:{tabs:data}})});}catch{}
}
let timer;
function schedule(){clearTimeout(timer);timer=setTimeout(send,300);}
for(const event of [chrome.tabs.onCreated,chrome.tabs.onRemoved,chrome.tabs.onUpdated,chrome.tabs.onReplaced,chrome.tabs.onAttached,chrome.tabs.onDetached])event.addListener(schedule);
chrome.alarms.create('refresh',{periodInMinutes:0.5});
chrome.alarms.onAlarm.addListener(send);
chrome.storage.onChanged.addListener(schedule);
chrome.action.onClicked.addListener(()=>chrome.runtime.openOptionsPage());
void send();
