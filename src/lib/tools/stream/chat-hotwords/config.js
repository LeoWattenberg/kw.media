const TOOL={key:'kwm-hotwords-v1',msg:'kwm-hotwords',streamTitle:'Hotwords · Stream',formats:['panel','bar','square'],hasCams:false,numKeys:['win','top'],previewH:.62,
  popupSize:s=>s.format==='bar'?[1200,170]:s.format==='square'?[700,720]:[480,720]};
const TOOL_I18N={
de:{
  pageTitle:'Hotwords · kw.media', appName:'Hotwords',
  fmtPanel:'Hochkant', fmtBar:'Leiste', fmtSquare:'Quadrat',
  liveTitle:'Gerade im Chat', liveStats:'{m} Nachrichten · {p} Leute · letzte {w} s', liveHint:'Klick auf ✕ blendet ein Wort dauerhaft aus (landet in „Ignorieren“).', liveEmpty:'Noch nichts – Chat verbinden oder die Demo starten.',
  demoOn:'Demo starten', demoOff:'Demo stoppen', reset:'Zurücksetzen',
  cardWords:'Auswertung', fWin:'Zeitfenster', fMode:'Zählen nach', modeWords:'Wörtern', modeMsgs:'Ganzen Nachrichten',
  fOnce:'Eine Stimme pro Person (gegen Spam)', fStop:'Füllwörter ignorieren (der, und, ist …)', fCmds:'Befehle ignorieren (!…)',
  fIgnore:'Wörter ignorieren (durch Komma getrennt)', ignorePh:'z. B. hallo, moin', fIgnoreUsers:'Nutzer ignorieren (Bots)',
  cardLook:'Darstellung', fHeading:'Überschrift', titleDefault:'Chat sagt gerade', fTop:'Anzahl Einträge', fBgMode:'Hintergrund',
  bgCard:'Karte, Rest transparent (Browserquelle)', bgMagenta:'Karte auf Magenta (Chroma Key)', bgFull:'Volle Fläche',
  stWin:'letzte {w} s', stRate:'{r} Nachr./Min.', stPeople:'{p} aktiv', stEmpty:'Warte auf den Chat …',
  tIgnored:'„{w}“ wird ab jetzt ignoriert',
  helpTitle:'So funktionieren Hotwords',
  help1:'<b>Chat verbinden:</b> Twitch-Kanal eintragen, „Verbinden“ – kein Login nötig. Zum Ausprobieren gibt’s die Demo.',
  help2:'<b>Was gezählt wird:</b> Alles, was in den letzten Sekunden geschrieben wurde – nach Wörtern (Emotes wie „LUL“ oder „W“ zählen einzeln) oder nach ganzen Nachrichten. Mit „Eine Stimme pro Person“ zählt jeder Nutzer pro Wort nur einmal, Spammer verzerren also nichts.',
  help3:'<b>Ins Bild:</b> „Hochkant“ passt an den Rand, „Leiste“ oben oder unten ins Bild. Als OBS-Browserquelle mit „Karte, Rest transparent“ – oder per Fensteraufnahme mit „Karte auf Magenta“ und Chroma Key.'
},
en:{
  pageTitle:'Hotwords · kw.media', appName:'Hotwords',
  fmtPanel:'Panel', fmtBar:'Bar', fmtSquare:'Square',
  liveTitle:'In chat right now', liveStats:'{m} messages · {p} people · last {w} s', liveHint:'Clicking ✕ hides a word permanently (it’s added to “Ignore”).', liveEmpty:'Nothing yet – connect your chat or start the demo.',
  demoOn:'Start demo', demoOff:'Stop demo', reset:'Reset',
  cardWords:'Analysis', fWin:'Time window', fMode:'Count by', modeWords:'Words', modeMsgs:'Whole messages',
  fOnce:'One vote per person (against spam)', fStop:'Ignore filler words (the, and, is …)', fCmds:'Ignore commands (!…)',
  fIgnore:'Ignore words (comma-separated)', ignorePh:'e.g. hello, hi', fIgnoreUsers:'Ignore users (bots)',
  cardLook:'Look', fHeading:'Heading', titleDefault:'Chat is saying', fTop:'Number of entries', fBgMode:'Background',
  bgCard:'Card, rest transparent (browser source)', bgMagenta:'Card on magenta (chroma key)', bgFull:'Full area',
  stWin:'last {w} s', stRate:'{r} msgs/min', stPeople:'{p} active', stEmpty:'Waiting for chat …',
  tIgnored:'Ignoring “{w}” from now on',
  helpTitle:'How Hotwords works',
  help1:'<b>Connect chat:</b> enter your Twitch channel and hit “Connect” – no login needed. Use the demo to try it out.',
  help2:'<b>What gets counted:</b> everything written in the last seconds – by words (emotes like “LUL” or “W” count individually) or by whole messages. With “One vote per person” each user counts once per word, so spammers can’t skew it.',
  help3:'<b>On screen:</b> “Panel” fits along the side, “Bar” at the top or bottom. As an OBS browser source use “Card, rest transparent” – or a window capture with “Card on magenta” and a chroma key.'
}};
