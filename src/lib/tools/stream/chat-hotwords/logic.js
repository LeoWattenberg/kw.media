/* ---------- Hotwords ---------- */
const STOP=new Set(('der die das den dem des und oder ich du er sie es wir ihr ist sind war bin bist hat habe haben ein eine einen einem einer nicht auch so ja nein mit für von zu im in am an auf aus bei mal noch nur wie was wer wo da dann denn doch schon aber wenn weil dass sich mich dich mir dir uns euch man kann mehr sehr jetzt hier halt eben mein dein sein '+
  'the a an and or i you he she it we they is are was were be been am to of in on at for with not no so but if then that this my your his her its our their me him them do does did have has had just what who how why when where there here can will would im its dont').split(' '));
const BOTS_DEFAULT='nightbot, streamelements, moobot, fossabot, streamlabs, wizebot, sery_bot';
function defaultState(){return {...commonDefaults(),format:'panel',win:30,top:5,mode:'words',once:true,stop:true,noCmds:true,ignore:'',ignoreUsers:BOTS_DEFAULT,title:'',bgMode:'card'};}
function normalize(s){
  const o=normalizeCommon(s,defaultState()); if(!s||typeof s!=='object') return o;
  if([10,30,60,120].includes(s.win)) o.win=s.win;
  if([3,5,8,10].includes(s.top)) o.top=s.top;
  if(['words','msgs'].includes(s.mode)) o.mode=s.mode;
  if(['card','magenta','full'].includes(s.bgMode)) o.bgMode=s.bgMode;
  for(const k of ['once','stop','noCmds']) if(typeof s[k]==='boolean') o[k]=s[k];
  for(const k of ['ignore','ignoreUsers','title']) if(typeof s[k]==='string') o[k]=s[k].slice(0,400);
  return o;
}
const seeThrough=()=>state.bgMode==='card';

/* Ereignisse im Zeitfenster */
let events=[], live={top:[],rate:0,people:0,total:0}, demoT=0, lastList=0;
const isOwner=()=>chat.status==='on'||!!demoT;
const listSet=s=>new Set(String(s||'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean));
function terms(text){
  const t=String(text||'').trim(); if(!t) return [];
  if(state.mode==='msgs'){const k=t.replace(/\s+/g,' ').slice(0,60);return [[k.toLowerCase(),k]];}
  const out=new Map();
  for(let w of t.split(/\s+/)){
    if(/^https?:\/\//i.test(w)||w.startsWith('@')) continue;
    w=w.replace(/^[^\p{L}\p{N}?!]+|[^\p{L}\p{N}?!]+$/gu,''); if(!w||w.length>25) continue;
    if(/^[!?]+$/.test(w)) w=w[0];
    const k=w.toLowerCase(); if(state.stop&&STOP.has(k)) continue;
    if(!out.has(k)) out.set(k,w);
  }
  return [...out];
}
function onChatMessage(m){
  if(!state) return;
  if(listSet(state.ignoreUsers).has(norm(m.user))) return;
  if(state.noCmds&&String(m.text).trim().startsWith('!')) return;
  const ign=listSet(state.ignore), ts=terms(m.text).filter(([k])=>!ign.has(k));
  events.push({t:Date.now(),u:norm(m.user),ts});
}
function compute(){
  const now=Date.now(), cut=now-state.win*1000; let i=0; while(i<events.length&&events[i].t<cut) i++; if(i) events=events.slice(i);
  const per=new Map(), users=new Set();
  for(const e of events){users.add(e.u);for(const [k,d] of e.ts){let r=per.get(k);if(!r){r={k,d,n:0,u:new Set(),last:0};per.set(k,r);}r.d=d;r.n++;r.u.add(e.u);r.last=e.t;}}
  const ign=listSet(state.ignore);
  const arr=[...per.values()].filter(r=>!ign.has(r.k)).map(r=>({k:r.k,d:r.d,n:state.once?r.u.size:r.n,last:r.last})).sort((a,b)=>b.n-a.n||b.last-a.last);
  live={top:arr.slice(0,20).map(({k,d,n})=>({k,d,n})),rate:Math.round(events.length*60/state.win),people:users.size,total:events.length};
}

/* ---------- Layout & Bühne ---------- */
function computeLayout(){
  if(state.format==='bar') return {W:1600,H:180,fs:44,headFs:30,bar:true};
  if(state.format==='square') return {W:800,H:800,fs:44,headFs:40};
  return {W:600,H:900,fs:40,headFs:36};
}
let rowsBox=null, rowEls=new Map(), curL=null;
function buildStage(L,out){
  curL=L; rowEls=new Map();
  stage.classList.toggle('hw-bar',!!L.bar);
  if(state.bgMode==='full') out.push(bgLayer(L));
  else if(state.bgMode==='magenta'){const m=div('rg');place(m,{x:0,y:0,w:L.W,h:L.H});m.style.background='#ff00ff';out.push(m);}
  const card=div('hw-card'); card.style.setProperty('--hw-card',state.bgMode==='full'?rgba(lighten(state.bg,.06),.85):rgba(state.bg,.94));
  const head=div('hw-head'); const t=el('div','hw-title',state.title.trim()||i18n('titleDefault')); t.style.fontSize=L.headFs+'px';
  const w=el('div','hw-win',i18n('stWin',{w:state.win})); w.style.fontSize=Math.round(L.headFs*.62)+'px'; head.append(t,w);
  rowsBox=div('hw-rows'); rowsBox.style.fontSize=L.fs+'px';
  card.append(head,rowsBox);
  if(!L.bar){
    const f=div('hw-foot'); f.style.fontSize=Math.round(L.fs*.5)+'px';
    const st=el('span','hw-stat',''); f.append(st);
    if(state.brand){const b=brandBox({x:0,y:0,w:10,h:Math.round(L.fs*.62)},state.bg);b.classList.remove('rg');b.style.cssText+=';position:static;width:auto;height:auto';f.append(b);}
    card.append(f);
  }
  out.push(card);
}
function paintLive(){
  if(!rowsBox||!curL) return;
  const L=curL, n=state.top, top=live.top.slice(0,n), max=Math.max(1,...top.map(x=>x.n));
  const st=$('.hw-stat',stage); if(st) st.textContent=i18n('stRate',{r:live.rate})+' · '+i18n('stPeople',{p:live.people});
  let empty=$('.hw-empty',rowsBox);
  if(!top.length){if(!empty){empty=el('div','hw-empty',i18n('stEmpty'));empty.style.fontSize=Math.round(L.fs*.6)+'px';rowsBox.append(empty);}}
  else if(empty) empty.remove();
  const keep=new Set(top.map(x=>x.k)), H=rowsBox.clientHeight, Wd=rowsBox.clientWidth;
  for(const [k,e] of rowEls) if(!keep.has(k)){e.classList.add('gone');rowEls.delete(k);setTimeout(()=>e.remove(),400);}
  top.forEach((x,i)=>{
    let e=rowEls.get(x.k), fresh=!e;
    if(fresh){
      e=div(L.bar?'hw-chip':'hw-row'); const b=div('bar');
      if(L.bar) e.append(b,el('span','tx',''),el('span','ct',''));
      else e.append(b,el('span','rk',''),el('span','tx',''),el('span','ct',''));
      e.classList.add('gone'); rowsBox.append(e); rowEls.set(x.k,e); requestAnimationFrame(()=>e.classList.remove('gone'));
    }
    e.classList.toggle('first',i===0);
    const old=e.dataset.n; e.dataset.n=x.n; if(old&&+old<x.n){e.classList.remove('hot');void e.offsetWidth;e.classList.add('hot');}
    e.querySelector('.tx').textContent=x.d; e.querySelector('.ct').textContent='×'+x.n;
    if(L.bar){
      const cw=(Wd-(n-1)*12)/n; e.style.width=cw+'px'; e.style.left=(i*(cw+12))+'px'; e.querySelector('.bar').style.height=(x.n/max*100)+'%';
    }else{
      const rh=H/n; e.style.height=(rh-8)+'px'; e.style.top=(i*rh)+'px'; e.querySelector('.rk').textContent=i+1; e.querySelector('.bar').style.width=(Math.max(8,x.n/max*100))+'%';
    }
  });
}
function renderTool(){paintLive();renderLiveList();}
function renderToolSidebar(){$('#btnDemo').textContent=i18n(demoT?'demoOff':'demoOn');}
function renderLiveList(){
  const box=$('#liveList'); if(!box) return;
  $('#liveStats').textContent=i18n('liveStats',{m:live.total,p:live.people,w:state.win});
  if(!live.top.length){box.replaceChildren(el('div','muted',i18n('liveEmpty')));return;}
  box.replaceChildren(...live.top.map(x=>{
    const it=div('it'); const b=el('b',null,x.d); const n=el('span',null,'×'+x.n);
    const ig=el('button','small ghost','✕'); ig.title='ignore'; ig.onclick=()=>{state.ignore=[...listSet(state.ignore),x.k].join(', ');toast(i18n('tIgnored',{w:x.d}));commit();};
    it.append(b,n,ig); return it;
  }));
}
function onPeerMessage(d){if(d.kwm==='kwm-hotwords-live'&&d.live&&!isOwner()){live=d.live;paintLive();}}
function tick(){
  if(!isOwner()) return;
  compute(); paintLive();
  const box=$('#liveList'), now=Date.now();
  if(!document.body.classList.contains('streaming')&&box&&now-lastList>1000&&!box.matches(':hover')){lastList=now;renderLiveList();}
  if(peers.size) sendPeers({kwm:'kwm-hotwords-live',live});
}

/* Demo: simuliert einen schnellen Chat */
const DEMO=['LUL','W','KEKW','F','GG','Pog','lol','HYPE','o7','Sadge','?','LETS GO','nice','omg','KEKW KEKW','W W','monkaS','Clap','first','L'];
let demoHot=0,demoHotT=0;
function demoStep(){
  const now=Date.now(); if(now-demoHotT>8000){demoHot=Math.floor(Math.random()*DEMO.length);demoHotT=now;}
  for(let i=0;i<3;i++){
    const r=Math.random(), w=r<.45?DEMO[demoHot]:r<.6?DEMO[(demoHot+3)%DEMO.length]:DEMO[Math.floor(Math.random()*DEMO.length)];
    onChatMessage({user:'demo'+Math.floor(Math.random()*70),text:w});
  }
}
function toolInit(){
  $('#btnDemo').onclick=()=>{if(demoT){clearInterval(demoT);demoT=0;}else demoT=setInterval(demoStep,250);renderToolSidebar();};
  $('#btnReset').onclick=()=>{events=[];compute();paintLive();renderLiveList();};
  setInterval(tick,250);
}
function onResize(){paintLive();}
