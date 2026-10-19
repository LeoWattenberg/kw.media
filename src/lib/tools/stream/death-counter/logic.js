/* ---------- Zähler ---------- */
const MAX_CT=6, VMIN=-999999, VMAX=9999999;
const DEF_CMDS={de:['!tod','!sieg'],en:['!death','!win']}, DEF_ICONS=['💀','🏆'];
const cleanCmd=s=>(String(s||'').trim().toLowerCase().split(/\s+/)[0]||'').slice(0,24);
function defCounters(lg){const n=inLang(lg,'defNames').split('|');return n.map((name,i)=>({id:'c'+(i+1),name,icon:DEF_ICONS[i],value:0,goal:0,cmd:DEF_CMDS[lg][i]}));}
function defaultState(){return {...commonDefaults(),format:'row',counters:defCounters(LANG),cmdWho:'mods',cooldown:10,showTimer:false,timerName:'',timerCmd:'!timer',timer:{run:false,start:0,acc:0},title:'',bgMode:'card',showGoal:true,log:[],focus:''};}
function normalize(s){
  const o=normalizeCommon(s,defaultState()); if(!s||typeof s!=='object') return o;
  if(Array.isArray(s.counters)){const seen=new Set();o.counters=s.counters.filter(c=>c&&typeof c.id==='string'&&c.id&&!seen.has(c.id)&&seen.add(c.id)).slice(0,MAX_CT).map(c=>({id:c.id.slice(0,24),name:String(c.name||'').slice(0,40),icon:String(c.icon||'').slice(0,8),value:Math.max(VMIN,Math.min(VMAX,Math.round(+c.value||0))),goal:Math.max(0,Math.min(VMAX,Math.round(+c.goal||0))),cmd:String(c.cmd||'').slice(0,24)}));}
  if(['mods','vip','all'].includes(s.cmdWho)) o.cmdWho=s.cmdWho;
  if([5,10,30,60].includes(s.cooldown)) o.cooldown=s.cooldown;
  for(const k of ['showTimer','showGoal']) if(typeof s[k]==='boolean') o[k]=s[k];
  for(const k of ['timerName','timerCmd','title']) if(typeof s[k]==='string') o[k]=s[k].slice(0,60);
  const t=s.timer; if(t&&typeof t==='object') o.timer={run:!!t.run,start:+t.start||0,acc:Math.max(0,+t.acc||0)};
  if(['card','magenta','full'].includes(s.bgMode)) o.bgMode=s.bgMode;
  if(Array.isArray(s.log)) o.log=s.log.filter(l=>l&&typeof l.id==='string').slice(0,50).map(l=>({id:l.id,from:+l.from||0,to:+l.to||0,t:+l.t||0,by:String(l.by||'').slice(0,30)}));
  if(typeof s.focus==='string') o.focus=s.focus;
  return o;
}
function beforeLangSwitch(from,to){
  const d=defCounters(from); state.counters.forEach((c,i)=>{if(d[i]&&c.id===d[i].id){const n=defCounters(to)[i];if(c.name===d[i].name) c.name=n.name;if(c.cmd===d[i].cmd) c.cmd=n.cmd;}});
}
const seeThrough=()=>state.bgMode==='card';
const ctById=id=>state.counters.find(c=>c.id===id);
const nameOf=c=>c.name.trim()||'#'+(state.counters.indexOf(c)+1);
const elapsed=()=>state.timer.acc+(state.timer.run?Math.max(0,Date.now()-state.timer.start):0);
function fmtTime(ms){const s=Math.floor(ms/1000),h=Math.floor(s/3600),m=Math.floor(s%3600/60);return (h?h+':'+pad2(m):m)+':'+pad2(s%60);}
const fmtNum=v=>v.toLocaleString(LANG==='de'?'de-DE':'en-US');

/* ---------- Ändern ---------- */
function change(id,to,by){
  const c=ctById(id); if(!c) return;
  to=Math.max(VMIN,Math.min(VMAX,Math.round(to))); if(to===c.value) return;
  state.log.unshift({id,from:c.value,to,t:Date.now(),by:by||''}); state.log=state.log.slice(0,50);
  c.value=to; commit({skipSidebar:true});
}
const bump=(id,d)=>{const c=ctById(id);if(c) change(id,c.value+d,'');};
function undo(){
  const l=state.log.shift(); if(!l){return;}
  const c=ctById(l.id); if(c){c.value=l.from;toast(i18n('tUndone',{n:nameOf(c),v:fmtNum(l.from)}));}
  commit({skipSidebar:true});
}
function timerToggle(on){
  const t=state.timer, run=on===undefined?!t.run:on; if(run===t.run) return;
  if(run){t.start=Date.now();t.run=true;}else{t.acc+=Math.max(0,Date.now()-t.start);t.run=false;}
  commit({skipSidebar:true});
}
function timerReset(){state.timer={run:false,start:0,acc:0};commit({skipSidebar:true});}

/* ---------- Chat ---------- */
const lastAll=new Map();
function onChatMessage(m){
  if(!state) return;
  const parts=String(m.text||'').trim().split(/\s+/), c0=(parts[0]||'').toLowerCase(), arg=(parts[1]||'').toLowerCase();
  if(!c0) return;
  const staff=m.broadcaster||m.mod, allowed=staff||(state.cmdWho==='vip'&&m.vip)||state.cmdWho==='all'||(state.cmdWho==='vip'&&staff);
  if(!allowed) return;
  const who=String(m.name||m.user).slice(0,30);
  if(state.showTimer&&c0===cleanCmd(state.timerCmd)){
    if(!staff&&!m.vip) return;
    if(arg==='start'||arg==='go') timerToggle(true);
    else if(arg==='stop'||arg==='pause') timerToggle(false);
    else if(arg==='reset'&&staff) timerReset();
    else if(!arg) timerToggle();
    return;
  }
  const c=state.counters.find(x=>cleanCmd(x.cmd)&&cleanCmd(x.cmd)===c0); if(!c) return;
  const full=staff||(state.cmdWho!=='all'&&m.vip);
  if(!full){
    if(arg&&arg!=='+') return;
    const now=Date.now(), last=lastAll.get(c.id)||0; if(now-last<state.cooldown*1000) return; lastAll.set(c.id,now);
    change(c.id,c.value+1,who); return;
  }
  let to;
  if(!arg||arg==='+') to=c.value+1;
  else if(arg==='-') to=c.value-1;
  else if(/^[+-]\d{1,6}$/.test(arg)) to=c.value+parseInt(arg,10);
  else if(/^=?\d{1,7}$/.test(arg)) to=parseInt(arg.replace('=',''),10);
  else return;
  change(c.id,to,who);
}

/* ---------- Layout & Bühne ---------- */
function computeLayout(){
  if(state.format==='stack') return {W:600,H:780};
  if(state.format==='big') return {W:900,H:520};
  return {W:1600,H:200};
}
let lastVals=new Map(), curL=null; const anims=new Map();
function tiles(){const t=state.counters.map(c=>({c}));if(state.showTimer) t.push({timer:true});return t;}
function buildStage(L,out){
  curL=L; const st=stage.style;
  st.setProperty('--ct-fg',textOn(state.bg)==='#000000'?'0,0,0':'255,255,255');
  st.setProperty('--ct-card',state.bgMode==='full'?rgba(lighten(state.bg,.06),.75):rgba(state.bg,.94));
  if(state.bgMode==='full') out.push(bgLayer(L));
  else if(state.bgMode==='magenta'){const m=div('rg');place(m,{x:0,y:0,w:L.W,h:L.H});m.style.background='#ff00ff';out.push(m);}
  for(const c of state.counters){const pv=lastVals.get(c.id);if(pv!==undefined&&pv!==c.value) anims.set(c.id,{d:c.value-pv,t0:performance.now()});}
  const card=div('rg ct-card ct-'+state.format+(state.brand?' has-brand':'')); place(card,{x:0,y:0,w:L.W,h:L.H});
  const title=state.title.trim();
  if(state.format==='big') buildBig(L,card,title);
  else{
    if(title){const h=div('ct-head');const t=el('div','ct-title',title);h.append(t);card.append(h);}
    const box=div('ct-tiles'); card.append(box);
    const T=tiles(), n=Math.max(1,T.length);
    const rowW=state.format==='row'?(L.W-(title?300:0)-40-(n-1)*14)/n:L.W-48;
    const rowH=state.format==='stack'?Math.min(150,(L.H-(title?96:24)-(state.brand?50:24)-(n-1)*12)/n):L.H-36-(state.brand?24:0);
    for(const t of T) box.append(tileEl(t,rowW,rowH));
    if(!T.length) box.append(el('div','ct-empty','–'));
  }
  if(state.brand){
    const bh=state.format==='row'?22:26, b=brandBox({x:0,y:0,w:10,h:bh},state.bg); b.classList.remove('rg'); b.classList.add('ct-brand');
    b.style.cssText+=';position:absolute;width:auto;height:auto;left:auto;top:auto'; card.append(b);
  }
  out.push(card);
  for(const c of state.counters) lastVals.set(c.id,c.value);
}
function floatEl(id,v,cls){
  const a=anims.get(id); if(!a) return null; const age=performance.now()-a.t0;
  if(age>1200){anims.delete(id);return null;}
  if(age<550){v.classList.add('bump');v.style.animationDelay=(-age)+'ms';}
  const f=el('div','ct-float'+cls+(a.d<0?' neg':''),(a.d>0?'+':'−')+fmtNum(Math.abs(a.d))); f.style.animationDelay=(-age)+'ms'; return f;
}
function valFs(v,w,base){const len=Math.max(2,String(fmtNum(v)).length);return Math.round(Math.min(base,w/(len*.62)));}
function tileEl(t,w,h){
  const row=state.format==='row', e=div('ct-tile'); e.style.width=w+'px'; e.style.height=h+'px';
  if(t.timer){
    e.classList.add('ct-timer');
    const ic=el('div','ct-ic','⏱'), info=div('ct-info'), nm=el('div','ct-name',state.timerName.trim()||i18n('timerDefault')), v=el('div','ct-val',fmtTime(elapsed()));
    const fs=row?Math.min(76,h*.44,w*.17):Math.min(70,h*.5); v.style.fontSize=Math.round(fs)+'px'; nm.style.fontSize=Math.round(fs*.32)+'px'; ic.style.fontSize=Math.round(fs*.7)+'px';
    if(!state.timer.run) e.classList.add('paused');
    info.append(nm,v); e.append(ic,info); return e;
  }
  const c=t.c, prev=lastVals.get(c.id), reached=c.goal>0&&c.value>=c.goal;
  if(reached) e.classList.add('reached');
  const ic=c.icon.trim()?el('div','ct-ic',c.icon.trim()):null;
  const info=div('ct-info'), nm=el('div','ct-name',nameOf(c));
  const base=row?Math.min(84,h*.48):Math.min(80,h*.55), vw=row?w-(ic?base*1.1:0)-40:w*.42;
  const vr=div('ct-vrow'), v=el('div','ct-val',fmtNum(c.value)); v.style.fontSize=valFs(c.value,vw,base)+'px';
  vr.append(v);
  if(c.goal>0&&state.showGoal){const g=el('div','ct-goal','/ '+fmtNum(c.goal));g.style.fontSize=Math.round(base*.36)+'px';vr.append(g);}
  nm.style.fontSize=Math.round(base*.3)+'px'; if(ic) ic.style.fontSize=Math.round(base*.72)+'px';
  info.append(nm,vr);
  if(ic) e.append(ic); e.append(info);
  if(c.goal>0&&state.showGoal){const bar=div('ct-bar'),i=el('i');i.style.width=Math.max(0,Math.min(100,c.value/c.goal*100))+'%';bar.append(i);e.append(bar);}
  const fl=floatEl(c.id,v,''); if(fl){fl.style.fontSize=Math.round(base*.42)+'px';e.append(fl);}
  return e;
}
function buildBig(L,card,title){
  const c=ctById(state.focus)||state.counters[0];
  card.classList.add('ct-bigc');
  if(title){const t=el('div','ct-title',title);t.style.fontSize='30px';card.append(t);}
  if(!c){card.append(el('div','ct-empty','–'));return;}
  const prev=lastVals.get(c.id), reached=c.goal>0&&c.value>=c.goal;
  const head=div('ct-bhead'); if(c.icon.trim()) head.append(el('span','ct-ic',c.icon.trim())); head.append(el('span','ct-name',nameOf(c)));
  const hasGoal=c.goal>0&&state.showGoal, used=60+(title?46:0)+54+(hasGoal?70:0)+(state.showTimer?46:0)+12*(2+(title?1:0)+(hasGoal?1:0)+(state.showTimer?1:0));
  const v=el('div','ct-val',fmtNum(c.value)); v.style.fontSize=Math.round(Math.min(valFs(c.value,L.W-120,220),(L.H-used)*1.05))+'px';
  card.append(head,v);
  if(reached) card.classList.add('reached');
  if(c.goal>0&&state.showGoal){
    const g=div('ct-bgoal'), bar=div('ct-bar'), i=el('i'); i.style.width=Math.max(0,Math.min(100,c.value/c.goal*100))+'%'; bar.append(i);
    g.append(bar,el('span',null,reached?i18n('goalReached'):fmtNum(c.value)+' / '+fmtNum(c.goal))); card.append(g);
  }
  if(state.showTimer){const t=div('ct-btimer');t.append(el('span',null,'⏱ '+(state.timerName.trim()||i18n('timerDefault'))),el('b','ct-tval',fmtTime(elapsed())));if(!state.timer.run) t.classList.add('paused');card.append(t);}
  const fl=floatEl(c.id,v,' big'); if(fl) card.append(fl);
}

/* ---------- Editor ---------- */
let zeroArm=0, resetArm=0, editDirty=false;
function renderTool(){renderPanel();}
function renderPanel(){
  const box=$('#ctrlList'); if(!box) return;
  box.replaceChildren(...state.counters.map((c,i)=>{
    const r=div('ct-ctrl'+(c.goal>0&&c.value>=c.goal?' reached':''));
    const lab=div('ct-lab'); lab.append(el('kbd',null,String(i+1)),el('span','ct-ci',c.icon||''),el('b',null,nameOf(c)));
    const minus=el('button','ct-pm','−'), plus=el('button','ct-pm primary','+'), val=el('div','ct-v',fmtNum(c.value));
    minus.onclick=()=>bump(c.id,-1); plus.onclick=()=>bump(c.id,1);
    const goal=el('span','ct-g',c.goal>0?'/ '+fmtNum(c.goal):'');
    const zero=el('button','small ghost','0'); zero.title='0'; zero.onclick=()=>change(c.id,0,'');
    r.append(lab,minus,val,plus,goal,zero); return r;
  }));
  $('#timerCtl').hidden=!state.showTimer;
  $('#btnTimer').textContent=i18n(state.timer.run?'timerPause':'timerStart');
  $('#timerVal').textContent=fmtTime(elapsed());
  $('#btnUndo').disabled=!state.log.length;
  const lg=$('#logList');
  if(!state.log.length) lg.replaceChildren(el('div','muted',i18n('logEmpty')));
  else lg.replaceChildren(...state.log.slice(0,12).map(l=>{
    const c=ctById(l.id), it=div('it');
    it.append(el('small',null,new Date(l.t).toTimeString().slice(0,8)),el('b',null,c?nameOf(c):'?'),el('span',null,fmtNum(l.from)+' → '+fmtNum(l.to)),el('small',null,i18n('logBy',{n:l.by||i18n('logYou')})));
    return it;
  }));
}
function renderToolSidebar(){
  const box=$('#ctEdit'); if(!box) return;
  const ae=document.activeElement; if(ae&&ae.tagName==='INPUT'&&box.contains(ae)){editDirty=true;}
  else{
    editDirty=false;
    box.replaceChildren(...state.counters.map(c=>{
      const r=div('ct-erow');
      const mk=(cls,val,ph,max,type,title)=>{const x=document.createElement('input');x.type=type||'text';x.className=cls;x.value=val;x.placeholder=ph;if(max) x.maxLength=max;if(title) x.title=title;x.spellcheck=false;x.autocomplete='off';x.onblur=()=>{if(editDirty) setTimeout(renderToolSidebar,0);};return x;};
      const ic=mk('ct-eic',c.icon,i18n('phIcon'),8), nm=mk('ct-enm',c.name,i18n('phName'),40), cmd=mk('ct-ecmd',c.cmd,i18n('phCmd'),24,'text',i18n('cmdTitle')), goal=mk('ct-egoal',c.goal||'',i18n('phGoal'),7,'number',i18n('goalTitle'));
      goal.min='0';
      const upd=(k,fn)=>e=>{const x=ctById(c.id);if(!x) return;x[k]=fn(e.target.value);commit({skipSidebar:true});};
      ic.oninput=upd('icon',v=>v.slice(0,8)); nm.oninput=upd('name',v=>v.slice(0,40)); cmd.oninput=upd('cmd',v=>v.slice(0,24)); goal.oninput=upd('goal',v=>Math.max(0,Math.min(VMAX,Math.round(+v||0))));
      const x=el('button','small ghost','✕'); x.onclick=()=>{state.counters=state.counters.filter(k=>k.id!==c.id);commit();};
      const l1=div('ct-el'); l1.append(ic,nm,x); const l2=div('ct-el'); l2.append(cmd,goal);
      r.append(l1,l2); return r;
    }));
  }
  $('#btnAddCt').disabled=state.counters.length>=MAX_CT;
  $('#timerFields').hidden=!state.showTimer;
  $('#cdRow').hidden=state.cmdWho!=='all';
  const fs=$('#focusSel'); fs.replaceChildren(...state.counters.map(c=>{const o=document.createElement('option');o.value=c.id;o.textContent=(c.icon?c.icon+' ':'')+nameOf(c);return o;}));
  fs.value=ctById(state.focus)?state.focus:(state.counters[0]||{}).id||''; $('#focusRow').hidden=state.format!=='big';
}
function toolKeys(e){
  if(e.ctrlKey||e.metaKey||e.altKey) return false;
  const m=/^Digit([1-6])$/.exec(e.code);
  if(m){const c=state.counters[+m[1]-1];if(c){bump(c.id,e.shiftKey?-1:1);return true;}return false;}
  if(e.key==='t'||e.key==='T'){if(state.showTimer) timerToggle();return true;}
  if(e.key==='z'||e.key==='Z'){undo();return true;}
  return false;
}
function toolInit(){
  $('#btnAddCt').onclick=()=>{
    if(state.counters.length>=MAX_CT){toast(i18n('tMax'));return;}
    state.counters.push({id:uid(),name:'',icon:'',value:0,goal:0,cmd:''}); commit();
    setTimeout(()=>{const x=$$('#ctEdit .ct-enm');if(x.length) x[x.length-1].focus();},0);
  };
  $('#btnUndo').onclick=undo;
  $('#btnTimer').onclick=()=>timerToggle();
  $('#btnTimerReset').onclick=e=>{const b=e.currentTarget;if(!resetArm){b.textContent=i18n('timerResetSure');resetArm=setTimeout(()=>{resetArm=0;b.textContent=i18n('timerReset');},3000);return;}clearTimeout(resetArm);resetArm=0;b.textContent=i18n('timerReset');timerReset();};
  $('#btnZero').onclick=e=>{
    const b=e.currentTarget;
    if(!zeroArm){b.textContent=i18n('allZeroSure');zeroArm=setTimeout(()=>{zeroArm=0;b.textContent=i18n('allZero');},3000);return;}
    clearTimeout(zeroArm);zeroArm=0;b.textContent=i18n('allZero');
    for(const c of state.counters) if(c.value!==0){state.log.unshift({id:c.id,from:c.value,to:0,t:Date.now(),by:''});c.value=0;}
    state.log=state.log.slice(0,50); commit({skipSidebar:true});
  };
  $('#focusSel').onchange=e=>{state.focus=e.target.value;commit({skipSidebar:true});e.target.blur();};
  setInterval(()=>{
    if(!state.showTimer) return;
    const s=fmtTime(elapsed());
    for(const v of $$('.ct-timer .ct-val, .ct-btimer .ct-tval',stage)) if(v.textContent!==s) v.textContent=s;
    const tv=$('#timerVal'); if(tv&&tv.textContent!==s) tv.textContent=s;
  },250);
}
