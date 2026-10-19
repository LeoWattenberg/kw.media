/* ---------- Turnier-Bracket ---------- */
const DEF_NAMES={de:['Pizza','Döner','Sushi','Burger','Pasta','Tacos','Currywurst','Ramen'],en:['Pizza','Kebab','Sushi','Burger','Pasta','Tacos','Fried chicken','Ramen']};
const MAX_ENT=32;
const defEntries=lg=>DEF_NAMES[lg].map((n,i)=>({id:'e'+(i+1),name:n,img:''}));
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function defaultState(){return {...commonDefaults(),cams:0,entries:defEntries(LANG),results:{},order:[],cur:'',view:'duel',vote:null,autoVote:true,voteSec:60,allowChange:true,autoTree:false,title:'',flash:0};}
function normalize(s){
  const o=normalizeCommon(s,defaultState()); if(!s||typeof s!=='object') return o;
  if(Array.isArray(s.entries)){const seen=new Set();o.entries=s.entries.filter(e=>e&&typeof e.id==='string'&&e.id&&!seen.has(e.id)&&seen.add(e.id)).slice(0,MAX_ENT)
    .map(e=>({id:e.id.slice(0,24),name:String(e.name||'').slice(0,60),img:typeof e.img==='string'&&/^data:image\/(png|jpe?g|webp|gif);base64,/.test(e.img)&&e.img.length<800000?e.img:''}));}
  if(s.results&&typeof s.results==='object'){o.results={};for(const [k,v] of Object.entries(s.results)) if(/^\d+-\d+$/.test(k)&&v&&(v.w===0||v.w===1)) o.results[k]={w:v.w,va:Math.max(0,+v.va||0),vb:Math.max(0,+v.vb||0),t:+v.t||0};}
  if(Array.isArray(s.order)) o.order=s.order.filter(k=>typeof k==='string'&&o.results[k]);
  if(typeof s.cur==='string'&&/^(\d+-\d+)?$/.test(s.cur)) o.cur=s.cur;
  if(['duel','bracket'].includes(s.view)) o.view=s.view;
  const v=s.vote; if(v&&typeof v==='object'&&typeof v.key==='string'&&/^\d+-\d+$/.test(v.key)) o.vote={key:v.key,open:!!v.open,a:Math.max(0,+v.a||0),b:Math.max(0,+v.b||0),until:+v.until||0};
  for(const k of ['autoVote','allowChange','autoTree']) if(typeof s[k]==='boolean') o[k]=s[k];
  if([0,30,60,90,120].includes(s.voteSec)) o.voteSec=s.voteSec;
  if(typeof s.title==='string') o.title=s.title.slice(0,80);
  if(Number.isFinite(s.flash)) o.flash=s.flash;
  return o;
}
function beforeLangSwitch(from,to){
  const E=state.entries; if(E.length===8&&E.every((e,i)=>e.id==='e'+(i+1)&&e.name===DEF_NAMES[from][i]&&!e.img)) state.entries=defEntries(to);
}
const titleText=()=>state.title.trim()||i18n('titleDefault');
const entryById=id=>state.entries.find(e=>e.id===id);
const nameOf=id=>{const e=entryById(id);return e?(e.name.trim()||'?'):'?';};
const locked=()=>Object.keys(state.results).length>0;
const isOwner=()=>!(IS_STREAM_WIN&&window.opener);

/* ---------- Turnierlogik ---------- */
function bracket(){
  const ids=state.entries.map(e=>e.id), n=ids.length;
  if(n<2) return {n,S:0,R:0,r0:[]};
  let S=2; while(S<n) S*=2;
  const R=Math.log2(S), M=S/2, byes=S-n, byeIdx=new Set();
  for(let i=0;i<byes;i++) byeIdx.add(Math.floor(i*M/byes));
  const r0=[]; let p=0;
  for(let m=0;m<M;m++){if(byeIdx.has(m)) r0.push([ids[p++],null]);else{r0.push([ids[p],ids[p+1]]);p+=2;}}
  return {n,S,R,r0};
}
/* Slot: id = Teilnehmer, null = Freilos, undefined = steht noch nicht fest */
function slots(br,r,m){return r===0?br.r0[m]:[winner(br,r-1,2*m),winner(br,r-1,2*m+1)];}
function winner(br,r,m){
  const [a,b]=slots(br,r,m);
  if(a===null&&b===null) return null;
  if(a===null) return b; if(b===null) return a;
  if(a===undefined||b===undefined) return undefined;
  const res=state.results[r+'-'+m]; return res?(res.w?b:a):undefined;
}
const isReady=(br,r,m)=>{const [a,b]=slots(br,r,m);return !!a&&!!b;};
const parseKey=k=>k.split('-').map(Number);
function nextOpen(br){for(let r=0;r<br.R;r++) for(let m=0;m<(br.S>>(r+1));m++) if(isReady(br,r,m)&&!state.results[r+'-'+m]) return r+'-'+m;return '';}
function displayKey(br){
  if(state.cur){const [r,m]=parseKey(state.cur);if(r<br.R&&m<(br.S>>(r+1))&&isReady(br,r,m)) return state.cur;}
  return nextOpen(br);
}
const champion=br=>br.R?winner(br,br.R-1,0):undefined;
function roundName(br,r){const left=br.R-r;return i18n(['','rFinal','rSemi','rQuarter','r16','r32'][left]||'rN',{n:r+1});}
function matchCount(br){let n=0;for(let r=0;r<br.R;r++) for(let m=0;m<(br.S>>(r+1));m++){const [a,b]=slots(br,r,m);if(a!==null&&b!==null) n++;}return n;}

let voters=new Map();
function setResult(key,w,votes){
  const br=bracket(), [r,m]=parseKey(key), old=state.results[key];
  if(old&&old.w!==w) for(let rr=r+1,mm=m>>1;rr<br.R;rr++,mm>>=1) delete state.results[rr+'-'+mm];
  state.results[key]={w,va:votes?votes.a:(old?old.va:0),vb:votes?votes.b:(old?old.vb:0),t:Date.now()};
  state.order=state.order.filter(k=>state.results[k]&&k!==key); state.order.push(key);
  state.cur=key;
  if(state.vote&&state.vote.key===key) state.vote.open=false;
  if(state.autoTree) state.flash=Date.now()+3500;
}
function decide(side){
  const br=bracket(), key=displayKey(br); if(!key) return;
  const v=state.vote&&state.vote.key===key?state.vote:null;
  setResult(key,side,v&&(v.a||v.b)?{a:v.a,b:v.b}:null); commit();
}
function startVote(key,silent){
  if(!key) return;
  if(state.results[key]){if(!silent) toast(i18n('tAlready'));return;}
  state.vote={key,open:true,a:0,b:0,until:state.voteSec?Date.now()+state.voteSec*1000:0}; voters=new Map();
  if(!silent&&chat.status!=='on') toast(i18n('tNoChat'));
}
function closeVote(){
  const v=state.vote; if(!v||!v.open) return;
  v.open=false;
  if(v.a!==v.b) setResult(v.key,v.b>v.a?1:0,{a:v.a,b:v.b}); else toast(i18n(v.a?'tTie':'tNoVotes'));
  commit();
}
function toggleVote(){
  const br=bracket(), key=displayKey(br);
  if(state.vote&&state.vote.open){closeVote();return;}
  startVote(key); commit();
}
function next(){
  const br=bracket(), key=displayKey(br);
  if(key&&!state.results[key]){toast(i18n('tDecideFirst'));return;}
  state.cur=''; state.flash=0; state.view='duel';
  const nk=nextOpen(br);
  if(nk&&state.autoVote&&chat.status==='on') startVote(nk,true);
  commit();
}
function undo(){
  const k=state.order.pop(); if(!k) return;
  delete state.results[k]; state.cur=k; state.flash=0;
  if(state.vote&&state.vote.key===k) state.vote=null;
  commit();
}
function setView(v){state.view=v;state.flash=0;commit();}
function restart(){state.results={};state.order=[];state.cur='';state.vote=null;state.flash=0;voters=new Map();}

/* ---------- Chat ---------- */
let voteT=0;
function onChatMessage(m){
  const v=state&&state.vote; if(!v||!v.open) return;
  const t=(String(m.text||'').trim().split(/\s+/)[0]||'').toLowerCase();
  const side=t==='1'||t==='a'?0:t==='2'||t==='b'?1:-1; if(side<0) return;
  const u=norm(m.user), prev=voters.get(u);
  if(prev!==undefined){if(!state.allowChange||prev===side) return;if(prev===0) v.a=Math.max(0,v.a-1);else v.b=Math.max(0,v.b-1);}
  voters.set(u,side); if(side) v.b++; else v.a++;
  if(!voteT) voteT=setTimeout(()=>{voteT=0;commit({skipSidebar:true});},150);
}

/* ---------- Layout ---------- */
function camRects16(n){if(n===1) return [{x:720,y:30,w:480,h:270,r:18}];if(n===2) return [{x:470,y:30,w:480,h:270,r:18},{x:970,y:30,w:480,h:270,r:18}];return [];}
function computeLayout(){
  const n=state.cams;
  if(state.format==='9:16'){
    const cams=camRects9x16(n), y0=cams.length?608:0, head={x:60,y:y0+24,w:960,h:cams.length?100:150};
    const a0=head.y+head.h+20, ctaH=56, bottom=1920-50-ctaH-30, cardH=Math.floor((bottom-a0-100)/2);
    return {W:1080,H:1920,cams,two:false,
      duel:{head,A:{x:60,y:a0,w:960,h:cardH},B:{x:60,y:a0+cardH+100,w:960,h:cardH},vs:{cx:540,cy:a0+cardH+50,r:58},cta:{x:60,y:a0+2*cardH+114,w:960,h:ctaH},stack:true},
      tree:{title:{x:60,y:y0+24,w:960,h:80},A:{x:30,y:y0+124,w:1020,h:1920-(y0+124)-70}},
      champ:{x:60,y:y0+170,w:960,h:1920-(y0+170)-120},brand:{x:600,y:1872,w:440,h:30}};
  }
  const cams=camRects16(n);
  if(cams.length){
    const cl=cams[0].x, cr=cams[cams.length-1].x+cams[cams.length-1].w;
    return {W:1920,H:1080,cams,two:true,
      duel:{head:{x:60,y:40,w:cl-100,h:200},left:true,cta:{x:cr+40,y:40,w:1860-cr-40,h:200},ctaSide:true,A:{x:90,y:330,w:780,h:660},B:{x:1050,y:330,w:780,h:660},vs:{cx:960,cy:660,r:76}},
      tree:{title:{x:40,y:40,w:cl-80,h:80},titleLeft:true,A:{x:40,y:330,w:1840,h:690}},
      champ:{x:460,y:330,w:1000,h:670},brand:{x:1500,y:1038,w:380,h:28}};
  }
  return {W:1920,H:1080,cams,two:true,
    duel:{head:{x:200,y:28,w:1520,h:140},A:{x:90,y:190,w:780,h:740},B:{x:1050,y:190,w:780,h:740},vs:{cx:960,cy:560,r:80},cta:{x:200,y:950,w:1520,h:64}},
    tree:{title:{x:200,y:34,w:1520,h:80},A:{x:40,y:140,w:1840,h:880}},
    champ:{x:460,y:170,w:1000,h:780},brand:{x:1500,y:1038,w:380,h:28}};
}

/* ---------- Turnierbaum (SVG – für Bühne und Export) ---------- */
function treeGeom(br,A0,two){
  const S=br.S, R=br.R, labH=Math.min(34,A0.h*.05), A={x:A0.x,y:A0.y+labH,w:A0.w,h:A0.h-labH};
  const G={boxes:[],lines:[],labels:[],champ:null}, cy={};
  if(two&&R>=2){
    const k=Math.min(330,A.w/(2.5*(R-1)+2.4)), colW=k*1.25, vsG=k*.4, total=2*(R-1)*colW+2*k+vsG, off=A.x+(A.w-total)/2;
    const cellH=A.h/(S/4), bh=Math.min(86,cellH*.86/2.2), gap=bh*.2, fx=off+(R-1)*colW;
    const xL=r=>off+r*colW, xR=r=>off+total-r*colW-k;
    Object.assign(G,{k,bh});
    for(let r=0;r<R-1;r++){
      const M=S>>(r+1);
      for(let m=0;m<M;m++){
        const right=m>=M/2, j=right?m-M/2:m;
        let ya,yb;
        if(r===0){const c=A.y+(j+.5)*cellH;ya=c-(bh+gap)/2;yb=c+(bh+gap)/2;}
        else{ya=cy[(r-1)+'-'+(2*m)];yb=cy[(r-1)+'-'+(2*m+1)];}
        cy[r+'-'+m]=(ya+yb)/2;
        const x=right?xR(r):xL(r);
        G.boxes.push({r,m,s:0,x,y:ya-bh/2,w:k,h:bh},{r,m,s:1,x,y:yb-bh/2,w:k,h:bh});
        const x1=right?x:x+k, xm=right?x-(colW-k)/2:x+k+(colW-k)/2;
        const xn=r+1<R-1?(right?xR(r+1)+k:xL(r+1)):(right?fx+2*k+vsG:fx);
        G.lines.push({r,m,x1,xm,xn,ya,yb});
      }
      G.labels.push({x:xL(r)+k/2,r},{x:xR(r)+k/2,r});
    }
    const fy=cy[(R-2)+'-0'];
    G.boxes.push({r:R-1,m:0,s:0,x:fx,y:fy-bh/2,w:k,h:bh},{r:R-1,m:0,s:1,x:fx+k+vsG,y:fy-bh/2,w:k,h:bh});
    G.vs={x:fx+k+vsG/2,y:fy,fs:Math.min(vsG*.45,bh*.45)};
    G.labels.push({x:fx+k+vsG/2,r:R-1});
    const ch=Math.max(bh*1.5,64); G.champ={x:fx,y:fy+bh/2+Math.max(26,bh*.7),w:2*k+vsG,h:ch};
  }else{
    const k=Math.min(330,A.w/(R*1.25+1.15)), colW=k*1.25, total=R*colW+k*1.15, off=A.x+(A.w-total)/2;
    const cellH=A.h/(S/2), bh=Math.min(86,cellH*.86/2.2), gap=bh*.2;
    Object.assign(G,{k,bh});
    for(let r=0;r<R;r++){
      const M=S>>(r+1), x=off+r*colW;
      for(let m=0;m<M;m++){
        let ya,yb;
        if(r===0){const c=A.y+(m+.5)*cellH;ya=c-(bh+gap)/2;yb=c+(bh+gap)/2;}
        else{ya=cy[(r-1)+'-'+(2*m)];yb=cy[(r-1)+'-'+(2*m+1)];}
        cy[r+'-'+m]=(ya+yb)/2;
        G.boxes.push({r,m,s:0,x,y:ya-bh/2,w:k,h:bh},{r,m,s:1,x,y:yb-bh/2,w:k,h:bh});
        G.lines.push({r,m,x1:x+k,xm:x+k+(colW-k)/2,xn:off+(r+1)*colW,ya,yb});
      }
      G.labels.push({x:x+k/2,r});
    }
    const ch=Math.max(bh*1.4,56), cyc=cy[(R-1)+'-0'];
    G.champ={x:off+R*colW,y:cyc-ch/2,w:k*1.15,h:ch,side:true};
    G.labels.push({x:off+R*colW+k*.575,r:-1});
  }
  G.labY=A0.y+labH*.62; G.labFs=Math.max(11,Math.min(20,labH*.55));
  return G;
}
const TROPHY=(x,y,s,c)=>`<g transform="translate(${x} ${y}) scale(${s/24})" fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4z"/><path d="M17 5h2.5a1.5 1.5 0 0 1 0 3H17M7 5H4.5a1.5 1.5 0 0 0 0 3H7"/></g>`;
function bracketSVG(br,W,H,T,two,opts={}){
  const G=treeGeom(br,T.A,two), fgc=textOn(state.bg)==='#000000'?'0,0,0':'255,255,255', fg=`rgb(${fgc})`, acc=state.accent, onAcc=textOn(acc);
  const fs=Math.round(Math.min(30,G.bh*.42)), rx=Math.round(G.bh*.22), lw=Math.max(2,G.bh*.05).toFixed(1), F=esc(FONT);
  let defs='', body='', ci=0;
  if(T.title){
    const tb=T.title, t=titleText(), f=fitBlock(mctx,t,tb.w,tb.h,Math.round(tb.h*.72),800,1.1,1).fs;
    mctx.font=`800 ${f}px ${FONT}`;
    body+=`<text x="${T.titleLeft?tb.x:tb.x+tb.w/2}" y="${tb.y+tb.h/2}" text-anchor="${T.titleLeft?'start':'middle'}" dominant-baseline="central" font-size="${f}" font-weight="800" fill="${fg}">${esc(ellipsize(mctx,t,tb.w))}</text>`;
  }
  for(const lb of G.labels){
    const txt=(lb.r<0?i18n('champShort'):roundName(br,lb.r)).toUpperCase();
    body+=`<text x="${lb.x}" y="${G.labY}" text-anchor="middle" dominant-baseline="central" font-size="${G.labFs.toFixed(1)}" font-weight="700" letter-spacing="1.5" fill="rgba(${fgc},.45)">${esc(txt)}</text>`;
  }
  const base=`stroke="rgba(${fgc},.25)"`, hot=`stroke="${acc}"`;
  for(const ln of G.lines){
    const [a,b]=slots(br,ln.r,ln.m), wv=winner(br,ln.r,ln.m), ws=wv==null?-1:(wv===a?0:1), ym=(ln.ya+ln.yb)/2;
    const seg=(d,h)=>`<path d="${d}" ${h?hot:base}/>`;
    body+=seg(`M${ln.x1} ${ln.ya}H${ln.xm}`,ws===0)+seg(`M${ln.x1} ${ln.yb}H${ln.xm}`,ws===1)
      +seg(`M${ln.xm} ${ln.ya}V${ym}`,ws===0)+seg(`M${ln.xm} ${ym}V${ln.yb}`,ws===1)+seg(`M${ln.xm} ${ym}H${ln.xn}`,ws>=0);
  }
  if(G.vs) body+=`<text x="${G.vs.x}" y="${G.vs.y}" text-anchor="middle" dominant-baseline="central" font-size="${G.vs.fs.toFixed(1)}" font-weight="900" font-style="italic" fill="${acc}">VS</text>`;
  const byKey={}; for(const bx of G.boxes) (byKey[bx.r+'-'+bx.m]=byKey[bx.r+'-'+bx.m]||[]).push(bx);
  const box=(bx,id,decided,wv)=>{
    const isW=decided&&wv===id, isL=decided&&wv!==id; let s='';
    if(id===null){
      s+=`<rect x="${bx.x}" y="${bx.y}" width="${bx.w}" height="${bx.h}" rx="${rx}" fill="none" stroke="rgba(${fgc},.2)" stroke-width="${lw}" stroke-dasharray="6 6"/>`;
      s+=`<text x="${bx.x+bx.w/2}" y="${bx.y+bx.h/2}" text-anchor="middle" dominant-baseline="central" font-size="${Math.round(fs*.8)}" font-weight="600" fill="rgba(${fgc},.35)">${esc(i18n('bye'))}</text>`;
      return s;
    }
    if(id===undefined) return `<rect x="${bx.x}" y="${bx.y}" width="${bx.w}" height="${bx.h}" rx="${rx}" fill="rgba(${fgc},.05)" stroke="rgba(${fgc},.12)" stroke-width="${lw}"/>`;
    const e=entryById(id), nm=e?(e.name.trim()||'?'):'?', fill=isW?acc:rgba(lighten(state.bg,.1),.92), tc=isW?onAcc:fg;
    s+=`<g opacity="${isL?.45:1}"><rect x="${bx.x}" y="${bx.y}" width="${bx.w}" height="${bx.h}" rx="${rx}" fill="${fill}"${isW?'':` stroke="rgba(${fgc},.1)" stroke-width="${lw}"`}/>`;
    let tx=bx.x+bx.h*.3;
    if(e&&e.img){
      const p=Math.max(3,bx.h*.1), sz=bx.h-2*p, id2='tbc'+(ci++);
      defs+=`<clipPath id="${id2}"><rect x="${bx.x+p}" y="${bx.y+p}" width="${sz}" height="${sz}" rx="${Math.max(3,rx-p)}"/></clipPath>`;
      s+=`<image href="${e.img}" x="${bx.x+p}" y="${bx.y+p}" width="${sz}" height="${sz}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${id2})"/>`;
      tx=bx.x+p+sz+bx.h*.22;
    }
    const avail=bx.x+bx.w-tx-bx.h*.22; let f=fs; mctx.font=`700 ${f}px ${FONT}`;
    while(f>Math.max(10,fs*.66)&&mctx.measureText(nm).width>avail){f--;mctx.font=`700 ${f}px ${FONT}`;}
    s+=`<text x="${tx}" y="${bx.y+bx.h/2}" dominant-baseline="central" font-size="${f}" font-weight="700" fill="${tc}">${esc(ellipsize(mctx,nm,avail))}</text></g>`;
    return s;
  };
  for(const [key,bs] of Object.entries(byKey)){
    const [r,m]=parseKey(key), [a,b]=slots(br,r,m), wv=winner(br,r,m), decided=!!a&&!!b&&wv!==undefined;
    const ready=!!a&&!!b;
    body+=`<g${opts.interactive&&ready?` class="tb-m" data-k="${key}"`:''}>`+bs.map(bx=>box(bx,bx.s?b:a,decided,wv)).join('');
    if(opts.hl===key){const x0=Math.min(...bs.map(q=>q.x))-8,y0=Math.min(...bs.map(q=>q.y))-8,x1=Math.max(...bs.map(q=>q.x+q.w))+8,y1=Math.max(...bs.map(q=>q.y+q.h))+8;
      body+=`<rect x="${x0}" y="${y0}" width="${x1-x0}" height="${y1-y0}" rx="${rx+8}" fill="none" stroke="${acc}" stroke-width="${(lw*1.6).toFixed(1)}" stroke-dasharray="10 7" class="tb-hl"/>`;}
    body+='</g>';
  }
  const C=G.champ, ch=champion(br);
  if(C){
    if(ch){
      const e=entryById(ch), nm=e?(e.name.trim()||'?'):'?', cfs=Math.round(Math.min(40,C.h*.36)), ts=C.h*.5;
      body+=`<rect x="${C.x}" y="${C.y}" width="${C.w}" height="${C.h}" rx="${rx*1.4}" fill="${acc}" filter="url(#tbglow)"/>`;
      defs+=`<filter id="tbglow" x="-30%" y="-60%" width="160%" height="220%"><feDropShadow dx="0" dy="0" stdDeviation="${(C.h*.18).toFixed(1)}" flood-color="${acc}" flood-opacity=".55"/></filter>`;
      body+=TROPHY(C.x+C.h*.28,C.y+(C.h-ts)/2,ts,onAcc);
      const tx=C.x+C.h*.28+ts+C.h*.18; mctx.font=`800 ${cfs}px ${FONT}`;
      body+=`<text x="${tx}" y="${C.y+C.h/2}" dominant-baseline="central" font-size="${cfs}" font-weight="800" fill="${onAcc}">${esc(ellipsize(mctx,nm,C.x+C.w-tx-C.h*.25))}</text>`;
    }else{
      body+=`<rect x="${C.x}" y="${C.y}" width="${C.w}" height="${C.h}" rx="${rx*1.4}" fill="none" stroke="rgba(${fgc},.25)" stroke-width="${lw}" stroke-dasharray="8 7"/>`;
      body+=TROPHY(C.x+C.w/2-C.h*.25,C.y+C.h*.25,C.h*.5,`rgba(${fgc},.3)`);
    }
    if(!C.side) body+=`<text x="${C.x+C.w/2}" y="${C.y-G.labFs*.9}" text-anchor="middle" dominant-baseline="central" font-size="${G.labFs.toFixed(1)}" font-weight="700" letter-spacing="1.5" fill="rgba(${fgc},.45)">${esc(i18n('champLabel').toUpperCase())}</text>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${F}" stroke-width="${lw}" stroke-linecap="round"><defs>${defs}</defs>${body}</svg>`;
}

/* ---------- Bühne ---------- */
let curL=null, flashActive=false, champShownAt=0, confettiCv=null, confettiEnd=0;
function buildStage(L,out){
  curL=L; const st=stage.style;
  st.setProperty('--tb-fg',textOn(state.bg)==='#000000'?'0,0,0':'255,255,255');
  st.setProperty('--tb-card',rgba(lighten(state.bg,.07),.92));
  out.push(bgLayer(L,state.camFill==='transparent'?L.cams:[]));
  camEls(L,out);
  const br=bracket(); flashActive=Date.now()<state.flash;
  stage.dataset.view='';
  if(br.n<2){const e=div('rg tb-empty');place(e,{x:0,y:0,w:L.W,h:L.H});e.textContent=i18n('emptyStage');out.push(e);}
  else if(state.view==='bracket'||flashActive){
    stage.dataset.view='tree';
    const w=div('rg tb-tree'); place(w,{x:0,y:0,w:L.W,h:L.H});
    w.innerHTML=bracketSVG(br,L.W,L.H,L.tree,L.two,{hl:displayKey(br),interactive:isOwner()});
    out.push(w);
  }else{
    const key=displayKey(br);
    if(key){stage.dataset.view='duel';buildDuel(L,out,br,key);}
    else{stage.dataset.view='champ';buildChamp(L,out,br);}
  }
  if(state.brand) out.push(brandBox(L.brand,state.bg));
  if(confettiCv&&performance.now()<confettiEnd) out.push(confettiCv);
}
function buildDuel(L,out,br,key){
  const D=L.duel, [r,m]=parseKey(key), [a,b]=slots(br,r,m), res=state.results[key], v=state.vote&&state.vote.key===key?state.vote:null, final=r===br.R-1;
  const head=div('rg tb-head'+(D.left?' left':'')); place(head,D.head);
  const t=el('div','tb-title',titleText()); t.style.fontSize=Math.round(Math.min(36,D.head.h*.24))+'px';
  const M=br.S>>(r+1), rn=roundName(br,r), sub=M>1?i18n('matchOf',{m:m+1,n:M}):'';
  const rd=div('tb-round'); rd.textContent=rn; rd.style.fontSize=Math.round(Math.min(70,D.head.h*.42,D.head.w/(rn.length*.62)))+'px';
  head.append(t,rd);
  if(sub){const sb=el('div','tb-sub',sub);sb.style.fontSize=Math.round(Math.min(28,D.head.h*.18))+'px';head.append(sb);}
  out.push(head);
  const hasRes=res&&(res.va||res.vb), votes=v?[v.a,v.b]:hasRes?[res.va,res.vb]:null;
  out.push(duelCard(a,D.A,0,res,votes,final),duelCard(b,D.B,1,res,votes,final));
  const vs=div('rg tb-vs'); place(vs,{x:D.vs.cx-D.vs.r,y:D.vs.cy-D.vs.r,w:2*D.vs.r,h:2*D.vs.r}); vs.textContent='VS'; vs.style.fontSize=Math.round(D.vs.r*.6)+'px'; out.push(vs);
  const cta=div('rg tb-cta'+(D.ctaSide?' side':'')); place(cta,D.cta); cta.style.fontSize=Math.round(Math.min(38,D.cta.h*(D.ctaSide?.2:.6)))+'px';
  cta.innerHTML=ctaHtml(br,key,res,v,final); out.push(cta);
}
function ctaHtml(br,key,res,v,final){
  if(res){const [a,b]=slots(br,...parseKey(key));return esc(i18n(final?'ctaChamp':'ctaWin',{n:nameOf(res.w?b:a)}));}
  if(v&&v.open) return i18n('ctaVote')+(v.until?` <span class="cd">${fmtLeft(v.until)}</span>`:'');
  if(v&&!v.open&&v.a===v.b&&(v.a||v.b)) return esc(i18n('ctaTie'));
  return esc(i18n('ctaWho'));
}
const fmtLeft=u=>{const s=Math.max(0,Math.ceil((u-Date.now())/1000));return Math.floor(s/60)+':'+pad2(s%60);};
function duelCard(id,box,side,res,votes,final){
  const e=entryById(id), c=div('rg tb-card'); place(c,box); c.dataset.side=side;
  if(res) c.classList.add(res.w===side?'win':'lose');
  const pad=Math.round(Math.min(box.w,box.h)*.045), voteH=votes?Math.round(Math.min(72,box.h*.11)):0, inner=box.w-2*pad;
  const name=e?(e.name.trim()||'?'):'—';
  if(e&&e.img){
    const nameH=Math.round(box.h*(box.w>box.h*1.3?.2:.17)), ih=box.h-pad*2-voteH-(voteH?pad*.6:0)-nameH-pad*.4;
    const fr=div('tb-img'); place(fr,{x:pad,y:pad,w:inner,h:ih}); const im=new Image(); im.src=e.img; im.alt=''; im.draggable=false; fr.append(im); c.append(fr);
    const nm=div('tb-name'); place(nm,{x:pad,y:pad+ih+pad*.4,w:inner,h:nameH}); fitInto(nm,name,inner,nameH,Math.round(nameH*.78),800,1.05,2); c.append(nm);
  }else{
    const nh=box.h-pad*2-voteH-(voteH?pad*.6:0), nm=div('tb-name'); place(nm,{x:pad,y:pad,w:inner,h:nh});
    fitInto(nm,name,inner*.88,nh*.72,Math.round(Math.min(nh*.36,box.w*.15)),800,1.05,3); c.append(nm);
  }
  const ns=Math.round(Math.min(box.w,box.h)*.12), num=el('div','tb-num',String(side+1));
  num.style.cssText=`width:${ns}px;height:${ns}px;font-size:${Math.round(ns*.55)}px;left:${pad*1.4}px;top:${pad*1.4}px`; c.append(num);
  if(votes){
    const tot=(votes[0]||0)+(votes[1]||0), mine=votes[side]||0, pct=tot?Math.round(mine/tot*100):0;
    const vb=div('tb-vote'); place(vb,{x:pad,y:box.h-pad-voteH,w:inner,h:voteH}); vb.style.fontSize=Math.round(voteH*.42)+'px';
    const f=div('fill'); f.style.width=pct+'%'; vb.append(f,el('span','pct',pct+' %'),el('span','cnt',mine===1?i18n('votes1'):i18n('votes',{n:mine}))); c.append(vb);
  }
  if(res&&res.w===side){const rb=el('div','tb-rib',i18n(final?'ribChamp':'ribWin'));rb.style.fontSize=Math.round(Math.min(34,ns*.4))+'px';rb.style.right=pad*1.4+'px';rb.style.top=pad*1.4+'px';c.append(rb);}
  return c;
}
function buildChamp(L,out,br){
  const id=champion(br), e=entryById(id), C=L.champ, c=div('rg tb-champ'); place(c,C);
  const ts=Math.round(C.h*.14), tr=div('tb-trophy'); tr.innerHTML=`<svg width="${ts}" height="${ts}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4z"/><path d="M17 5h2.5a1.5 1.5 0 0 1 0 3H17M7 5H4.5a1.5 1.5 0 0 0 0 3H7"/></svg>`;
  const lab=el('div','tb-clab',i18n('champLabel')); lab.style.fontSize=Math.round(C.h*.05)+'px';
  c.append(tr,lab);
  if(e&&e.img){const ih=Math.round(C.h*.38),fr=div('tb-cimg');fr.style.cssText=`width:${Math.round(ih*1.3)}px;height:${ih}px`;const im=new Image();im.src=e.img;im.alt='';fr.append(im);c.append(fr);}
  const nm=div('tb-cname'), nh=Math.round(C.h*(e&&e.img?.16:.26)); nm.style.width=(C.w-80)+'px'; nm.style.height=nh+'px';
  fitInto(nm,e?(e.name.trim()||'?'):'?',C.w-80,nh,Math.round(nh*.85),800,1.05,2); c.append(nm);
  out.push(c);
}

/* ---------- Editor ---------- */
let restartArm=0, clearArm=0, entDirty=false, flashT=0;
function renderTool(){
  renderPanel();
  if(state.flash>Date.now()){clearTimeout(flashT);flashT=setTimeout(refresh,state.flash-Date.now()+60);}
  const br=bracket();
  if(stage.dataset.view==='champ'&&br.R){const fr=state.results[(br.R-1)+'-0'];if(fr&&fr.t!==champShownAt&&Date.now()-fr.t<6000&&curL){champShownAt=fr.t;confettiCv=confettiOn(stage,curL.W,curL.H,4);confettiEnd=performance.now()+4000;}}
}
function renderPanel(){
  if(!$('#btnVote')) return;
  const br=bracket(), key=br.n>=2?displayKey(br):'', res=key?state.results[key]:null, v=state.vote&&state.vote.key===key?state.vote:null;
  const open=!!(v&&v.open);
  $('#btnVote').textContent=open?i18n('voteStop')+(v.until?' · '+fmtLeft(v.until):''):i18n('voteStart');
  $('#btnVote').disabled=!key||!!res; $('#btnVote').classList.toggle('primary',!open);
  const [a,b]=key?slots(br,...parseKey(key)):[null,null];
  const pick=(btn,n,id,side)=>{btn.replaceChildren(el('b',null,n),el('span',null,id?nameOf(id):'—'));btn.disabled=!key;btn.classList.toggle('on',!!res&&res.w===side);};
  pick($('#btnA'),'1',a,0); pick($('#btnB'),'2',b,1);
  $('#btnNext').textContent=i18n('nextMatch'); $('#btnNext').disabled=!key||!res;
  $('#btnUndo').disabled=!state.order.length;
  let st;
  if(br.n<2) st=i18n('stNeed');
  else if(!key) st=i18n('stDone',{n:nameOf(champion(br))});
  else{const [r,m]=parseKey(key);st=i18n('stMatch',{r:roundName(br,r),m:m+1,n:br.S>>(r+1)});const vv=v||(res&&(res.va||res.vb)?{a:res.va,b:res.vb}:null);if(vv) st+=' · '+i18n('stVotes',{n:vv.a+vv.b});}
  $('#tbStatus').textContent=st;
}
function renderToolSidebar(){
  const box=$('#entList'); if(!box) return;
  const ae=document.activeElement; if(ae&&ae.tagName==='INPUT'&&box.contains(ae)){entDirty=true;return;}
  entDirty=false; const L=locked();
  $('#entCount').textContent=state.entries.length+' / '+MAX_ENT;
  box.replaceChildren(...state.entries.map((e,i)=>{
    const row=div('ent'); row.dataset.id=e.id;
    const th=el('button','ent-th'); th.title=i18n('imgPick');
    if(e.img){const im=new Image();im.src=e.img;im.alt='';th.append(im);}else th.textContent='+';
    th.onclick=()=>{pickFor=e.id;$('#imgFile').click();};
    const inp=document.createElement('input'); inp.type='text'; inp.value=e.name; inp.maxLength=60; inp.spellcheck=false;
    inp.oninput=()=>{const en=entryById(e.id);if(en){en.name=inp.value;commit({skipSidebar:true});}};
    inp.onblur=()=>{if(entDirty) setTimeout(renderToolSidebar,0);};
    const x=el('button','small ghost','✕'); x.disabled=L; x.onclick=()=>removeEntry(e.id);
    row.append(el('span','ent-n',String(i+1)),th,inp,x); return row;
  }));
  for(const s of ['#btnShuffle','#btnPaste','#btnClearEnt','#entAdd','#btnImgs']) $(s).disabled=L;
  $('#lockNote').hidden=!L;
}
function structural(){if(locked()){toast(i18n('tLocked'));return false;}state.cur='';state.vote=null;return true;}
function addEntry(name,img){
  name=String(name||'').trim().slice(0,60); if(!name&&!img) return false;
  if(state.entries.length>=MAX_ENT){toast(i18n('tMax'));return false;}
  state.entries.push({id:uid(),name,img:img||''}); return true;
}
function removeEntry(id){if(!structural()) return;state.entries=state.entries.filter(e=>e.id!==id);commit();}
let pickFor='';
async function fileToImg(file){
  const url=URL.createObjectURL(file);
  try{
    const im=await loadImg(url), k=Math.min(1,320/Math.max(im.naturalWidth,im.naturalHeight)), c=document.createElement('canvas');
    c.width=Math.max(1,Math.round(im.naturalWidth*k)); c.height=Math.max(1,Math.round(im.naturalHeight*k)); c.getContext('2d').drawImage(im,0,0,c.width,c.height);
    let d=c.toDataURL('image/webp',.85); if(!d.startsWith('data:image/webp')) d=c.toDataURL('image/jpeg',.85); return d;
  }finally{URL.revokeObjectURL(url);}
}
const nameFromFile=f=>f.name.replace(/\.[^.]+$/,'').replace(/[_]+/g,' ').replace(/\s+/g,' ').trim().slice(0,60)||'?';
async function addFiles(files){
  files=[...files].filter(f=>/^image\//.test(f.type)); if(!files.length) return;
  if(!structural()) return;
  for(const f of files){if(state.entries.length>=MAX_ENT){toast(i18n('tMax'));break;}try{addEntry(nameFromFile(f),await fileToImg(f));}catch(e){}}
  commit();
}
async function setImage(id,file){try{const d=await fileToImg(file),en=entryById(id);if(en){en.img=d;commit();}}catch(e){toast(i18n('tExportFail'));}}
function shuffleEntries(){if(!structural()) return;const E=state.entries;for(let i=E.length-1;i>0;i--){const a=new Uint32Array(1);crypto.getRandomValues(a);const j=a[0]%(i+1);[E[i],E[j]]=[E[j],E[i]];}toast(i18n('tShuffled'));commit();}
function toolKeys(e){
  if(e.ctrlKey||e.metaKey||e.altKey) return false;
  const k=e.key;
  if(k==='1'||k==='ArrowLeft'){e.preventDefault();decide(0);return true;}
  if(k==='2'||k==='ArrowRight'){e.preventDefault();decide(1);return true;}
  if(k==='Enter'){e.preventDefault();next();return true;}
  if(e.code==='Space'){e.preventDefault();toggleVote();return true;}
  if(k==='b'||k==='B'){setView(state.view==='duel'&&!flashActive?'bracket':'duel');return true;}
  if(k==='z'||k==='Z'||k==='Backspace'){e.preventDefault();undo();return true;}
  return false;
}
async function toolExport(f){
  const br=bracket(); if(br.n<2){toast(i18n('tNeed2'));return;}
  try{
    const [W,H]=f==='1:1'?[1080,1080]:f==='9:16'?[1080,1920]:[1920,1080];
    const T=f==='1:1'?{title:{x:60,y:34,w:960,h:76},A:{x:30,y:126,w:1020,h:890}}:f==='9:16'?{title:{x:60,y:50,w:960,h:90},A:{x:30,y:170,w:1020,h:1680}}:{title:{x:200,y:34,w:1520,h:80},A:{x:40,y:140,w:1840,h:880}};
    const c=document.createElement('canvas'); c.width=W; c.height=H; const g=c.getContext('2d'); drawBg(g,W,H);
    const im=await loadImg('data:image/svg+xml;charset=utf-8,'+encodeURIComponent(bracketSVG(br,W,H,T,f!=='9:16',{})));
    g.drawImage(im,0,0,W,H);
    await drawBrand(g,{x:W-420,y:H-50,w:380,h:28});
    const blob=await new Promise(res=>c.toBlob(res,'image/png')); if(!blob) throw new Error('blob');
    downloadBlob(blob,slugify(titleText())+'-'+f.replace(':','x')+'.png'); toast(i18n('tExported',{f}));
  }catch(err){console.warn(err);toast(i18n('tExportFail'));}
}
function toolInit(){
  $('#btnUndo').onclick=undo;
  $('#btnVote').onclick=toggleVote;
  $('#btnA').onclick=()=>decide(0);
  $('#btnB').onclick=()=>decide(1);
  $('#btnNext').onclick=next;
  $('#viewSeg').addEventListener('click',e=>{const b=e.target.closest('button[data-val]');if(b) setView(b.dataset.val);});
  $('#btnRestart').onclick=e=>{
    const b=e.currentTarget;
    if(!restartArm){b.textContent=i18n('restartSure');restartArm=setTimeout(()=>{restartArm=0;b.textContent=i18n('restart');},3000);return;}
    clearTimeout(restartArm);restartArm=0;b.textContent=i18n('restart');restart();toast(i18n('tRestarted'));commit();
  };
  $('#entAdd').addEventListener('keydown',e=>{if(e.key!=='Enter') return;e.preventDefault();if(!structural()) return;if(addEntry(e.target.value)){e.target.value='';commit();}});
  $('#btnImgs').onclick=()=>$('#imgFiles').click();
  $('#imgFiles').onchange=e=>{addFiles(e.target.files);e.target.value='';};
  $('#imgFile').onchange=e=>{const f=e.target.files[0];if(f&&pickFor) setImage(pickFor,f);e.target.value='';};
  $('#btnShuffle').onclick=shuffleEntries;
  $('#btnPaste').onclick=()=>{$('#pasteArea').value='';$('#pasteDlg').showModal();};
  $('#pasteCancel').onclick=()=>$('#pasteDlg').close();
  $('#pasteOk').onclick=()=>{
    if(structural()){for(const l of $('#pasteArea').value.split('\n')){if(!l.trim()) continue;if(!addEntry(l)) break;}commit();}
    $('#pasteDlg').close();
  };
  $('#btnClearEnt').onclick=e=>{
    const b=e.currentTarget;
    if(!clearArm){b.textContent=i18n('clearSure');clearArm=setTimeout(()=>{clearArm=0;b.textContent=i18n('clearAll');},3000);return;}
    clearTimeout(clearArm);clearArm=0;b.textContent=i18n('clearAll');if(structural()){state.entries=[];commit();}
  };
  const card=$('#entCard');
  card.addEventListener('dragover',e=>{if([...e.dataTransfer.types].includes('Files')){e.preventDefault();card.classList.add('tb-drop');}});
  card.addEventListener('dragleave',e=>{if(!card.contains(e.relatedTarget)) card.classList.remove('tb-drop');});
  card.addEventListener('drop',e=>{
    e.preventDefault(); card.classList.remove('tb-drop');
    const files=[...e.dataTransfer.files].filter(f=>/^image\//.test(f.type)), row=e.target.closest('.ent');
    if(row&&files.length===1) setImage(row.dataset.id,files[0]); else addFiles(files);
  });
  stage.addEventListener('click',e=>{
    if(!isOwner()) return;
    const g=e.target.closest('[data-k]');
    if(g){state.cur=g.getAttribute('data-k');state.view='duel';state.flash=0;commit();return;}
    const c=e.target.closest('.tb-card'); if(c) decide(+c.dataset.side);
  });
  setInterval(()=>{
    const v=state.vote;
    if(v&&v.open&&v.until){
      if(Date.now()>=v.until&&isOwner()){closeVote();return;}
      const cd=$('.tb-cta .cd',stage); if(cd) cd.textContent=fmtLeft(v.until);
      const bv=$('#btnVote'); if(bv) bv.textContent=i18n('voteStop')+' · '+fmtLeft(v.until);
    }
  },250);
}
