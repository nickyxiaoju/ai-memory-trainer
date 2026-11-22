import { spawn } from 'node:child_process';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('../../',import.meta.url)), shots=join(root,'shots');
const site=new URL(process.env.FOLIO_TEST_URL || 'http://127.0.0.1:5173/');
assert.ok(['127.0.0.1','localhost'].includes(site.hostname),'仅测试本机服务');
const kind=process.argv[2] || 'desktop'; assert.ok(['desktop','mobile'].includes(kind));
const mobile=kind==='mobile', [width,height]=mobile?[390,844]:[1440,900];
let chrome=process.env.CHROME_BIN;
if(!chrome){for(const candidate of ['/usr/bin/chromium','/opt/google/chrome/chrome','/usr/bin/google-chrome']){try{await access(candidate);chrome=candidate;break;}catch{}}}
assert.ok(chrome,'请用 CHROME_BIN 指定已安装的 Chromium/Chrome');
const dir=await mkdtemp(join(tmpdir(),'folio-browser-')), profile=join(dir,'profile');
await mkdir(shots,{recursive:true});
const ch=spawn(chrome,['--headless=new','--disable-gpu','--disable-extensions','--no-first-run','--no-default-browser-check','--disable-background-networking','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{stdio:['ignore','ignore','pipe']});
const browserWS=await new Promise((ok,no)=>{let s='';ch.stderr.on('data',b=>{s+=b;const m=s.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(m)ok(m[1]);});ch.once('exit',c=>no(Error('Chrome exited '+c+': '+s.slice(-800))));});
const pages=await fetch(browserWS.replace('ws:','http:').replace(/\/devtools\/browser\/.*/, '/json/list')).then(r=>r.json());
const ws=new WebSocket(pages.find(t=>t.type==='page').webSocketDebuggerUrl);await once(ws,'open');
let id=0;const pending=new Map(), errors=[], badRequests=[];
ws.addEventListener('message',e=>{const v=JSON.parse(e.data);if(v.id){const h=pending.get(v.id);if(h){pending.delete(v.id);if(v.error)h.no(Error(v.error.message));else h.ok(v.result);}}else if(v.method==='Runtime.exceptionThrown')errors.push(v.params.exceptionDetails.exception?.description||v.params.exceptionDetails.text);else if(v.method==='Network.responseReceived'&&v.params.response.status>=400)badRequests.push([v.params.response.status,v.params.response.url]);});
function send(method,params={}){return new Promise((ok,no)=>{const n=++id;pending.set(n,{ok,no});ws.send(JSON.stringify({id:n,method,params}));});}
async function js(expression){const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||expression);return r.result.value;}
async function wait(expr){const until=Date.now()+10000;while(Date.now()<until){if(await js(expr))return;await new Promise(r=>setTimeout(r,40));}throw Error('Timed out waiting for '+expr+': '+await js('document.body.innerText.slice(-1400)'));}
async function click(sel){
 const selector=JSON.stringify(sel);await wait(`!!document.querySelector(${selector})`);
 const pt=await js(`(()=>{const e=document.querySelector(${selector});e.scrollIntoView({block:'center',inline:'nearest'});const r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2,visible:r.width>0&&r.height>0&&r.bottom>0&&r.top<innerHeight&&r.right>0&&r.left<innerWidth}})()`);
 assert.ok(pt.visible,'Control must be visible: '+sel);
 for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,x:pt.x,y:pt.y,button:'left',clickCount:1});
}
async function write(sel,text){await js(`document.querySelector(${JSON.stringify(sel)}).focus()`);await send('Input.insertText',{text});}
async function fill(sel,text){await js(`document.querySelector(${JSON.stringify(sel)}).select()`);await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Backspace',code:'Backspace',windowsVirtualKeyCode:8});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Backspace',code:'Backspace',windowsVirtualKeyCode:8});await write(sel,text);}
async function key(key,code=key,vk=0){await send('Input.dispatchKeyEvent',{type:'keyDown',key,code,windowsVirtualKeyCode:vk});await send('Input.dispatchKeyEvent',{type:'keyUp',key,code,windowsVirtualKeyCode:vk});}
async function tab(shift=false){const modifiers=shift?8:0;await send('Input.dispatchKeyEvent',{type:'rawKeyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9,modifiers});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9,modifiers});}
async function shot(name){await js("document.querySelector('#notice')?.classList.remove('show')");const v=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(shots+'/'+name+'.png',Buffer.from(v.data,'base64'));}
const trigger = s=>`[data-act="${s}"]`;
async function upload(path){await click('.brand-button');const doc=await send('DOM.getDocument');const input=await send('DOM.querySelector',{nodeId:doc.root.nodeId,selector:'#import-file'});await send('DOM.setFileInputFiles',{files:[path],nodeId:input.nodeId});}
async function fit(){const r=await js(`({width:innerWidth,height:innerHeight,scroll:document.documentElement.scrollWidth,main:document.querySelector('#main').scrollWidth,mainWidth:document.querySelector('#main').clientWidth})`);assert.equal(r.width,width);assert.equal(r.height,height);assert.ok(r.scroll<=width,JSON.stringify(r));assert.ok(r.main<=r.mainWidth+1,JSON.stringify(r));return r;}
async function blankBoxes(){return js(`[...document.querySelectorAll('.blank-wrap')].map(w=>{const a=w.getBoundingClientRect(),b=document.querySelector('.pdf-sheet').getBoundingClientRect();return {x:(a.x-b.x)/b.width,y:(a.y-b.y)/b.height,w:a.width/b.width,h:a.height/b.height}})`) }
try{
 await send('Runtime.enable');await send('Network.enable');await send('Page.enable');await send('DOM.enable');
 await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile});await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
 await send('Page.navigate',{url:site.href});await wait(`document.querySelector('#pdf-img')?.naturalWidth>0`);await wait(`document.querySelector('#checkpoint')`);await js('document.fonts.ready.then(()=>true)');
 console.log(kind,'entry',await fit());await shot(kind+'-reader');
 await click('[data-act="theme"]');assert.equal(await js('document.documentElement.dataset.theme'),'dark');await fit();await click('[data-act="theme"]');
 if(mobile){
  assert.equal(await js('getComputedStyle(document.querySelector(".left-rail")).display'),'none');
  assert.equal(await js('document.querySelector(".mode-switch [data-act=pdf]").getAttribute("aria-pressed")'),'true');
  await click('.source-mark');await wait('document.querySelector("dialog.study[open]")');await shot('mobile-margin');await click('dialog .source-ref');await wait('document.activeElement.matches(".source-mark")');
  await click('[data-act="text"]');await wait('document.querySelector(".flow-page")');await click('.flow-mark');await wait('document.querySelector("dialog.study[open]")');await click('dialog [data-act="figure"]');await wait('document.querySelector("#pdf-img")?.naturalWidth');await js(`(()=>{const s=document.querySelector('.zoom-select');s.value='1.2';s.dispatchEvent(new Event('change',{bubbles:true}));})()`);assert.equal(await js('document.querySelector(".page-frame").style.getPropertyValue("--zoom")'),'1.2');await fit();await click('[data-act="text"]');
 }else{
  await click('.source-mark');assert.equal(await js('document.activeElement.className'),'source-ref');await click('.right-rail .source-ref');assert.ok(await js('document.activeElement.matches(".source-mark")'));
  const pos=()=>js(`(()=>{let a=document.querySelector('.source-mark').getBoundingClientRect(),b=document.querySelector('.pdf-sheet').getBoundingClientRect();return [(a.x-b.x)/b.width,(a.y-b.y)/b.height,a.width/b.width,a.height/b.height]})()`);
  const rect=await pos();await click(trigger('larger'));const rect2=await pos();rect.forEach((v,i)=>assert.ok(Math.abs(v-rect2[i])<.002));await fit();await click(trigger('smaller'));
  await click('.desktop-toggle[data-act="outline"]');assert.ok(await js('document.querySelector(".workspace").classList.contains("without-left")'));await click('.desktop-toggle[data-act="outline"]');
  await click('.outline [data-page="1"]');assert.equal(await js('document.querySelector(".page-nav span").innerText.trim()'),'01 / 03');
 }
 await click('.top-tools [data-act="find"]');await write('#doc-search','快照');await wait('document.querySelector(".empty-text")');assert.ok(!await js('document.querySelector(".hit")'));await key('Escape','Escape',27);
 await click('.page-nav [data-act="next"]');await wait('document.querySelector("#blank-0")');
 assert.equal(await js('document.querySelectorAll(".blank-field").length'),2);
 await wait('document.activeElement.id==="blank-0"');await tab();assert.equal(await js('document.activeElement.id'),'blank-1');await tab(true);assert.equal(await js('document.activeElement.id'),'blank-0');
 const blankLabel=await js('document.querySelector("#blank-1").getAttribute("aria-label")');assert.ok(blankLabel.includes('5 个字')&&!blankLabel.includes('另一块内存'),blankLabel);
 if(!mobile){
  const boxes=await blankBoxes();assert.equal(boxes.length,2);assert.ok(boxes.every(b=>b.y>0&&b.y<.8),JSON.stringify(boxes));
  await shot('desktop-practice');
  await click('[data-act="explain"]');await wait('document.querySelector("#answer")');await shot('desktop-composer');
  await write('#answer','线程是程序。');await click('#submit-answer');await wait('document.querySelector(".fallback-note")');await wait('document.querySelector("#blank-0")');
  assert.ok(!await js('document.querySelector("#answer")'));
  // The fallback card is redrawn in place; invoke its buttons directly so headless
  // pointer coordinates cannot go stale between press and release.
  await js('document.querySelector("[data-act=back-to-answer]").click()');await wait('document.querySelector("#answer")');assert.equal(await js('document.querySelector("#answer").value'),'线程是程序。');
  await js('document.querySelector("[data-act=use-blanks]").click()');await wait('document.querySelector("#blank-0")');
  await js(`document.querySelector('#blank-0').focus()`);
  const prevented=await js(`(()=>{const e=new ClipboardEvent('paste',{bubbles:true,cancelable:true});document.querySelector('#blank-0').dispatchEvent(e);return e.defaultPrevented})()`);assert.ok(prevented);assert.ok((await js('document.querySelector("#feedback").innerText')).includes('手动'));
  await fill('#blank-0','共用这些地址映射');await key('Enter','Enter',13);await wait('document.querySelector("#feedback").innerText.includes("第 1 空")');assert.equal(await js('document.querySelector("#blank-0").dataset.state'),'bad');await shot('desktop-wrong');
  await js('document.querySelector("[data-act=read]").click()');await wait('!document.querySelector(".blank-field")');assert.ok(await js('document.querySelector(".source-mark, .flow-mark")'));
  await js('document.querySelector("[data-act=practice]").click()');await wait('document.querySelector("#blank-0")');assert.equal(await js('document.querySelector("#blank-0").value'),'共用这些地址映射');
 }else{
  assert.equal(await js('document.querySelectorAll(".flow-blank-field").length'),2);
  assert.equal(await js('document.querySelector(".extra-source")'),null);
  await click('.mobile-menu[data-act="study"]');await wait('document.querySelector("dialog.study[open]")');await click('dialog .source-ref');await wait('document.activeElement.matches(".flow-mark, p")');
  await js(`document.querySelector('#blank-0').focus()`);
  await send('Emulation.setDeviceMetricsOverride',{width,height:490,deviceScaleFactor:1,mobile:true});await wait('document.querySelector("#blank-0").getBoundingClientRect().bottom <= visualViewport.height');assert.equal(await js('document.activeElement.id'),'blank-0');
  await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true});
 }
 await fill('#blank-0','共用这份地址映射');assert.equal(await js('document.querySelector("#blank-0").value'),'共用这份地址映射');await fill('#blank-1','另一块内存');await wait('document.querySelector(".unlock-row")');assert.equal(await js('document.querySelector(".page-nav span").innerText.trim()'),'01 / 03');assert.ok(await js('document.querySelector(".continuation")'));
 await click('.unlock-row [data-act="next"]');await wait('document.querySelector(".page-nav span").innerText.trim()==="02 / 03"');
 if(mobile)await click('[data-act="pdf"]');
 await wait('document.querySelector("#pdf-img")?.naturalWidth>0');assert.equal(await js('document.querySelectorAll(".blank-field").length'),0);
 await click('.page-nav [data-act="next"]');await wait('document.querySelector("#blank-0")');assert.equal(await js('document.querySelectorAll(".blank-field").length'),1);
 if(!mobile){const [b]=await blankBoxes();assert.ok(Math.abs(b.x-.3333)<.01&&Math.abs(b.y-.2426)<.01,JSON.stringify(b));const quote=await js('document.querySelector(".right-rail blockquote")?.innerText||""');assert.ok(quote.includes('〔　〕'),quote);assert.ok(!quote.includes('地址空间'),quote);}
 else{const [b]=await blankBoxes();assert.ok(b.x>.2&&b.x<.5&&b.y>.1&&b.y<.4,JSON.stringify(b));await shot('mobile-practice');}
 await click('.top-tools [data-act="find"]');await write('#doc-search','地址空间');await wait('document.querySelector(".hit")');const hit=await js('document.querySelector(".hit span").innerText');assert.ok(hit.includes('〔　〕'),hit);assert.ok(!hit.includes('地址空间'),hit);await key('Escape','Escape',27);
 await js(`document.querySelector('#blank-0').focus()`);await send('Input.imeSetComposition',{text:'di',selectionStart:2,selectionEnd:2});assert.equal(await js('document.querySelector("#blank-0").getAttribute("aria-invalid")'),null);assert.ok(!await js('document.querySelector(".unlock-row")'));
 await send('Input.insertText',{text:'地址空间'});await wait('document.querySelector(".unlock-row")');
 await click('.unlock-row [data-act="next"]');await wait('document.querySelector(".chapter-end")');await click('.chapter-end button');await wait('document.querySelector(".summary-page")');await fit();await shot(kind+'-summary');assert.match(await js('document.querySelector(".summary-total").innerText'),/02/);const reviewText=await js('document.querySelector(".summary-practice").innerText');assert.ok(reviewText.includes('经原文填空核对'),reviewText);if(mobile)assert.ok(reviewText.includes('没有记录到误答'),reviewText);else assert.ok(reviewText.includes('曾有误答'),reviewText);
 await click('[data-act="retry-at"][data-page="1"]');await wait('document.querySelector("#blank-0")');await click('[data-act="end-review"]');await send('Page.reload',{ignoreCache:true});await wait('document.querySelector(".unlock-row")');assert.equal(await js('document.querySelector(".page-nav span").innerText.trim()'),'02 / 03');
 await click('.brand-button');await wait('document.querySelector(".lib-page")');await fit();await shot(kind+'-library');await js('document.querySelector("#library-search").focus()');await send('Input.imeSetComposition',{text:'cao',selectionStart:3,selectionEnd:3});await send('Input.insertText',{text:'操作'});await wait('document.querySelector("#library-search").value==="操作"');assert.ok(await js('document.querySelector(".lib-open")'));await js('document.querySelector("#library-search").select()');await key('Backspace','Backspace',8);await click('[data-act="filter"][data-filter="done"]');assert.ok(await js('document.querySelector(".lib-open")'));
 if(!mobile){
  const sample=dir+'/学习笔记.txt';await writeFile(sample,'磁盘把数据保存在非易失介质上。\n系统重启后仍可读取已写入磁盘的数据。');await upload(sample);await wait('document.title.includes("学习笔记")');await wait('document.querySelector(".checkpoint")');await click('[data-act="practice"]');await wait('document.querySelector(".blank-field")');await wait('document.querySelector(".flow-page")');
  await send('Page.reload',{ignoreCache:true});await wait('document.title.includes("学习笔记")');await upload(join(root,'reader/public/processes.pdf'));await wait('document.title.startsWith("processes")');await wait('document.querySelector("#pdf-img")?.naturalWidth>0');await fit();await click('[data-act="practice"]');await wait('document.querySelector(".blank-field")');await wait('document.querySelector("#pdf-img")?.naturalWidth>0');await shot('imported-pdf');
  await click('.brand-button');await js(`(()=>{const data=new DataTransfer();data.items.add(new File(['正文需要理解，也需要自己组织语言。'],'拖入的资料.txt',{type:'text/plain'}));document.getElementById('drop-zone').dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:data}));})()`);await wait('document.title.startsWith("拖入的资料")');await wait('document.querySelector(".checkpoint")');await click('[data-act="practice"]');await wait('document.querySelector(".blank-field")');
  const old=dir+'/旧稿.ppt';await writeFile(old,'not a ppt');await upload(old);await wait('document.querySelector("#import-state")?.textContent.includes("另存")');
 }
 assert.deepEqual(errors,[]);console.log(kind,'completed; console errors:',errors,'unexpected HTTP errors:',badRequests);assert.deepEqual(badRequests,[]);
}finally{ws.close();const stopped=once(ch,'close');ch.kill();await stopped;await rm(dir,{recursive:true,force:true,maxRetries:3});}
