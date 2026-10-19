/* ---------- Glücksrad ---------- */
const DEFAULT_ITEMS={
  de:'Horror-Game\nNoch eine Runde\nZuschauer-Runde\nQ&A\nSpeedrun-Versuch\nChat wählt das Spiel\nChallenge-Run\nKurze Pause',
  en:'Horror game\nOne more round\nViewer round\nQ&A\nSpeedrun attempt\nChat picks the game\nChallenge run\nShort break'};
const TEST_NAMES=['pixelpanda','LunaLive','KaffeeKlaus','nordlicht92','ByteBiene','Spielkind','ZockerOma','GG_Gregor','MiaMaus','TheRealKev','Kartoffelkoenig','NightOwl','Schnitzelboss','lowpingHigh','glitchy','Moonwalker','cozyclara','Ruhrpott_Rene','frostbyte','Hasenfuss'];
const MAX_JOIN=5000, MAX_ITEMS=1000;
const cleanCmd=s=>(String(s||'').trim().toLowerCase().split(/\s+/)[0]||'').slice(0,24);
const cmdText=()=>cleanCmd(state.cmd)||'!join';

function defaultState(){return {...commonDefaults(),cams:0,mode:'list',items:DEFAULT_ITEMS[LANG],cmd:'!join',who:'all',open:false,joined:[],dur:7,claimSec:60,autoRemove:false,sound:true,confetti:true,
  title:'',winLabel:'',hint:'',palette:'brand',bgMode:'full',spin:null,banner:'',claimed:null,history:[],tipSeen:false};}
function normalize(s){
  const o=normalizeCommon(s,defaultState()); if(!s||typeof s!=='object') return o;
  if(['list','chat'].includes(s.mode)) o.mode=s.mode;
  if(typeof s.items==='string') o.items=s.items.slice(0,30000);
  if(typeof s.cmd==='string') o.cmd=s.cmd.slice(0,24);
  if(['all','subs'].includes(s.who)) o.who=s.who;
  if(Array.isArray(s.joined)){const seen=new Set();o.joined=s.joined.filter(j=>j&&typeof j.u==='string'&&j.u&&!seen.has(j.u)&&seen.add(j.u)).slice(0,MAX_JOIN).map(j=>({u:j.u.slice(0,40),n:String(j.n||j.u).slice(0,40),t:+j.t||0}));}
  if([4,7,12].includes(s.dur)) o.dur=s.dur;
  if([0,30,60,120].includes(s.claimSec)) o.claimSec=s.claimSec;
  for(const k of ['open','autoRemove','sound','confetti','tipSeen']) if(typeof s[k]==='boolean') o[k]=s[k];
  for(const k of ['title','winLabel','hint']) if(typeof s[k]==='string') o[k]=s[k].slice(0,120);
  if(['brand','rainbow'].includes(s.palette)) o.palette=s.palette;
  if(['full','transparent','magenta'].includes(s.bgMode)) o.bgMode=s.bgMode;
  const sp=s.spin;
  if(sp&&typeof sp==='object'&&typeof sp.id==='string'&&[sp.from,sp.to,sp.dur,sp.at].every(Number.isFinite))
    o.spin={id:sp.id.slice(0,40),from:sp.from,to:sp.to,dur:Math.min(20000,Math.max(500,sp.dur)),at:sp.at,winner:String(sp.winner||'').slice(0,80),wu:typeof sp.wu==='string'?sp.wu.slice(0,40):'',n:+sp.n||0};
  if(typeof s.banner==='string') o.banner=s.banner.slice(0,40);
  if(s.claimed&&typeof s.claimed==='object'&&typeof s.claimed.text==='string') o.claimed={text:s.claimed.text.slice(0,160),t:+s.claimed.t||0};
  if(Array.isArray(s.history)) o.history=s.history.filter(h=>h&&typeof h.w==='string').slice(0,100).map(h=>({w:h.w.slice(0,80),t:+h.t||0}));
  return o;
}
function beforeLangSwitch(from,to){if(state.items===DEFAULT_ITEMS[from]) state.items=DEFAULT_ITEMS[to];}
const hasCamsNow=()=>state.format!=='wheel'&&state.cams>0;
const seeThrough=()=>state.bgMode==='transparent'||(state.bgMode==='full'&&state.camFill==='transparent'&&hasCamsNow());

function entries(){
  if(state.mode==='chat') return state.joined.map(j=>({label:j.n||j.u,u:j.u}));
  return String(state.items||'').split('\n').map(x=>x.trim().slice(0,60)).filter(Boolean).slice(0,MAX_ITEMS).map(label=>({label}));
}

/* Fairer Zufall (crypto, ohne Modulo-Verzerrung) */
function rnd(){const a=new Uint32Array(1);crypto.getRandomValues(a);return a[0]/4294967296;}
function rndInt(n){const lim=Math.floor(4294967296/n)*n,a=new Uint32Array(1);do crypto.getRandomValues(a);while(a[0]>=lim);return a[0]%n;}

/* ---------- Farben ---------- */
function hsl(h,s,l){h=((h%360)+360)%360;const k=n=>(n+h/30)%12,a=s*Math.min(l,1-l),f=n=>l-a*Math.max(-1,Math.min(k(n)-3,9-k(n),1));return '#'+[f(0),f(8),f(4)].map(v=>Math.round(v*255).toString(16).padStart(2,'0')).join('');}
const shade=t=>lum(state.bg)>.4?mix(state.bg,'#000000',t):mix(state.bg,'#ffffff',t);
function sliceColors(n){
  if(state.palette==='rainbow') return Array.from({length:n},(_,i)=>hsl(i*360/n+12,.78,.56));
  const cyc=[state.accent,shade(.13),mix(state.accent,state.bg,.42),shade(.24)];
  const out=Array.from({length:n},(_,i)=>cyc[i%4]); if(n>1&&n%4===1) out[n-1]=cyc[2]; return out;
}

/* ---------- Rad zeichnen (Canvas, gecacht) ---------- */
let wheelCv=null, wheelSig='', curN=0;
function wheelCanvas(R,list){
  const n=list.length, cols=sliceColors(n), sig=[R,state.palette,state.accent,state.bg,...list.map(e=>e.label)].join('\u0001');
  if(!wheelCv){wheelCv=document.createElement('canvas');wheelCv.className='rg wh-canvas';}
  if(sig===wheelSig) return wheelCv;
  wheelSig=sig; const D=2*R; wheelCv.width=D; wheelCv.height=D;
  const g=wheelCv.getContext('2d'); g.clearRect(0,0,D,D); g.save(); g.translate(R,R);
  if(!n){g.beginPath();g.arc(0,0,R,0,Math.PI*2);g.fillStyle=shade(.1);g.fill();}
  else{
    const s=Math.PI*2/n;
    for(let i=0;i<n;i++){const a0=-Math.PI/2+i*s;g.beginPath();g.moveTo(0,0);g.arc(0,0,R,a0,a0+s+(n>1?.002:0));g.closePath();g.fillStyle=cols[i];g.fill();}
    if(n>1&&n<=180){g.strokeStyle='rgba(0,0,0,.28)';g.lineWidth=Math.max(1,R*.006);for(let i=0;i<n;i++){const a=-Math.PI/2+i*s;g.beginPath();g.moveTo(0,0);g.lineTo(Math.cos(a)*R,Math.sin(a)*R);g.stroke();}}
    const rIn=R*.25, rOut=R*.9, maxLen=rOut-rIn, h=n===1?R:2*R*.6*Math.sin(Math.min(s,Math.PI)/2), fs=Math.min(R*.1,h*.62);
    if(fs>=10){
      g.textAlign='right'; g.textBaseline='middle';
      for(let i=0;i<n;i++){
        g.save(); g.rotate(-Math.PI/2+(i+.5)*s);
        let f=Math.floor(fs), t=list[i].label; g.font=`700 ${f}px ${FONT}`;
        while(g.measureText(t).width>maxLen&&f>fs*.62){f--;g.font=`700 ${f}px ${FONT}`;}
        t=ellipsize(g,t,maxLen); g.fillStyle=textOn(cols[i]); g.fillText(t,rOut,0); g.restore();
      }
    }
  }
  const gr=g.createRadialGradient(0,0,R*.55,0,0,R); gr.addColorStop(0,'rgba(0,0,0,0)'); gr.addColorStop(1,'rgba(0,0,0,.22)');
  g.beginPath(); g.arc(0,0,R,0,Math.PI*2); g.fillStyle=gr; g.fill();
  g.restore(); return wheelCv;
}

/* ---------- Layout ---------- */
function camRects16(n){if(n===1) return [{x:1110,y:40,w:770,h:433,r:18}];if(n===2) return [{x:1110,y:40,w:377,h:212,r:16},{x:1503,y:40,w:377,h:212,r:16}];return [];}
function computeLayout(){
  const n=state.cams;
  if(state.format==='wheel') return {W:1000,H:1060,cams:[],wheel:{cx:500,cy:520,R:430},banner:{x:40,y:340,w:920,h:360},brand:{x:320,y:1014,w:360,h:30},solo:true};
  if(state.format==='9:16'){
    const cams=camRects9x16(n), y0=cams.length?608:0, title={x:60,y:y0+36,w:960,h:cams.length?84:120};
    const top=title.y+title.h+70, bottomH=cams.length?250:300, R=Math.round(Math.min(470,(1920-bottomH-top-40)/2)), cy=top+R;
    return {W:1080,H:1920,cams,title,wheel:{cx:540,cy,R},info:{x:40,y:cy+R+50,w:1000,h:1920-(cy+R+50)-30},compact:true,banner:{x:50,y:cy-210,w:980,h:420}};
  }
  const cams=camRects16(n), top=cams.length?cams[0].y+cams[0].h+30:40;
  return {W:1920,H:1080,cams,wheel:{cx:565,cy:560,R:440},info:{x:1110,y:top,w:770,h:1040-top},banner:{x:85,y:350,w:960,h:420}};
}

/* ---------- Bühne ---------- */
let curL=null, curRot=0, lastInfoBuild=0, confettiCv=null, confettiEnd=0;
const spinning=()=>{const s=state.spin;return !!(s&&Date.now()<s.at+s.dur);};
const bannerOn=()=>{const s=state.spin;return !!(s&&state.banner===s.id&&Date.now()>=s.at+s.dur);};
const titleText=()=>state.title.trim()||i18n(state.mode==='chat'?'titleChat':'titleList');
function buildStage(L,out){
  curL=L; const fg=textOn(state.bg)==='#000000'?'0,0,0':'255,255,255', st=stage.style;
  st.setProperty('--wh-fg',fg); st.setProperty('--wh-card',state.bgMode==='full'?rgba(lighten(state.bg,.06),.7):rgba(state.bg,.94));
  st.setProperty('--wh-hub',state.bg); st.setProperty('--wh-banner',lighten(state.bg,.025)); st.setProperty('--wh-rimbg',state.bg);
  if(state.bgMode==='full') out.push(bgLayer(L,state.camFill==='transparent'?L.cams:[]));
  else if(state.bgMode==='magenta'){const m=div('rg');place(m,{x:0,y:0,w:L.W,h:L.H});m.style.background='#ff00ff';out.push(m);}
  camEls(L,out);
  const list=entries(); curN=list.length;
  buildWheel(L.wheel,list,out);
  if(L.title){const t=div('rg wh-title2');place(t,L.title);fitInto(t,titleText(),L.title.w,L.title.h,Math.round(L.title.h*.8),800,1.05,1);out.push(t);}
  if(L.info) out.push(buildInfo(L,list));
  if(L.solo&&state.brand){const b=brandBox(L.brand,state.bg);b.classList.add('wh-pill');out.push(b);}
  if(bannerOn()) out.push(buildBanner(L));
  if(confettiCv&&performance.now()<confettiEnd) out.push(confettiCv);
  lastInfoBuild=Date.now();
}
function buildWheel(Wh,list,out){
  const {cx,cy,R}=Wh, bw=Math.round(R*.045);
  const sh=div('rg wh-shadow'); place(sh,{x:cx-R-bw,y:cy-R-bw,w:2*(R+bw),h:2*(R+bw)}); out.push(sh);
  const cv=wheelCanvas(R,list); place(cv,{x:cx-R,y:cy-R,w:2*R,h:2*R}); cv.style.transform=`rotate(${curRot}deg)`; out.push(cv);
  const S=2*(R+bw*2), c=S/2, NB=24, br=R*.016, rb=R+bw/2;
  let bulbs=''; for(let i=0;i<NB;i++){const a=i/NB*Math.PI*2;bulbs+=`<circle class="b${i%2?' o':''}" cx="${(c+Math.cos(a)*rb).toFixed(1)}" cy="${(c+Math.sin(a)*rb).toFixed(1)}" r="${br.toFixed(1)}"/>`;}
  const w=document.createElement('div');
  w.innerHTML=`<svg class="rg wh-rim" style="left:${cx-c}px;top:${cy-c}px" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}"><circle cx="${c}" cy="${c}" r="${rb}" fill="none" stroke="${state.accent}" stroke-width="${bw}"/><circle cx="${c}" cy="${c}" r="${R}" fill="none" stroke="rgba(0,0,0,.35)" stroke-width="${Math.max(2,R*.01)}"/>${bulbs}</svg>`;
  out.push(w.firstChild);
  const hr=Math.round(R*.17), hub=div('rg wh-hub'); place(hub,{x:cx-hr,y:cy-hr,w:2*hr,h:2*hr}); hub.style.borderWidth=Math.round(R*.022)+'px';
  const hn=el('div','n',String(list.length)); hn.style.fontSize=Math.round(R*(list.length>999?.085:.115))+'px';
  const hl=el('div','l',i18n(state.mode==='chat'?'hubChat':'hubList')); hl.style.fontSize=Math.round(R*.04)+'px';
  hub.append(hn,hl); out.push(hub);
  const pw=Math.round(R*.15), ph=Math.round(R*.18), tipY=cy-R+Math.round(R*.07), p=div('rg wh-pointer');
  place(p,{x:cx-pw/2,y:tipY-ph,w:pw,h:ph}); p.style.transformOrigin=`${pw/2}px ${Math.round(ph*.26)}px`;
  p.innerHTML=`<svg width="${pw}" height="${ph}" viewBox="0 0 ${pw} ${ph}"><path d="M${pw*.08} ${ph*.06}H${pw*.92}L${pw/2} ${ph*.96}Z" fill="${state.accent}" stroke="#fff" stroke-width="${Math.max(2,R*.012).toFixed(1)}" stroke-linejoin="round"/><circle cx="${pw/2}" cy="${ph*.26}" r="${pw*.12}" fill="#fff" opacity=".92"/></svg>`;
  out.push(p);
}
function buildInfo(L,list){
  const I=L.info, box=div('rg wh-info'+(L.compact?' compact':'')); place(box,I);
  if(!L.compact){const t=div('wh-title');fitInto(t,titleText(),I.w-72,100,76,800,1.05,2);box.append(t);}
  const top=div('wh-top');
  if(state.mode==='chat'){
    const cta=div('wh-cta'+(state.open?'':' closed'));
    if(state.open) cta.append(el('span',null,i18n('ctaPre')),el('b','wh-cmd',cmdText()),el('span',null,i18n('ctaPost')));
    else cta.append(el('span',null,i18n(state.joined.length?'ctaClosed':'ctaSoon')));
    top.append(cta);
  }
  const cnt=div('wh-count'); cnt.append(el('b',null,String(list.length)),el('span',null,i18n(state.mode==='chat'?'countChat':'countList')));
  top.append(cnt); box.append(top);
  const rec=div('wh-recent');
  if(state.mode==='chat'){
    if(!L.compact) rec.append(el('div','h',i18n('recentChat')));
    const last=state.joined.slice(-40).reverse();
    if(!last.length) rec.append(el('div','empty',i18n('waitJoin')));
    for(const j of last) rec.append(el('div','it'+(j.t>lastInfoBuild&&lastInfoBuild?' new':''),j.n||j.u));
  }else{
    rec.append(el('div','h',i18n('recentList')));
    if(!state.history.length) rec.append(el('div','empty',i18n('recentEmpty')));
    for(const h of state.history.slice(0,12)) rec.append(el('div','it',h.w));
  }
  box.append(rec);
  const hint=state.hint.trim();
  if(hint||state.brand){
    const f=div('wh-foot'); f.append(el('div','wh-hint',hint));
    if(state.brand){const b=brandBox({x:0,y:0,w:10,h:L.compact?26:30},state.bg);b.classList.remove('rg');b.style.cssText+=';position:static;width:auto;height:auto';f.append(b);}
    box.append(f);
  }
  return box;
}
function fmtSec(s){return Math.floor(s/60)+':'+pad2(s%60);}
function claimInfo(){
  const s=state.spin; if(!s||!s.wu) return null;
  const end=s.at+s.dur, dl=end+state.claimSec*1000;
  if(state.claimed) return {cls:'ok',txt:i18n(state.claimSec&&state.claimed.t>dl?'claimLate':'claimOk',{n:s.winner}),msg:state.claimed.text};
  if(!state.claimSec) return {cls:'',txt:i18n('claimAsk')};
  const left=Math.ceil((dl-Date.now())/1000);
  if(left<=0) return {cls:'no',txt:i18n('claimNo')};
  return {cls:'wait',txt:i18n('claimWait',{t:fmtSec(left)})};
}
function buildBanner(L){
  const B=L.banner, b=div('rg wh-banner'); place(b,B);
  const lab=el('div','wh-bl',state.winLabel.trim()||i18n(state.spin.wu?'winChat':'winList')); lab.style.fontSize=Math.round(B.h*.085)+'px';
  const nm=div('wh-bn'); fitInto(nm,state.spin.winner,B.w-100,B.h*.42,Math.round(B.h*.3),800,1.05,2);
  b.append(lab,nm);
  const ci=claimInfo();
  if(ci){
    const c=el('div','wh-claim '+ci.cls,ci.txt); c.style.fontSize=Math.round(B.h*.075)+'px'; b.append(c);
    if(ci.msg){const m=el('div','wh-msg','»'+ci.msg+'«');m.style.fontSize=Math.round(B.h*.065)+'px';b.append(m);}
  }
  return b;
}

/* ---------- Drehen ---------- */
let raf=0, animId='', mySpin='', lastSlice=null;
const ended=new Set(), ease=t=>1-Math.pow(1-t,4);
function setRot(a){
  curRot=a; if(wheelCv) wheelCv.style.transform=`rotate(${a}deg)`;
  const p=$('.wh-pointer',stage); if(curN<2){if(p) p.style.transform='';return;}
  const s=360/curN, phi=((-a)%360+360)%360, idx=Math.floor(phi/s), frac=(phi%s)/s;
  if(p) p.style.transform=s>=4&&frac>.75&&raf?`rotate(${(-(frac-.75)/.25*24).toFixed(2)}deg)`:'';
  if(raf&&lastSlice!==null&&idx!==lastSlice) tickSound();
  lastSlice=idx;
}
function syncSpin(){
  const s=state.spin; if(!s) return;
  if(Date.now()>=s.at+s.dur){
    const was=raf&&animId===s.id; if(raf){cancelAnimationFrame(raf);raf=0;}
    animId=s.id; setRot(s.to); stage.classList.remove('wh-spinning');
    if(was) finishSpin(s); else ended.add(s.id);
    return;
  }
  if(animId===s.id&&raf) return;
  if(raf) cancelAnimationFrame(raf);
  animId=s.id; lastSlice=null; stage.classList.add('wh-spinning');
  const step=()=>{
    if(!state.spin||state.spin.id!==s.id){raf=0;return;}
    const t=Math.min(1,Math.max(0,(Date.now()-s.at)/s.dur));
    setRot(s.from+(s.to-s.from)*ease(t));
    if(t<1) raf=requestAnimationFrame(step); else{raf=0;setRot(s.to);finishSpin(s);}
  };
  raf=requestAnimationFrame(step);
}
function finishSpin(s){
  if(ended.has(s.id)) return; ended.add(s.id);
  stage.classList.remove('wh-spinning');
  const recent=Date.now()-(s.at+s.dur)<4000;
  if(mySpin===s.id){state.history.unshift({w:s.winner,t:Date.now()});state.history=state.history.slice(0,100);commit({skipSidebar:true});}
  else{renderStage();renderPanel();}
  if(recent&&state.banner===s.id) celebrate();
}
function celebrate(){
  if(state.confetti&&curL){confettiCv=confettiOn(stage,curL.W,curL.H,3.6);confettiEnd=performance.now()+3600;}
  winSound();
}
function removeWinner(s){
  if(s.wu) state.joined=state.joined.filter(j=>j.u!==s.wu);
  else{const lines=String(state.items).split('\n'),i=lines.findIndex(l=>l.trim().slice(0,60)===s.winner);if(i>=0){lines.splice(i,1);state.items=lines.join('\n');}}
}
function closeBanner(remove){
  const s=state.spin; if(!s||spinning()) return;
  if(remove&&state.banner===s.id){removeWinner(s);toast(i18n('tRemoved',{n:s.winner}));}
  state.banner=''; state.claimed=null; commit();
}
function spin(){
  if(spinning()) return;
  if(state.banner&&state.spin&&state.banner===state.spin.id&&state.autoRemove) removeWinner(state.spin);
  state.banner=''; state.claimed=null;
  const list=entries(); if(list.length<2){toast(i18n('tNeed2'));commit();return;}
  ac();
  const n=list.length, w=rndInt(n), u=.12+rnd()*.76, sl=360/n, phi=(w+u)*sl;
  const from=((curRot%360)+360)%360, turns={4:5,7:8,12:12}[state.dur]||8, rem=(((-phi-from)%360)+360)%360;
  const s={id:uid(),from,to:from+turns*360+rem,dur:state.dur*1000,at:Date.now()+80,winner:list[w].label,wu:list[w].u||'',n};
  state.spin=s; state.banner=s.id; mySpin=s.id;
  if(state.mode==='chat'&&state.open){state.open=false;toast(i18n('tClosedForSpin'));}
  commit();
}

/* ---------- Ton ---------- */
let actx=null, lastTick=0;
function ac(){try{if(!actx) actx=new (window.AudioContext||window.webkitAudioContext)();if(actx.state==='suspended') actx.resume();}catch(e){actx=null;}return actx;}
const playsSound=()=>state.sound&&!(IS_STREAM_WIN&&window.opener);
function tickSound(){
  if(!playsSound()||!actx) return; const now=performance.now(); if(now-lastTick<28) return; lastTick=now;
  try{const t=actx.currentTime,o=actx.createOscillator(),g=actx.createGain();o.type='square';o.frequency.value=1500;g.gain.setValueAtTime(.045,t);g.gain.exponentialRampToValueAtTime(.0005,t+.035);o.connect(g).connect(actx.destination);o.start(t);o.stop(t+.04);}catch(e){}
}
function winSound(){
  if(!playsSound()||!ac()) return;
  try{const t=actx.currentTime;[523.25,659.25,783.99,1046.5].forEach((f,i)=>{const o=actx.createOscillator(),g=actx.createGain();o.type='triangle';o.frequency.value=f;const s=t+i*.11;g.gain.setValueAtTime(0,s);g.gain.linearRampToValueAtTime(.16,s+.02);g.gain.exponentialRampToValueAtTime(.001,s+(i===3?.9:.35));o.connect(g).connect(actx.destination);o.start(s);o.stop(s+1);});}catch(e){}
}

/* ---------- Chat ---------- */
let joinT=0;
function onChatMessage(m){
  if(!state) return;
  const u=norm(m.user), now=Date.now(), s=state.spin;
  if(s&&s.wu&&u===s.wu&&state.banner===s.id&&!state.claimed&&now>=s.at+s.dur){state.claimed={text:String(m.text||'').slice(0,160),t:now};commit({skipSidebar:true});}
  if(state.mode!=='chat'||!state.open) return;
  if((String(m.text||'').trim().split(/\s+/)[0]||'').toLowerCase()!==cmdText()) return;
  if(state.who==='subs'&&!m.sub&&!m.broadcaster) return;
  if(state.joined.length>=MAX_JOIN||state.joined.some(j=>j.u===u)) return;
  state.joined.push({u,n:String(m.name||m.user).slice(0,40),t:now});
  if(!joinT) joinT=setTimeout(()=>{joinT=0;commit({skipSidebar:true});},150);
}

/* ---------- Editor-Panel ---------- */
let partSig='', clearArm=0;
function renderTool(){syncSpin();renderPanel();}
function renderPanel(){
  if(!$('#btnSpin')) return;
  const list=entries(), n=list.length, sp=spinning(), on=bannerOn();
  const bs=$('#btnSpin'); bs.textContent=i18n(sp?'spinning':'spin'); bs.disabled=sp;
  const bo=$('#btnOpen'); bo.textContent=i18n(state.open?'openOff':'openOn'); bo.classList.toggle('on-air',state.open);
  $('#spinInfo').textContent=n+' '+i18n(state.mode==='chat'?'countChat':'countList');
  $('#itemCount').textContent=i18n('itemCount',{n});
  const rb=$('#resultBox'); rb.hidden=!on;
  if(on){$('#resName').textContent=state.spin.winner;paintClaim();}
  if(state.mode==='chat') renderParts();
  renderHist();
}
function paintClaim(){
  const ci=bannerOn()?claimInfo():null;
  const rc=$('#resClaim'); if(rc){rc.textContent=ci?ci.txt+(ci.msg?' – »'+ci.msg+'«':''):'';rc.className=ci?ci.cls:'';}
  const sc=$('.wh-claim',stage); if(sc&&ci){sc.textContent=ci.txt;sc.className='wh-claim '+ci.cls;}
}
function renderParts(force){
  const box=$('#partList'); if(!box) return;
  const J=state.joined, sig=J.length+'|'+(J.length?J[J.length-1].u+J[0].u:'')+'|'+cmdText()+LANG;
  $('#partCount').textContent=J.length?String(J.length):'';
  if(!force&&sig===partSig) return;
  if(!force&&box.matches(':hover')){setTimeout(()=>renderParts(),600);return;}
  partSig=sig;
  if(!J.length){box.replaceChildren(el('div','muted',i18n('partEmpty',{c:cmdText()})));return;}
  const show=J.slice(-300).reverse(), items=show.map(j=>{
    const it=div('it'), x=el('button','small ghost','✕'); x.title='✕';
    x.onclick=()=>{state.joined=state.joined.filter(k=>k.u!==j.u);commit({skipSidebar:true});};
    it.append(el('b',null,j.n||j.u),el('small',null,j.t?new Date(j.t).toTimeString().slice(0,5):''),x); return it;
  });
  if(J.length>show.length) items.push(el('div','muted',i18n('partMore',{n:J.length-show.length})));
  box.replaceChildren(...items);
}
function renderHist(){
  const box=$('#histList'); if(!box) return;
  if(!state.history.length){box.replaceChildren(el('div','muted',i18n('histEmpty')));return;}
  box.replaceChildren(...state.history.map(h=>{const it=div('it');it.append(el('small',null,new Date(h.t).toTimeString().slice(0,5)),el('b',null,h.w));return it;}));
}
function renderToolSidebar(){
  for(const x of $$('[data-show]')) x.hidden=x.dataset.show!==state.mode;
  $('#subsWarn').hidden=state.who!=='subs';
  const camSeg=$('[data-seg=cams]');
  if(camSeg){const hide=state.format==='wheel';camSeg.closest('.field').hidden=hide;$('[data-key=camFill]').closest('.field').hidden=hide||!state.cams;$('[data-key=camRing]').closest('.check').hidden=hide||!state.cams;}
  $('[data-key=title]').placeholder=i18n(state.mode==='chat'?'titleChat':'titleList');
  $('[data-key=winLabel]').placeholder=i18n(state.mode==='chat'?'winChat':'winList');
  partSig='';
}
function copyText(t){
  const done=()=>toast(i18n('tCopied'));
  if(navigator.clipboard&&navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(done,()=>fallback());else fallback();
  function fallback(){const a=document.createElement('textarea');a.value=t;a.style.cssText='position:fixed;opacity:0';document.body.append(a);a.select();try{document.execCommand('copy');done();}catch(e){}a.remove();}
}
function addName(name){
  name=String(name||'').trim().replace(/^@+/,'').slice(0,40); if(!name) return false;
  const u=norm(name); if(state.joined.some(j=>j.u===u)){toast(i18n('tDup',{n:name}));return false;}
  state.joined.push({u,n:name,t:Date.now()}); return true;
}
function toolKeys(e){
  if(e.ctrlKey||e.metaKey||e.altKey) return false;
  if(e.code==='Space'){e.preventDefault();spin();return true;}
  if(e.key==='Escape'&&bannerOn()){closeBanner(state.autoRemove);return true;}
  return false;
}
function toolInit(){
  const chatCard=$('#btnChat')&&$('#btnChat').closest('.card'); if(chatCard) chatCard.dataset.show='chat';
  $('#btnSpin').onclick=spin;
  $('#btnAgain').onclick=spin;
  $('#btnRemoveWin').onclick=()=>closeBanner(true);
  $('#btnCloseWin').onclick=()=>closeBanner(state.autoRemove);
  $('#btnOpen').onclick=()=>{
    state.open=!state.open;
    if(state.open){
      toast(i18n(chat.status==='on'?'tOpened':'tNoChat',{c:cmdText()}));
      if(!state.tipSeen){state.tipSeen=true;$('#gaDlg').showModal();}
    }
    commit({skipSidebar:true});
  };
  $('#btnGaInfo').onclick=()=>$('#gaDlg').showModal();
  $('#gaOk').onclick=()=>$('#gaDlg').close();
  $('#btnShuffle').onclick=()=>{const l=String(state.items).split('\n').filter(x=>x.trim());for(let i=l.length-1;i>0;i--){const j=rndInt(i+1);[l[i],l[j]]=[l[j],l[i]];}state.items=l.join('\n');toast(i18n('tShuffled'));commit();};
  $('#btnSort').onclick=()=>{state.items=String(state.items).split('\n').filter(x=>x.trim()).sort((a,b)=>a.localeCompare(b,LANG,{sensitivity:'base'})).join('\n');commit();};
  $('#btnTest').onclick=()=>{let k=0;for(let i=0;i<60&&k<10;i++){let nm=TEST_NAMES[rndInt(TEST_NAMES.length)];if(state.joined.some(j=>j.u===norm(nm))) nm+=rndInt(100);if(addName(nm)) k++;}commit({skipSidebar:true});};
  $('#btnClearPart').onclick=e=>{
    const b=e.currentTarget;
    if(!clearArm){b.textContent=i18n('clearSure');clearArm=setTimeout(()=>{clearArm=0;b.textContent=i18n('clearAll');},3000);return;}
    clearTimeout(clearArm);clearArm=0;b.textContent=i18n('clearAll');state.joined=[];commit({skipSidebar:true});
  };
  $('#addName').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();if(addName(e.target.value)){e.target.value='';commit({skipSidebar:true});}}});
  $('#btnCopyHist').onclick=()=>copyText(state.history.map(h=>new Date(h.t).toTimeString().slice(0,5)+'  '+h.w).join('\n'));
  $('#btnClearHist').onclick=()=>{state.history=[];commit({skipSidebar:true});};
  setInterval(()=>{if(bannerOn()&&state.spin&&state.spin.wu) paintClaim();},250);
}
function onLangChanged(){partSig='';}
