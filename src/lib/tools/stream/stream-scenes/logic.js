/* ---------- Szenen-Screens ---------- */
const SCENES=['start','brb','end'];
const BOTS_DEFAULT='nightbot, streamelements, moobot, fossabot, streamlabs, wizebot, sery_bot';
const TEXT_KEYS=['startTitle','startSub','startDone','brbTitle','brbSub','brbDone','endTitle','endSub','endNext'];
const LOCK=((/stream[-_:]?(start|brb|end)\b/i.exec(location.hash)||[])[1]||'').toLowerCase();
const cap=s=>s[0].toUpperCase()+s.slice(1);
function defaultState(){
  const o={...commonDefaults(),cams:0,scene:'start',timers:{start:{end:0,total:0},brb:{end:0,total:0}},brbAuto:true,brbMin:5,showBar:true,
    chatMode:'box',noCmds:true,ignoreUsers:BOTS_DEFAULT,eyebrow:'',socials:'',bgStyle:'blobs',bgImg:'',bgDim:.55,camStart:true,camBrb:false,camEnd:true};
  for(const k of TEXT_KEYS) o[k]=''; return o;
}
function normalize(s){
  const o=normalizeCommon(s,defaultState()); if(!s||typeof s!=='object') return o;
  if(SCENES.includes(s.scene)) o.scene=s.scene;
  if(s.timers&&typeof s.timers==='object') for(const k of ['start','brb']){const t=s.timers[k];if(t&&Number.isFinite(t.end)&&Number.isFinite(t.total)) o.timers[k]={end:t.end,total:Math.max(0,t.total)};}
  for(const k of ['brbAuto','showBar','noCmds','camStart','camBrb','camEnd']) if(typeof s[k]==='boolean') o[k]=s[k];
  if([3,5,10,15].includes(s.brbMin)) o.brbMin=s.brbMin;
  if(['box','ticker','off'].includes(s.chatMode)) o.chatMode=s.chatMode;
  if(['blobs','plain','image'].includes(s.bgStyle)) o.bgStyle=s.bgStyle;
  for(const k of [...TEXT_KEYS,'eyebrow']) if(typeof s[k]==='string') o[k]=s[k].slice(0,160);
  for(const k of ['socials','ignoreUsers']) if(typeof s[k]==='string') o[k]=s[k].slice(0,600);
  if(typeof s.bgImg==='string'&&/^data:image\/(jpeg|webp|png);base64,/.test(s.bgImg)&&s.bgImg.length<3000000) o.bgImg=s.bgImg;
  const d=parseFloat(s.bgDim); if(Number.isFinite(d)) o.bgDim=Math.min(.85,Math.max(0,d));
  return o;
}
const curScene=()=>LOCK||state.scene;
const txt=k=>String(state[k]||'').trim()||i18n('d'+cap(k));
const camShown=()=>state.cams>0&&!!state['cam'+cap(curScene())];
const seeThrough=()=>state.camFill==='transparent'&&camShown();
const isOwner=()=>!(IS_STREAM_WIN&&window.opener);

/* ---------- Countdown ---------- */
function fmtLeft(ms){const s=Math.max(0,Math.ceil(ms/1000)),h=Math.floor(s/3600),m=Math.floor(s%3600/60);return (h?h+':'+pad2(m):pad2(m))+':'+pad2(s%60);}
function cdStatus(sc){if(sc==='end') return 'none';const t=state.timers[sc];if(!t||!t.end) return 'none';return t.end>Date.now()?'run':'done';}
function setTimer(sc,min){state.timers[sc]={end:Date.now()+min*60000,total:min*60000};}
function addTime(sc,min){
  const t=state.timers[sc], now=Date.now();
  if(t.end>now){t.end=Math.max(now+1000,t.end+min*60000);t.total=Math.max(t.end-now,t.total+min*60000);}
  else if(min>0) setTimer(sc,min);
}
function untilTime(sc,v){
  const m=/^(\d{1,2}):(\d{2})$/.exec(v||''); if(!m){toast(i18n('tUntilBad'));return false;}
  const d=new Date(); d.setHours(+m[1],+m[2],0,0); if(d.getTime()<=Date.now()+5000) d.setDate(d.getDate()+1);
  state.timers[sc]={end:d.getTime(),total:d.getTime()-Date.now()}; return true;
}
function setScene(sc){
  if(!SCENES.includes(sc)) return;
  state.scene=sc;
  if(sc==='brb'&&state.brbAuto&&!(state.timers.brb.end>Date.now())) setTimer('brb',state.brbMin);
  commit();
}

/* ---------- Layout ---------- */
function computeLayout(){
  const mode=state.chatMode, tick=mode==='ticker', camOn=camShown();
  if(state.format==='9:16'){
    const cams=camOn?camRects9x16(state.cams):[], top=cams.length?650:200, chatH=mode==='box'?(cams.length?440:540):0;
    const block={x:70,y:top,w:940,h:1920-top-(chatH?chatH+70:tick?190:130)-30};
    return {W:1080,H:1920,cams,block,center:true,chat:chatH?{x:60,y:block.y+block.h+20,w:960,h:chatH}:null,
      ticker:tick?{x:0,y:1772,w:1080,h:72}:null,brand:{x:600,y:1868,w:440,h:30},fs:{title:112,sub:40,cd:150,eye:30,soc:28,msg:30}};
  }
  const cams=camOn?(state.cams===1?[{x:1300,y:60,w:560,h:315,r:18}]:[{x:1300,y:60,w:272,h:153,r:16},{x:1588,y:60,w:272,h:153,r:16}]):[];
  const right=mode==='box'||cams.length>0, bottomY=tick?950:1040;
  let chat=null; if(mode==='box'){const y=cams.length?cams[0].y+cams[0].h+28:60;chat={x:1300,y,w:560,h:bottomY-y-(tick?0:24)};}
  const block=right?{x:110,y:80,w:1100,h:bottomY-110}:{x:220,y:80,w:1480,h:bottomY-110};
  return {W:1920,H:1080,cams,block,center:!right,chat,ticker:tick?{x:0,y:976,w:1920,h:76}:null,
    brand:tick?{x:1500,y:22,w:380,h:28}:{x:1500,y:1040,w:380,h:28},fs:{title:132,sub:42,cd:170,eye:32,soc:28,msg:28}};
}

/* ---------- Bühne ---------- */
let curL=null, lastSceneBuilt='', builtCd='none';
function buildBg(L){
  const w=div('rg sc-bg'); place(w,{x:0,y:0,w:L.W,h:L.H});
  w.style.background=`linear-gradient(135deg,${lighten(state.bg,.07)},${state.bg})`;
  if(state.camFill==='transparent'&&L.cams.length){const d=`M0 0H${L.W}V${L.H}H0Z`+L.cams.map(rrPath).join('');w.style.clipPath=`path(evenodd,"${d}")`;}
  if(state.bgStyle==='image'&&state.bgImg){
    const im=div('sc-img'); im.style.backgroundImage=`url("${state.bgImg}")`; w.append(im);
    const dim=div('sc-dim'); dim.style.background=rgba(state.bg,state.bgDim); w.append(dim);
  }else if(state.bgStyle==='blobs'){
    for(const c of ['b1','b2','b3']) w.append(div('sc-blob '+c));
  }else{const g=div('sc-dim');g.style.background=`radial-gradient(circle at 0 0,${rgba(state.accent,.18)},transparent 60%)`;w.append(g);}
  return w;
}
function buildStage(L,out){
  curL=L; const sc=curScene(), st=stage.style;
  st.setProperty('--sc-fg',textOn(state.bg)==='#000000'?'0,0,0':'255,255,255');
  out.push(buildBg(L)); camEls(L,out);
  const B=L.block, b=div('rg sc-block'+(L.center?' center':'')+(sc!==lastSceneBuilt?' enter':'')); place(b,B);
  const eye=state.eyebrow.trim()||cleanChannel(state.chatChannel);
  if(eye){const e=el('div','sc-eye',eye);e.style.fontSize=L.fs.eye+'px';b.append(e);}
  const t=div('sc-title'); fitInto(t,txt(sc+'Title'),B.w,Math.round(L.fs.title*2.2),L.fs.title,800,1.04,2); b.append(t);
  const sub=txt(sc+'Sub'); if(sub){const s=el('div','sc-sub',sub);s.style.fontSize=L.fs.sub+'px';b.append(s);}
  builtCd=cdStatus(sc);
  if(builtCd==='run'){
    const tm=state.timers[sc], w=div('sc-cdw'), cd=el('div','sc-cd',fmtLeft(tm.end-Date.now()));
    cd.style.fontSize=Math.round(Math.min(L.fs.cd,B.w*.15))+'px'; w.append(cd);
    if(state.showBar){const bar=div('sc-bar'),i=el('i');i.style.width=barPct(tm)+'%';bar.append(i);w.append(bar);}
    b.append(w);
  }else if(builtCd==='done'){const d=el('div','sc-done',txt(sc+'Done'));d.style.fontSize=Math.round(L.fs.cd*.42)+'px';b.append(d);}
  if(sc==='end'){const n=String(state.endNext||'').trim();if(n){const x=div('sc-next');x.style.fontSize=Math.round(L.fs.sub*1.05)+'px';x.append(el('span','l',i18n('nextLabel')),el('b',null,n));b.append(x);}}
  const soc=String(state.socials||'').split('\n').map(x=>x.trim()).filter(Boolean).slice(0,6);
  if(soc.length){const s=div('sc-soc');s.style.fontSize=L.fs.soc+'px';for(const x of soc) s.append(el('span',null,x));b.append(s);}
  out.push(b);
  if(L.chat){
    const c=div('rg sc-chat'); place(c,L.chat); c.style.fontSize=L.fs.msg+'px'; c.append(getChatList());
    if(!msgs.length) c.append(el('div','sc-chat-empty editor-only',i18n('chatEmpty')));
    out.push(c);
  }
  if(L.ticker){
    const tk=div('rg sc-ticker'); place(tk,L.ticker); tk.style.fontSize=Math.round(L.ticker.h*.4)+'px'; tk.append(getTrack());
    const em=el('div','sc-tkempty',i18n('tickerEmpty')); em.hidden=msgs.length>0; tk.append(em); out.push(tk);
  }
  if(state.brand) out.push(brandBox(L.brand,state.bg));
  lastSceneBuilt=sc;
}
const barPct=tm=>tm.total?Math.max(0,Math.min(100,(1-(tm.end-Date.now())/tm.total)*100)):0;

/* ---------- Chat ---------- */
const msgs=[]; let chatList=null, track=null, trackX=null, testN=0;
const PALETTE=['#ff6900','#4fc3f7','#81c784','#f06292','#ffd54f','#ba68c8','#4db6ac','#ff8a65','#9fa8da','#aed581'];
function nameColor(m){
  let c=m.color; if(!c){let h=0;for(const ch of m.user) h=(h*31+ch.charCodeAt(0))>>>0;c=PALETTE[h%PALETTE.length];}
  return lum(c)<.12?mix(c,'#ffffff',.5):c;
}
function msgNodes(text,emotes){
  const cps=Array.from(text); if(!emotes) return [document.createTextNode(text)];
  const R=[];
  for(const part of emotes.split('/')){const [id,pos]=part.split(':');if(!id||!pos) continue;for(const r of pos.split(',')){const [a,b]=r.split('-').map(Number);if(Number.isInteger(a)&&Number.isInteger(b)&&b>=a) R.push([a,b,id]);}}
  R.sort((x,y)=>x[0]-y[0]); const out=[]; let i=0;
  for(const [a,b,id] of R){
    if(a<i||b>=cps.length) continue;
    if(a>i) out.push(document.createTextNode(cps.slice(i,a).join('')));
    const alt=cps.slice(a,b+1).join(''), im=new Image(); im.className='emote'; im.alt=alt; im.draggable=false;
    im.onerror=()=>im.replaceWith(document.createTextNode(alt));
    im.src='https://static-cdn.jtvnw.net/emoticons/v2/'+encodeURIComponent(id)+'/default/dark/2.0'; out.push(im); i=b+1;
  }
  if(i<cps.length) out.push(document.createTextNode(cps.slice(i).join('')));
  return out;
}
function msgEl(m,anim){
  const d=div('sc-msg'+(anim?' new':'')+(m.action?' act':'')); d.dataset.id=m.id; d.dataset.user=m.user;
  const n=el('span','nm',m.name); n.style.color=nameColor(m); const t=el('span','tx'); t.append(...msgNodes(m.text,m.emotes));
  d.append(n,t); return d;
}
function getChatList(){if(!chatList){chatList=div('sc-msgs');for(const m of msgs.slice(-30)) chatList.append(msgEl(m,false));}return chatList;}
function getTrack(){if(!track){track=div('sc-track');trackX=null;for(const m of msgs.slice(-10)) appendTick(m);}return track;}
function appendTick(m){
  const box=track.parentElement;
  if(box&&track.children.length&&trackX!==null){const end=trackX+track.scrollWidth, W=box.clientWidth;if(end<W){const sp=div('sc-sp');sp.style.width=(W-end)+'px';track.append(sp);}}
  const s=div('sc-tk'); s.dataset.id=m.id; s.dataset.user=m.user;
  const n=el('span','nm',m.name); n.style.color=nameColor(m); const t=el('span','tx'); t.append(...msgNodes(m.text,m.emotes)); s.append(n,t); track.append(s);
}
let lastT=0;
function tickLoop(t){
  requestAnimationFrame(tickLoop);
  const dt=Math.min(.1,(t-lastT)/1000); lastT=t;
  if(!track||!track.isConnected) return;
  const box=track.parentElement, W=box.clientWidth;
  if(!track.children.length){trackX=W;track.style.transform=`translateX(${W}px)`;return;}
  if(trackX===null) trackX=W;
  trackX-=150*dt;
  let f=track.firstElementChild;
  while(f&&trackX+f.offsetWidth<0){trackX+=f.offsetWidth;f.remove();f=track.firstElementChild;}
  track.style.transform=`translateX(${trackX.toFixed(1)}px)`;
}
function pushMsg(m,silent){
  msgs.push(m); if(msgs.length>60) msgs.shift();
  if(chatList){chatList.append(msgEl(m,true));while(chatList.children.length>40) chatList.firstChild.remove();}
  if(track) appendTick(m);
  const em=$('.sc-chat-empty',stage); if(em) em.remove();
  const te=$('.sc-tkempty',stage); if(te) te.hidden=true;
  if(!silent) renderChatInfo();
}
function clearMsgs(c){
  const hit=m=>c.all||(c.id&&m.id===c.id)||(c.user&&m.user===c.user);
  for(let i=msgs.length-1;i>=0;i--) if(hit(msgs[i])) msgs.splice(i,1);
  for(const host of [chatList,track]) if(host) for(const e of [...host.children]) if(c.all||(c.id&&e.dataset.id===c.id)||(c.user&&e.dataset.user===c.user)) e.remove();
  renderChatInfo();
}
const listSet=s=>new Set(String(s||'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean));
function onChatMessage(m){
  if(!state) return;
  const u=norm(m.user); if(listSet(state.ignoreUsers).has(u)) return;
  let text=String(m.text||''), action=false;
  if(text.startsWith('\u0001ACTION ')){text=text.slice(8).replace(/\u0001$/,'');action=true;}
  if(state.noCmds&&text.trim().startsWith('!')) return;
  const msg={id:m.id||uid(),user:u,name:String(m.name||m.user).slice(0,30),color:m.color||'',text:text.slice(0,300),emotes:m.emotes||'',action,t:Date.now()};
  pushMsg(msg); if(peers.size) sendPeers({kwm:'kwm-scenes-msg',m:msg});
}
function onChatClear(c){clearMsgs(c);if(peers.size) sendPeers({kwm:'kwm-scenes-clear',c});}
function onPeerMessage(d){
  if(d.kwm==='kwm-scenes-msg'&&d.m) pushMsg(d.m);
  else if(d.kwm==='kwm-scenes-clear'&&d.c) clearMsgs(d.c);
  else if(d.kwm==='kwm-scenes-msgs'&&Array.isArray(d.list)){msgs.length=0;msgs.push(...d.list.slice(-60));chatList=null;track=null;refresh();}
}
function onPeerJoined(src){try{src.postMessage({kwm:'kwm-scenes-msgs',list:msgs},'*');}catch(e){}}
const TEST=[['pixelpanda','Hype! Endlich geht’s los'],['LunaLive','Hallo zusammen 👋'],['KaffeeKlaus','Was spielen wir heute?'],['nordlicht92','Erster! 😄'],['ByteBiene','Der Countdown ist cool'],['ZockerOma','Gute Laune heute, Leute!'],['GG_Gregor','Bin gespannt'],['MiaMaus','Musik ist super btw']];
const TEST_EN=[['pixelpanda','Hype! Finally starting'],['LunaLive','Hi everyone 👋'],['KaffeeKlaus','What are we playing today?'],['nordlicht92','First! 😄'],['ByteBiene','Love the countdown'],['ZockerOma','Good vibes today, folks!'],['GG_Gregor','Can’t wait'],['MiaMaus','Music is great btw']];
function testMsg(){const [u,t]=(LANG==='de'?TEST:TEST_EN)[testN++%TEST.length];onChatMessage({user:u.toLowerCase(),name:u,text:t,color:'',emotes:'',id:uid()});}

/* ---------- Editor ---------- */
function renderTool(){renderPanel();}
function renderPanel(){
  if(!$('#sceneBtns')) return;
  const sc=curScene();
  for(const b of $$('#sceneBtns [data-scene]')) b.classList.toggle('on',b.dataset.scene===sc);
  $('#timerBox').hidden=sc==='end';
  paintTimer(); renderChatInfo();
}
function paintTimer(){
  const sc=curScene(), lab=$('#timeLeft'); if(!lab) return;
  const s=cdStatus(sc); lab.textContent=s==='run'?fmtLeft(state.timers[sc].end-Date.now()):s==='done'?'0:00':'–';
  lab.classList.toggle('done',s==='done');
}
function renderChatInfo(){const ci=$('#chatInfo');if(ci) ci.textContent=chat.status==='on'||msgs.length?i18n('chatCount',{n:msgs.length}):i18n('chatOff');}
function onChatStatus(){renderChatInfo();}
function renderToolSidebar(){
  const sc=curScene();
  for(const x of $$('[data-scene-f]')) x.hidden=x.dataset.sceneF!==sc;
  $('#textsFor').textContent=i18n('sc'+cap(sc));
  for(const k of TEXT_KEYS){const x=$(`[data-key=${k}]`);if(x) x.placeholder=k==='endNext'?i18n('phEndNext'):i18n('d'+cap(k));}
  $('#bgImgRow').hidden=state.bgStyle!=='image'; $('#bgDimRow').hidden=state.bgStyle!=='image'||!state.bgImg;
}
async function fileToBg(file){
  const url=URL.createObjectURL(file);
  try{
    const im=await loadImg(url), k=Math.min(1,1920/im.naturalWidth,1920/im.naturalHeight), c=document.createElement('canvas');
    c.width=Math.round(im.naturalWidth*k); c.height=Math.round(im.naturalHeight*k); c.getContext('2d').drawImage(im,0,0,c.width,c.height);
    return c.toDataURL('image/jpeg',.84);
  }finally{URL.revokeObjectURL(url);}
}
function toolKeys(e){
  if(e.ctrlKey||e.metaKey||e.altKey) return false;
  const i=['1','2','3'].indexOf(e.key); if(i>=0){setScene(SCENES[i]);return true;}
  const sc=curScene();
  if((e.key==='ArrowUp'||e.key==='ArrowDown')&&sc!=='end'){e.preventDefault();addTime(sc,e.key==='ArrowUp'?1:-1);commit();return true;}
  return false;
}
function toolInit(){
  $('#sceneBtns').addEventListener('click',e=>{const b=e.target.closest('[data-scene]');if(b) setScene(b.dataset.scene);});
  $('#timerBox').addEventListener('click',e=>{
    const b=e.target.closest('button'); if(!b) return; const sc=curScene();
    if(b.dataset.add){addTime(sc,+b.dataset.add);commit();}
    else if(b.dataset.set){setTimer(sc,+b.dataset.set);commit();}
  });
  $('#btnUntil').onclick=()=>{if(untilTime(curScene(),$('#untilTime').value)) commit();};
  $('#btnStop').onclick=()=>{state.timers[curScene()]={end:0,total:0};commit();};
  $('#btnTestMsg').onclick=testMsg;
  $('#btnBgImg').onclick=()=>$('#bgFile').click();
  $('#bgFile').onchange=async e=>{const f=e.target.files[0];e.target.value='';if(!f) return;try{state.bgImg=await fileToBg(f);state.bgStyle='image';commit();}catch(err){toast(i18n('tImgFail'));}};
  $('#btnBgClear').onclick=()=>{state.bgImg='';commit();};
  requestAnimationFrame(tickLoop);
  setInterval(()=>{
    const sc=curScene(), s=cdStatus(sc);
    if(s!==builtCd){refresh();return;}
    if(s==='run'){
      const tm=state.timers[sc], cd=$('.sc-cd',stage); if(cd) cd.textContent=fmtLeft(tm.end-Date.now());
      const bi=$('.sc-bar i',stage); if(bi) bi.style.width=barPct(tm)+'%';
    }
    paintTimer();
  },250);
}
function onLangChanged(){testN=0;}
