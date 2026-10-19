/* =====================================================================
   kw.media Stream-Toolkit – gemeinsamer Kern
   (Branding, Sprachen, Text einpassen, Bühne, Stream-Fenster, Twitch-Chat)
   ===================================================================== */
const KWM_YT='https://www.youtube.com/@koytekwattenbergmedia', KWM_SUB_URL=KWM_YT+'?sub_confirmation=1', KWM_SITE='https://kw.media/';
const KWM_COLOR='#ff6900', KWM_BG='#1e1e1e', KWM_LOGO_AR=%%LOGO_AR%%;
const KWM_LOGO_LIGHT='%%LOGO_LIGHT%%'; /* weiße Schrift – für dunkle Hintergründe */
const KWM_LOGO_DARK='%%LOGO_DARK%%'; /* schwarze Schrift – für helle Hintergründe */
const KWM_ICON='%%ICON%%'; /* Kurzlogo „kw·“ – Favicon */
const FONT='Ubuntu, "Segoe UI", system-ui, -apple-system, Roboto, Arial, sans-serif';
const FILLS=['placeholder','transparent','magenta','blue','green'];
const CAM_SVG='<svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M15 10l4.55-2.28A1 1 0 0 1 21 8.62v6.76a1 1 0 0 1-1.45.9L15 14"/><rect x="3" y="6" width="12" height="12" rx="2"/></svg>';

const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
const IS_STREAM_WIN=/stream/i.test(location.hash)||!!window.obsstudio;
const uid=()=>'x'+Date.now().toString(36)+Math.random().toString(36).slice(2,7);
const isHex=v=>typeof v==='string'&&/^#[0-9a-f]{6}$/i.test(v);
const hexRgb=h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16));
const mix=(a,b,t)=>{const x=hexRgb(a),y=hexRgb(b);return '#'+x.map((v,i)=>Math.round(v+(y[i]-v)*t).toString(16).padStart(2,'0')).join('');};
const lighten=(h,t)=>mix(h,'#ffffff',t);
const rgba=(h,a)=>{const [r,g,b]=hexRgb(h);return `rgba(${r},${g},${b},${a})`;};
function lum(h){const L=hexRgb(h).map(v=>{v/=255;return v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4);});return .2126*L[0]+.7152*L[1]+.0722*L[2];}
const textOn=h=>lum(h)>.2?'#000000':'#ffffff';
const brandLogoFor=bg=>{const l=lum(bg);return l<.16?KWM_LOGO_LIGHT:l>.55?KWM_LOGO_DARK:null;};
const norm=s=>String(s||'').trim().replace(/^@+/,'').toLowerCase();
const div=c=>{const e=document.createElement('div');if(c) e.className=c;return e;};
const el=(tag,cls,txt)=>{const e=document.createElement(tag);if(cls) e.className=cls;if(txt!=null) e.textContent=txt;return e;};
const place=(e,r)=>{e.style.left=r.x+'px';e.style.top=r.y+'px';e.style.width=r.w+'px';e.style.height=r.h+'px';return e;};
const mctx=document.createElement('canvas').getContext('2d');
const pad2=n=>String(n).padStart(2,'0');
const slugify=s=>String(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,40)||'kwmedia';

/* ---------- Sprachen ---------- */
const CORE_I18N={
de:{
  tagline:'läuft lokal, ohne Werbung', langLabel:'English', langCode:'ENG', help:'Hilfe', gotIt:'Alles klar',
  menuExport:'Export ▾', exp11:'Bild 1:1 <small>Insta · Threads · X</small>', exp916:'Bild 9:16 <small>Story · Shorts</small>', exp169:'Bild 16:9 <small>YouTube · Discord</small>',
  popup:'Stream-Fenster ↗', popupTitle:'Eigenes Fenster für die OBS-Fensteraufnahme', streamView:'Stream-Ansicht <kbd>F</kbd>', streamHint:'<kbd>Esc</kbd> zurück · <kbd>F11</kbd> Vollbild',
  cardChat:'Chat · Twitch', twitchChannel:'Twitch-Kanal', twitchPh:'deinkanal', connect:'Verbinden', disconnect:'Trennen',
  stOff:'Nicht verbunden', stConnecting:'Verbinde …', stReconnecting:'Verbindung weg – versuche es erneut …', stOn:'Verbunden mit #{ch}', stError:'Fehler', stNoAnswer:'#{ch} antwortet nicht – Kanalname richtig?', stImpossible:'Verbindung nicht möglich', raw:'{s}', tEnterChannel:'Bitte erst den Twitch-Kanal eintragen',
  cardLayout:'Layout', fFormat:'Format', camSlots:'Cam-Slots', none:'Keine', camFill:'Cam-Fläche',
  fillPlaceholder:'Platzhalter – Cam in OBS drüberlegen', fillTransparent:'Transparent – für OBS-Browserquelle', fillMagenta:'Magenta – Chroma Key (empfohlen)', fillBlue:'Blau – Chroma Key', fillGreen:'Grün – Chroma Key',
  camRing:'Rahmen um die Cam', bgColor:'Hintergrund', accentColor:'Akzent', advanced:'Erweitert', showBrand:'„made with kw.media“ anzeigen',
  brandDlgTitle:'Logo ausblenden?', brandDlgText:'Dieses Tool ist kostenlos und werbefrei – das kleine „made with kw.media“ ist das Einzige, was wir dafür zurückbekommen. Magst du uns stattdessen mit einem Abo auf YouTube unterstützen? Ausblenden kannst du es so oder so.',
  brandSub:'Abonnieren &amp; ausblenden', brandOffAnyway:'Trotzdem ausblenden', brandKeep:'Doch anlassen',
  tExported:'Bild {f} exportiert', tExportFail:'Export fehlgeschlagen', tPopupBlocked:'Popup blockiert – bitte Popups für diese Datei erlauben.', tPopupOpen:'Stream-Fenster offen – in OBS als Fensteraufnahme hinzufügen.', tStorageFull:'Browser-Speicher ist voll.',
  helpObsH:'OBS einrichten',
  helpObs:'„Stream-Fenster ↗“ öffnen und in OBS als <i>Fensteraufnahme</i> hinzufügen – du steuerst im Hauptfenster, alles wird live gespiegelt. Alternativ als Browserquelle („Lokale Datei“): Dann startet die Datei direkt in der Stream-Ansicht, und mit „Transparent“ ist der Hintergrund durchsichtig. Bedienen über Rechtsklick → „Interagieren“, <kbd>F</kbd> blendet die Bedienelemente ein.'
},
en:{
  tagline:'runs locally, no ads', langLabel:'Deutsch', langCode:'DEU', help:'Help', gotIt:'Got it',
  menuExport:'Export ▾', exp11:'Image 1:1 <small>Insta · Threads · X</small>', exp916:'Image 9:16 <small>Story · Shorts</small>', exp169:'Image 16:9 <small>YouTube · Discord</small>',
  popup:'Stream window ↗', popupTitle:'Separate window for OBS window capture', streamView:'Stream view <kbd>F</kbd>', streamHint:'<kbd>Esc</kbd> back · <kbd>F11</kbd> full screen',
  cardChat:'Chat · Twitch', twitchChannel:'Twitch channel', twitchPh:'yourchannel', connect:'Connect', disconnect:'Disconnect',
  stOff:'Not connected', stConnecting:'Connecting …', stReconnecting:'Connection lost – retrying …', stOn:'Connected to #{ch}', stError:'Error', stNoAnswer:'#{ch} isn’t responding – is the channel name right?', stImpossible:'Can’t connect', raw:'{s}', tEnterChannel:'Please enter your Twitch channel first',
  cardLayout:'Layout', fFormat:'Format', camSlots:'Cam slots', none:'None', camFill:'Cam area',
  fillPlaceholder:'Placeholder – put your cam on top in OBS', fillTransparent:'Transparent – for an OBS browser source', fillMagenta:'Magenta – chroma key (recommended)', fillBlue:'Blue – chroma key', fillGreen:'Green – chroma key',
  camRing:'Frame around the cam', bgColor:'Background', accentColor:'Accent', advanced:'Advanced', showBrand:'Show “made with kw.media”',
  brandDlgTitle:'Hide the logo?', brandDlgText:'This tool is free and ad-free – the small “made with kw.media” is all we get in return. Would you like to support us with a YouTube subscription instead? You can hide it either way.',
  brandSub:'Subscribe &amp; hide', brandOffAnyway:'Hide anyway', brandKeep:'Keep it',
  tExported:'Image {f} exported', tExportFail:'Export failed', tPopupBlocked:'Pop-up blocked – please allow pop-ups for this file.', tPopupOpen:'Stream window is open – add it in OBS as a window capture.', tStorageFull:'Browser storage is full.',
  helpObsH:'Setting up OBS',
  helpObs:'Open “Stream window ↗” and add it in OBS as a <i>Window Capture</i> – you control everything in the main window and it’s mirrored live. Alternatively use a Browser source (“Local file”): the file then starts straight in stream view, and with “Transparent” the background is see-through. Control it via right-click → “Interact”; <kbd>F</kbd> shows the controls.'
}};
const I18N={de:{...CORE_I18N.de,...TOOL_I18N.de},en:{...CORE_I18N.en,...TOOL_I18N.en}};
const QS=new URLSearchParams(location.search);
/* Sprache: ?lang=de|en (Einbettung auf kw.media) > /de/ bzw. /en/ im Pfad > gespeichert > Browser */
const PATH_LANG=(((QS.get('lang')||'').match(/^(de|en)$/i)||[])[1]||(/\/(de|en)(\/|$)/i.exec(location.pathname)||[])[1]||'').toLowerCase();
/* ?embed=1: läuft im Rahmen einer kw.media-Seite – Logo und Sprachknopf übernimmt die Seite */
if(QS.get('embed')==='1') document.documentElement.classList.add('embedded');
let LANG=(()=>{
  if(PATH_LANG) return PATH_LANG;
  try{const o=JSON.parse(localStorage.getItem(TOOL.key)||'{}');if(o&&(o.lang==='de'||o.lang==='en')) return o.lang;}catch(e){}
  return /^de\b/i.test(navigator.language||'')?'de':'en';
})();
function i18n(k,p){let s=I18N[LANG][k];if(s==null) s=I18N.de[k];if(s==null) return k;return p?s.replace(/\{(\w+)\}/g,(m,n)=>p[n]!=null?String(p[n]):m):s;}
const inLang=(lg,k,p)=>{const keep=LANG;LANG=lg;const s=i18n(k,p);LANG=keep;return s;};

/* ---------- Text einpassen ---------- */
function tokens(text){const out=[];for(const w of String(text).split(/\s+/).filter(Boolean)) w.replace(/-/g,'-\u0000').split('\u0000').filter(Boolean).forEach((t,i)=>out.push({t,sp:i===0}));return out;}
function wrapText(g,text,maxW,noBreak){
  const lines=[]; let cur='';
  for(const {t,sp} of tokens(text)){
    const cand=cur?cur+(sp?' ':'')+t:t;
    if(g.measureText(cand).width<=maxW){cur=cand;continue;}
    if(cur) lines.push(cur);
    if(!noBreak&&g.measureText(t).width>maxW){let part='';for(const ch of t){if(part&&g.measureText(part+ch+'-').width>maxW){lines.push(part+'-');part=ch;}else part+=ch;}cur=part;}
    else cur=t;
  }
  if(cur) lines.push(cur);
  return lines.length?lines:[''];
}
function fitBlock(g,text,maxW,maxH,start,weight=700,lh=1.1,maxLines=4,minFs=9){
  start=Math.max(minFs,Math.floor(start)); let single=null, multi=null;
  for(let fs=start;fs>=minFs;fs--){g.font=`${weight} ${fs}px ${FONT}`;if(g.measureText(text).width<=maxW&&fs*lh<=maxH){single={fs,lines:[text]};break;}}
  for(let fs=start;fs>=minFs;fs--){g.font=`${weight} ${fs}px ${FONT}`;const l=wrapText(g,text,maxW,true);if(l.length<=maxLines&&l.every(x=>g.measureText(x).width<=maxW)&&l.length*fs*lh<=maxH){multi={fs,lines:l};break;}}
  if(single&&(!multi||single.fs>=multi.fs*.85)) return single;
  if(multi) return multi;
  g.font=`${weight} ${minFs}px ${FONT}`; return {fs:minFs,lines:wrapText(g,text,maxW)};
}
function capFor(texts,w,h,start,weight=700,lh=1.1,maxLines=4){const f=texts.map(t=>fitBlock(mctx,t,w,h,start,weight,lh,maxLines).fs).sort((a,b)=>a-b);return f.length?f[Math.floor(f.length*.35)]:start;}
function fitInto(e,text,w,h,start,weight=700,lh=1.1,maxLines=4){
  const fb=fitBlock(mctx,text,w,h,start,weight,lh,maxLines);
  e.classList.add('fit'); let sp=e.querySelector(':scope > span'); if(!sp){sp=document.createElement('span');e.append(sp);}
  sp.textContent=fb.lines.join('\n'); e.style.fontSize=fb.fs+'px'; return fb;
}
function ellipsize(g,t,w){if(g.measureText(t).width<=w) return t;while(t&&g.measureText(t+'…').width>w) t=t.slice(0,-1);return t+'…';}

/* ---------- Bühne: Bausteine ---------- */
const stage=$('#stage'), wrap=$('#stageWrap');
function rrPath(r){const {x,y,w,h}=r,k=r.r||0;if(!k) return `M${x} ${y}h${w}v${h}h${-w}Z`;return `M${x+k} ${y}H${x+w-k}A${k} ${k} 0 0 1 ${x+w} ${y+k}V${y+h-k}A${k} ${k} 0 0 1 ${x+w-k} ${y+h}H${x+k}A${k} ${k} 0 0 1 ${x} ${y+h-k}V${y+k}A${k} ${k} 0 0 1 ${x+k} ${y}Z`;}
function bgLayer(L,holes){
  const w=document.createElement('div'), d=`M0 0H${L.W}V${L.H}H0Z`+(holes||[]).map(rrPath).join('');
  w.innerHTML=`<svg class="rg" style="left:0;top:0" xmlns="http://www.w3.org/2000/svg" width="${L.W}" height="${L.H}" viewBox="0 0 ${L.W} ${L.H}"><defs><linearGradient id="kwbg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${lighten(state.bg,.07)}"/><stop offset="1" stop-color="${state.bg}"/></linearGradient><radialGradient id="kwglow" cx="0" cy="0" r=".75"><stop offset="0" stop-color="${state.accent}" stop-opacity=".18"/><stop offset="1" stop-color="${state.accent}" stop-opacity="0"/></radialGradient></defs><path fill="url(#kwbg)" fill-rule="evenodd" d="${d}"/><path fill="url(#kwglow)" fill-rule="evenodd" d="${d}"/></svg>`;
  return w.firstChild;
}
function camEls(L,out){
  (L.cams||[]).forEach((r,i)=>{
    if(state.camRing){const ring=div('rg cam-ring');place(ring,{x:r.x-7,y:r.y-7,w:r.w+14,h:r.h+14});ring.style.borderRadius=(r.r?r.r+7:0)+'px';out.push(ring);}
    const c=div('rg cam fill-'+state.camFill); place(c,r); c.style.borderRadius=r.r+'px';
    const lab=div('cam-ph'+(state.camFill==='placeholder'?'':' editor-only'));
    lab.innerHTML=(['green','magenta','blue'].includes(state.camFill)?'':CAM_SVG)+`<span>CAM ${i+1}</span>`;
    c.append(lab); out.push(c);
  });
}
function camRects16x9(n,P,RW,CH){const W=1920,rx=W-P-RW,cams=[];let y=P;for(let i=0;i<n;i++){cams.push({x:rx,y,w:RW,h:CH,r:18});y+=CH+24;}return {cams,y,rx};}
function camRects9x16(n){if(n===1) return [{x:0,y:0,w:1080,h:608,r:0}];if(n===2) return [{x:0,y:0,w:536,h:608,r:0},{x:544,y:0,w:536,h:608,r:0}];return [];}
function camRects1x1(n,P=40,cw=320,ch=180){const cams=[];for(let i=0;i<n;i++) cams.push({x:1080-P-(i+1)*cw-i*16,y:P,w:cw,h:ch,r:16});return cams;}
function brandBox(r,bg){
  bg=bg||state.bg;
  const b=div('rg brand-rg'); place(b,r); b.style.fontSize=Math.round(r.h*.6)+'px';
  const src=brandLogoFor(bg); b.append(el('span',null,'made with'));
  if(src){const im=new Image();im.src=src;im.alt='kw.media';im.draggable=false;im.style.height=r.h+'px';im.style.width=Math.round(r.h*KWM_LOGO_AR)+'px';b.append(im);}
  else b.append(el('b',null,'kw.media'));
  b.classList.toggle('on-light',lum(bg)>.55); return b;
}
function fitStage(){
  const W=parseFloat(stage.style.width)||1920,H=parseFloat(stage.style.height)||1080; let aw,ah;
  if(document.body.classList.contains('streaming')){aw=innerWidth;ah=innerHeight;}
  else{aw=wrap.clientWidth;const maxH=Math.max(260,innerHeight*(TOOL.previewH||.66)),k0=Math.min(aw/W,maxH/H);ah=Math.round(H*k0);wrap.style.height=ah+'px';}
  const k=Math.min(aw/W,ah/H);
  stage.style.transform=`translate(${(aw-W*k)/2}px,${(ah-H*k)/2}px) scale(${k})`;
}
function renderStage(){
  const L=computeLayout(); stage.style.width=L.W+'px'; stage.style.height=L.H+'px';
  const out=[]; buildStage(L,out); stage.replaceChildren(...out.filter(Boolean)); fitStage();
}
function refresh(){renderStage();if(typeof renderTool==='function') renderTool({});}
function applyTheme(){
  const r=document.documentElement.style;
  r.setProperty('--accent',state.accent); r.setProperty('--accent-glow',rgba(state.accent,.45)); r.setProperty('--accent-soft',rgba(state.accent,.3)); r.setProperty('--accent-text',textOn(state.accent));
  const see=typeof seeThrough==='function'?seeThrough():state.camFill==='transparent';
  document.documentElement.classList.toggle('see-through',document.body.classList.contains('streaming')&&see);
  wrap.classList.toggle('checker',!document.body.classList.contains('streaming')&&see&&typeof seeThrough==='function');
}

/* ---------- Zustand, Speichern, Sync ---------- */
let state=null;
function commonDefaults(){return {lang:LANG,format:TOOL.formats?TOOL.formats[0]:'16:9',cams:TOOL.hasCams?1:0,camFill:'placeholder',camRing:true,brand:true,bg:KWM_BG,accent:KWM_COLOR,chatChannel:'',chatAuto:false};}
function normalizeCommon(s,o){
  if(!s||typeof s!=='object') return o;
  if(s.lang==='de'||s.lang==='en') o.lang=s.lang;
  if(TOOL.formats&&TOOL.formats.includes(s.format)) o.format=s.format;
  if([0,1,2].includes(s.cams)&&TOOL.hasCams) o.cams=s.cams;
  if(FILLS.includes(s.camFill)) o.camFill=s.camFill;
  for(const k of ['camRing','brand','chatAuto']) if(typeof s[k]==='boolean') o[k]=s[k];
  if(isHex(s.bg)) o.bg=s.bg; if(isHex(s.accent)) o.accent=s.accent;
  if(typeof s.chatChannel==='string') o.chatChannel=s.chatChannel.slice(0,40);
  return o;
}
const peers=new Set(); let popupRef=null, saveT=0, bcT=0, saveWarned=false;
function commit(o={}){
  if(state.lang!==LANG){const old=LANG;LANG=state.lang;applyLang();if(typeof onLangChanged==='function') onLangChanged(old,LANG);}
  applyTheme();
  if(!o.skipSidebar) renderSidebar();
  renderStage();
  if(typeof renderTool==='function') renderTool(o);
  if(!o.fromPeer){clearTimeout(saveT);saveT=setTimeout(saveNow,250);clearTimeout(bcT);bcT=setTimeout(broadcast,30);}
}
function saveNow(){try{localStorage.setItem(TOOL.key,JSON.stringify(typeof serialize==='function'?serialize():state));}catch(e){if(!saveWarned){saveWarned=true;toast(i18n('tStorageFull'));}}}
function sendPeers(d){for(const p of [...peers]){try{if(p.closed){peers.delete(p);continue;}p.postMessage(d,'*');}catch(e){peers.delete(p);}}}
function broadcast(){if(peers.size) sendPeers({kwm:TOOL.msg,state:typeof serialize==='function'?serialize():state});}
function applyIncoming(s){try{if(JSON.stringify(s)===JSON.stringify(typeof serialize==='function'?serialize():state)) return;}catch(e){}state=normalize(s);commit({fromPeer:true});}
window.addEventListener('message',e=>{
  const d=e.data; if(!d||typeof d!=='object') return;
  if(d.kwm==='hello'){if(popupRef&&e.source===popupRef){peers.add(e.source);e.source.postMessage({kwm:TOOL.msg,state:typeof serialize==='function'?serialize():state},'*');if(typeof onPeerJoined==='function') onPeerJoined(e.source);}return;}
  if(!peers.has(e.source)) return;
  if(d.kwm===TOOL.msg&&d.state) applyIncoming(d.state);
  else if(typeof onPeerMessage==='function') onPeerMessage(d);
});
window.addEventListener('storage',e=>{if(e.key===TOOL.key&&e.newValue){try{applyIncoming(JSON.parse(e.newValue));}catch(err){}}});

/* ---------- Sidebar-Bindung ---------- */
function renderSidebar(){
  for(const x of $$('[data-key]')){if(x===document.activeElement) continue;const k=x.dataset.key;if(x.type==='checkbox') x.checked=!!state[k];else x.value=state[k]??'';}
  for(const seg of $$('[data-seg]')){const k=seg.dataset.seg;for(const b of seg.children) b.classList.toggle('on',String(state[k])===b.dataset.val);}
  if(typeof renderToolSidebar==='function') renderToolSidebar();
}
function bindSidebar(root){
  root.addEventListener('input',e=>{
    const x=e.target,k=x.dataset.key; if(!k||x.type==='checkbox'||x.tagName==='SELECT') return;
    if(x.type==='color'&&!isHex(x.value)) return;
    state[k]=x.type==='number'?(x.value===''?'':+x.value):x.value; commit({skipSidebar:true});
  });
  root.addEventListener('change',e=>{
    const x=e.target,k=x.dataset.key; if(!k) return;
    if(k==='brand'&&!x.checked&&state.brand){x.checked=true;x.blur();$('#brandDlg').showModal();return;}
    if(x.type==='checkbox'){state[k]=x.checked;commit();x.blur();}
    else if(x.tagName==='SELECT'){state[k]=x.value;commit({skipSidebar:true});x.blur();}
  });
  root.addEventListener('click',e=>{
    const b=e.target.closest('[data-seg] > button'); if(!b) return;
    const k=b.parentElement.dataset.seg; state[k]=(TOOL.numKeys||[]).includes(k)?+b.dataset.val:b.dataset.val; commit();
  });
}

/* ---------- Sprache anwenden ---------- */
function applyLang(){
  document.documentElement.lang=LANG;
  document.title=IS_STREAM_WIN?TOOL.streamTitle:i18n('pageTitle');
  const P=typeof i18nParams==='function'?i18nParams():null;
  for(const x of $$('[data-i18n]')) x.innerHTML=i18n(x.dataset.i18n,P);
  for(const x of $$('[data-i18n-ph]')) x.placeholder=i18n(x.dataset.i18nPh);
  for(const x of $$('[data-i18n-title]')) x.title=i18n(x.dataset.i18nTitle);
  for(const x of $$('[data-i18n-aria]')) x.setAttribute('aria-label',i18n(x.dataset.i18nAria));
  const lb=$('#btnLang'); lb.replaceChildren(el('span',null,i18n('langLabel')),el('small',null,i18n('langCode')));
  if($('#chatStatus')) paintChatStatus();
}

/* ---------- Twitch-Chat (anonym, nur lesen) ---------- */
const IRC_URL=(()=>{const u=new URLSearchParams(location.search).get('irc');return u&&/^wss?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(u)?u:'wss://irc-ws.chat.twitch.tv:443';})();
const chat={ws:null,want:false,status:'off',retry:0,timer:0,joinT:0,channel:'',msg:null};
const cleanChannel=c=>String(c||'').trim().toLowerCase().replace(/^https?:\/\/(www\.|m\.)?twitch\.tv\//,'').replace(/^[#@]/,'').replace(/[^a-z0-9_]/g,'').slice(0,25);
function setChatStatus(st,key,params){chat.status=st;chat.msg=key?[key,params]:null;paintChatStatus();if(typeof onChatStatus==='function') onChatStatus(st);}
function paintChatStatus(){
  const box=$('#chatStatus'); if(!box) return; const st=chat.status;
  box.className='chat-status '+({on:'on',connecting:'wait',reconnecting:'wait',error:'err'}[st]||'');
  box.querySelector('span').textContent=chat.msg?i18n(chat.msg[0],chat.msg[1]):i18n({off:'stOff',connecting:'stConnecting',reconnecting:'stReconnecting',on:'stOn',error:'stError'}[st],{ch:chat.channel});
  const b=$('#btnChat'); if(b){b.textContent=i18n(chat.want?'disconnect':'connect'); b.classList.toggle('primary',!chat.want);}
}
function chatConnect(){
  const ch=cleanChannel(state.chatChannel); if(!ch){toast(i18n('tEnterChannel'));return;}
  chatDisconnect(true); chat.channel=ch; chat.want=true; chat.retry=0;
  if(!state.chatAuto){state.chatAuto=true;commit({skipSidebar:true});}
  openSocket();
}
function chatDisconnect(silent){
  chat.want=false; clearTimeout(chat.timer); clearTimeout(chat.joinT);
  const ws=chat.ws; chat.ws=null; if(ws){try{ws.close();}catch(e){}}
  if(!silent&&state.chatAuto){state.chatAuto=false;commit({skipSidebar:true});}
  setChatStatus('off');
}
function openSocket(){
  setChatStatus(chat.retry?'reconnecting':'connecting');
  let ws; try{ws=new WebSocket(IRC_URL);}catch(e){setChatStatus('error','stImpossible');return;}
  chat.ws=ws;
  ws.onopen=()=>{ws.send('CAP REQ :twitch.tv/tags twitch.tv/commands');ws.send('PASS SCHMOOPIIE');ws.send('NICK justinfan'+(10000+Math.floor(Math.random()*80000)));ws.send('JOIN #'+chat.channel);
    clearTimeout(chat.joinT);chat.joinT=setTimeout(()=>{if(chat.ws===ws&&chat.status!=='on') setChatStatus('error','stNoAnswer',{ch:chat.channel});},8000);};
  ws.onmessage=e=>{if(chat.ws!==ws) return;for(const line of String(e.data).split('\r\n')) if(line) onIrc(line,ws);};
  ws.onclose=()=>{if(chat.ws!==ws) return;chat.ws=null;clearTimeout(chat.joinT);
    if(chat.want){const d=Math.min(30000,1000*2**Math.min(chat.retry++,5));setChatStatus('reconnecting');chat.timer=setTimeout(()=>{if(chat.want) openSocket();},d);}else setChatStatus('off');};
}
function onIrc(line,ws){
  if(line.startsWith('PING')){try{ws.send('PONG'+line.slice(4));}catch(e){}return;}
  let rest=line; const tags={};
  if(rest[0]==='@'){const i=rest.indexOf(' ');for(const kv of rest.slice(1,i).split(';')){const j=kv.indexOf('=');tags[kv.slice(0,j)]=kv.slice(j+1);}rest=rest.slice(i+1);}
  const m=/^(?::(\S+) )?(\S+)(?: (.*?))?(?: :(.*))?$/.exec(rest); if(!m) return;
  const prefix=m[1]||'',cmd=m[2],trail=m[4]||'';
  if(cmd==='ROOMSTATE'||cmd==='366'||(cmd==='JOIN'&&/^justinfan/.test(prefix))){if(chat.status!=='on'){clearTimeout(chat.joinT);chat.retry=0;setChatStatus('on');}return;}
  if(cmd==='RECONNECT'){try{ws.close();}catch(e){}return;}
  if((cmd==='CLEARCHAT'||cmd==='CLEARMSG')&&typeof onChatClear==='function'){onChatClear({id:cmd==='CLEARMSG'?(tags['target-msg-id']||''):'',user:cmd==='CLEARCHAT'?trail.trim().toLowerCase():'',all:cmd==='CLEARCHAT'&&!trail.trim()});return;}
  if(cmd==='NOTICE'&&/fail|invalid|banned|suspend|unavailable/i.test(trail)){setChatStatus('error','raw',{s:trail.slice(0,90)});return;}
  if(cmd==='PRIVMSG'&&typeof onChatMessage==='function'){
    const badges=tags.badges||'';
    onChatMessage({user:prefix.split('!')[0],name:(tags['display-name']||'').replace(/\\s/g,' ')||prefix.split('!')[0],text:trail,mod:/(^|,)(moderator|broadcaster)\//.test(badges),broadcaster:/(^|,)broadcaster\//.test(badges),sub:/(^|,)(subscriber|founder)\//.test(badges),vip:/(^|,)vip\//.test(badges),color:/^#[0-9a-f]{6}$/i.test(tags.color||'')?tags.color:'',emotes:tags.emotes||'',id:tags.id||'',source:'twitch'});
  }
}

/* ---------- Export-Helfer ---------- */
function loadImg(src){return new Promise((res,rej)=>{const im=new Image();im.onload=()=>res(im);im.onerror=rej;im.src=src;});}
function rr(g,x,y,w,h,r){r=Math.min(r,w/2,h/2);g.beginPath();g.moveTo(x+r,y);g.arcTo(x+w,y,x+w,y+h,r);g.arcTo(x+w,y+h,x,y+h,r);g.arcTo(x,y+h,x,y,r);g.arcTo(x,y,x+w,y,r);g.closePath();}
function drawBg(g,W,H){
  let gr=g.createLinearGradient(0,0,W,H); gr.addColorStop(0,lighten(state.bg,.07)); gr.addColorStop(1,state.bg); g.fillStyle=gr; g.fillRect(0,0,W,H);
  gr=g.createRadialGradient(0,0,0,0,0,Math.max(W,H)*.75); gr.addColorStop(0,rgba(state.accent,.18)); gr.addColorStop(1,rgba(state.accent,0)); g.fillStyle=gr; g.fillRect(0,0,W,H);
}
async function drawBrand(g,B){
  if(!state.brand) return;
  const fs=Math.round(B.h*.6), src=brandLogoFor(state.bg), light=lum(state.bg)>.55, cy=B.y+B.h/2;
  g.textBaseline='middle'; g.textAlign='left'; g.font=`500 ${fs}px ${FONT}`; const tw=g.measureText('made with').width;
  g.fillStyle=light?'rgba(0,0,0,.55)':'rgba(255,255,255,.45)';
  if(src){const im=await loadImg(src), lw=B.h*KWM_LOGO_AR, x1=B.x+B.w-lw; g.drawImage(im,x1,B.y,lw,B.h); g.fillText('made with',x1-fs-tw,cy);}
  else{g.font=`800 ${fs}px ${FONT}`;const w2=g.measureText('kw.media').width;g.font=`500 ${fs}px ${FONT}`;const x0=B.x+B.w-w2-tw-fs*.3;g.fillText('made with',x0,cy);g.font=`800 ${fs}px ${FONT}`;g.fillStyle=light?'rgba(0,0,0,.85)':'#fff';g.fillText('kw.media',x0+tw+fs*.3,cy);}
}
function downloadBlob(b,name){const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),4000);}
function confettiOn(host,W,H,dur=3.6){
  const c=document.createElement('canvas'); c.className='confetti'; c.width=W; c.height=H; c.style.cssText='position:absolute;left:0;top:0;pointer-events:none;z-index:9'; host.append(c);
  const g=c.getContext('2d'), cols=[state.accent,'#ffffff','#0096ff','#ffd400','#22c55e','#ff4d8d'], P=[];
  for(let i=0;i<220;i++) P.push({x:W/2+(Math.random()-.5)*W*.3,y:H*.35,vx:(Math.random()-.5)*28,vy:-Math.random()*26-8,s:8+Math.random()*12,r:Math.random()*6,vr:(Math.random()-.5)*.4,c:cols[i%cols.length]});
  const t0=performance.now();
  const step=t=>{const dt=(t-t0)/1000;g.clearRect(0,0,W,H);for(const p of P){p.vy+=.9;p.vx*=.99;p.x+=p.vx;p.y+=p.vy;p.r+=p.vr;g.save();g.translate(p.x,p.y);g.rotate(p.r);g.globalAlpha=Math.max(0,1-dt/dur);g.fillStyle=p.c;g.fillRect(-p.s/2,-p.s/4,p.s,p.s/2);g.restore();}
    if(dt<dur&&c.isConnected) requestAnimationFrame(step); else c.remove();};
  requestAnimationFrame(step); return c;
}

/* ---------- Bedienung ---------- */
let toastT=0;
function toast(msg){const t=$('#toast');t.textContent=msg;t.classList.add('show');clearTimeout(toastT);toastT=setTimeout(()=>t.classList.remove('show'),2600);}
let hintT=0;
function toggleStream(on){
  const v=on===undefined?!document.body.classList.contains('streaming'):on;
  document.body.classList.toggle('streaming',v); applyTheme(); fitStage();
  if(v&&!IS_STREAM_WIN){const h=$('#streamHint');h.classList.add('show');clearTimeout(hintT);hintT=setTimeout(()=>h.classList.remove('show'),2600);}
}
const isTyping=x=>x&&(/^(INPUT|TEXTAREA|SELECT)$/.test(x.tagName)||x.isContentEditable);
function coreBind(){
  document.addEventListener('click',e=>{
    const t=e.target.closest('[data-menu]'), open=$$('.menu.open');
    if(t){const m=t.parentElement,was=m.classList.contains('open');open.forEach(x=>x.classList.remove('open'));if(!was) m.classList.add('open');return;}
    if(!e.target.closest('.menu-pop')||e.target.closest('.menu-pop button')) open.forEach(x=>x.classList.remove('open'));
    const ex=e.target.closest('[data-export]'); if(ex&&typeof toolExport==='function') toolExport(ex.dataset.export);
    const btn=e.target.closest('button'); if(btn) setTimeout(()=>btn.blur(),0);
  });
  const side=$('.side'); if(side) bindSidebar(side);
  if($('#btnChat')) $('#btnChat').onclick=()=>{chat.want?chatDisconnect(false):chatConnect();};
  const cc=$('[data-key=chatChannel]'); if(cc) cc.addEventListener('keydown',e=>{if(e.key==='Enter'&&!chat.want){e.preventDefault();e.target.blur();chatConnect();}});
  $('#btnStream').onclick=()=>toggleStream(true);
  $('#btnPopup').onclick=()=>{
    const sz=(TOOL.popupSize&&TOOL.popupSize(state))||[1280,720];
    popupRef=window.open(location.href.split('#')[0]+'#stream',TOOL.msg+'_stream',`popup=yes,width=${sz[0]},height=${sz[1]}`);
    toast(i18n(popupRef?'tPopupOpen':'tPopupBlocked'));
  };
  $('#btnLang').onclick=()=>{state.lang=LANG==='de'?'en':'de';if(typeof beforeLangSwitch==='function') beforeLangSwitch(LANG,state.lang);commit();};
  $('#btnHelp').onclick=()=>$('#help').showModal();
  $('#btnHelpClose').onclick=()=>$('#help').close();
  const brandOff=()=>{state.brand=false;commit();$('#brandDlg').close();};
  $('#brandSub').onclick=()=>{try{window.open(KWM_SUB_URL,'_blank','noopener');}catch(e){}brandOff();};
  $('#brandOff').onclick=brandOff;
  $('#brandKeep').onclick=()=>$('#brandDlg').close();
  document.addEventListener('keydown',e=>{
    if(isTyping(e.target)||$$('dialog[open]').length) return;
    if(typeof toolKeys==='function'&&toolKeys(e)) return;
    if(e.ctrlKey||e.metaKey||e.altKey) return;
    if(e.key==='f'||e.key==='F'){e.preventDefault();toggleStream();}
    else if(e.key==='Escape'&&document.body.classList.contains('streaming')&&!IS_STREAM_WIN) toggleStream(false);
  });
  let rz=0;
  addEventListener('resize',()=>{cancelAnimationFrame(rz);rz=requestAnimationFrame(()=>{fitStage();if(typeof onResize==='function') onResize();});});
  if(window.ResizeObserver){let last=0;new ResizeObserver(()=>{const w=wrap.clientWidth;if(w!==last){last=w;requestAnimationFrame(fitStage);}}).observe(wrap);}
}
function coreStart(){
  if(IS_STREAM_WIN) document.body.classList.add('streaming');
  $('#brandLogo').src=KWM_LOGO_LIGHT; $('#favicon').href=KWM_ICON;
  try{const raw=localStorage.getItem(TOOL.key);state=raw?normalize(JSON.parse(raw)):defaultState();}catch(e){state=defaultState();}
  state.lang=LANG;
  coreBind(); applyLang(); applyTheme();
  if(typeof toolInit==='function') toolInit();
  commit({fromPeer:true});
  if(document.fonts&&document.fonts.ready) document.fonts.ready.then(refresh);
  if(IS_STREAM_WIN&&window.opener){peers.add(window.opener);try{window.opener.postMessage({kwm:'hello'},'*');}catch(e){}}
  if(state.chatAuto&&state.chatChannel&&$('#chatStatus')&&!(IS_STREAM_WIN&&window.opener)) chatConnect();
}
