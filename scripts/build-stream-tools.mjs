#!/usr/bin/env node
// Builds the stream tools in src/stream-tools/ into single, self-contained HTML files in
// public/stream-tools/. Every file runs on its own: embedded on the tool pages, opened
// directly, downloaded for offline use, and as an OBS browser source.
//
//   npm run build:stream-tools            write public/stream-tools/*.html
//   npm run build:stream-tools -- --check fail if a committed file is out of date
//
// Kit tools share src/stream-tools/kit/ (layout, i18n, Twitch chat, stream window) and
// add their own pieces from src/stream-tools/tools/<id>/. The two older tools in
// src/stream-tools/standalone/ are complete pages that only get the logos filled in.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const SOURCE_DIR = join(root, 'src/stream-tools');
export const OUTPUT_DIR = join(root, 'public/stream-tools');
export const KIT_TOOLS = ['chat-hotwords', 'spin-wheel', 'tournament-bracket', 'stream-scenes', 'death-counter'];
export const STANDALONE_TOOLS = ['tier-list', 'stream-bingo'];
export const STREAM_TOOL_IDS = [...STANDALONE_TOOLS, ...KIT_TOOLS];

const read = (path, fallback = '') => (existsSync(path) ? readFileSync(path, 'utf8') : fallback);
const replaceAll = (text, search, value) => text.split(search).join(value);

export function readBrand() {
	return JSON.parse(read(join(SOURCE_DIR, 'brand.json')));
}

export function applyBrand(text, brand = readBrand()) {
	let out = text;
	out = replaceAll(out, '%%LOGO_AR%%', String(brand.ar));
	out = replaceAll(out, '%%LOGO_LIGHT%%', brand.light);
	out = replaceAll(out, '%%LOGO_DARK%%', brand.dark);
	out = replaceAll(out, '%%ICON%%', brand.icon);
	return out;
}

export function buildKitTool(id, brand = readBrand()) {
	const toolDir = join(SOURCE_DIR, 'tools', id);
	const kitDir = join(SOURCE_DIR, 'kit');
	const part = (name) => read(join(toolDir, name));
	const tool = JSON.parse(part('tool.json'));
	const css = `${read(join(kitDir, 'core.css'))}\n/* --- Tool --- */\n${part('tool.css')}`;
	const core = applyBrand(read(join(kitDir, 'core.js')), brand);

	let exportMenu = '';
	if (tool.export?.length) {
		exportMenu = `<div class="menu"><button data-menu data-i18n="menuExport"></button><div class="menu-pop">${tool.export
			.map((format) => `<button data-export="${format}" data-i18n="exp${format.replace(':', '')}"></button>`)
			.join('')}</div></div>`;
	}

	let cams = '';
	if (tool.cams) {
		cams = `<div class="field"><span data-i18n="camSlots"></span><div class="seg" data-seg="cams"><button data-val="0" data-i18n="none"></button><button data-val="1">1</button><button data-val="2">2</button></div></div>
      <label class="field"><span data-i18n="camFill"></span>
        <select data-key="camFill">
          <option value="placeholder" data-i18n="fillPlaceholder"></option>
          <option value="transparent" data-i18n="fillTransparent"></option>
          <option value="magenta" data-i18n="fillMagenta"></option>
          <option value="blue" data-i18n="fillBlue"></option>
          <option value="green" data-i18n="fillGreen"></option>
        </select>
      </label>
      <label class="check"><input type="checkbox" data-key="camRing"> <span data-i18n="camRing"></span></label>`;
	}

	let formats = '';
	if (tool.formats?.length) {
		formats = `<div class="field"><span data-i18n="fFormat"></span><div class="seg" data-seg="format">${tool.formats
			.map(([value, label]) => (label === '' ? `<button data-val="${value}">${value}</button>` : `<button data-val="${value}" data-i18n="${label}"></button>`))
			.join('')}</div></div>`;
	}

	const layoutCard = `<div class="card">
      <h3 data-i18n="cardLayout"></h3>
      ${formats}
      ${part('layout_extra.html')}
      ${cams}
      <div class="colors">
        <label><input type="color" data-key="bg"> <span data-i18n="bgColor"></span></label>
        <label><input type="color" data-key="accent"> <span data-i18n="accentColor"></span></label>
      </div>
      <details class="adv"><summary data-i18n="advanced"></summary>
        <label class="check"><input type="checkbox" data-key="brand"> <span data-i18n="showBrand"></span></label>
      </details>
    </div>`;

	let chatCard = '';
	if (tool.chat) {
		chatCard = `<div class="card">
      <h3 data-i18n="cardChat"></h3>
      <label class="field"><span data-i18n="twitchChannel"></span><input type="text" data-key="chatChannel" maxlength="40" data-i18n-ph="twitchPh" autocomplete="off" spellcheck="false"></label>
      <button id="btnChat" class="small primary"></button>
      <div class="chat-status" id="chatStatus"><i></i><span></span></div>
      ${part('chat_extra.html')}
    </div>`;
	}

	const sideSource = part('side.html');
	let side = replaceAll(replaceAll(sideSource, '<!--CHAT-->', chatCard), '<!--LAYOUT-->', layoutCard);
	if (!sideSource.includes('<!--CHAT-->') && chatCard) side += chatCard;
	if (!sideSource.includes('<!--LAYOUT-->')) side += layoutCard;

	return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<title>${tool.title}</title>
<link rel="icon" id="favicon" href="data:,">
<!--
  kw.media Stream-Toolkit · ${tool.name} – v${tool.version ?? '0.1'}
  Läuft komplett lokal im Browser: keine Uploads, keine Werbung, kein Tracking.
-->
<style>
${css}
</style>
</head>
<body>
<header class="topbar">
  <div class="brand"><img class="brand-logo" id="brandLogo" alt="kw.media"><div class="brand-txt"><b data-i18n="appName"></b><small data-i18n="tagline"></small></div></div>
  <div class="actions">
    ${part('actions.html')}
    ${exportMenu}
    <button id="btnPopup" data-i18n="popup" data-i18n-title="popupTitle"></button>
    <button id="btnStream" data-i18n="streamView"></button>
    <button id="btnLang" class="ghost lang-btn"></button>
    <button id="btnHelp" class="ghost" data-i18n-aria="help">?</button>
  </div>
</header>
<main class="layout">
  <section class="left">
    <div id="stageWrap" class="stage-wrap"><div id="stage" class="stage"></div></div>
    ${part('left.html')}
  </section>
  <aside class="side">
    ${side}
  </aside>
</main>
<div id="toast"></div>
<div id="streamHint" data-i18n="streamHint"></div>
${part('dialogs.html')}
<dialog id="brandDlg">
  <h2 data-i18n="brandDlgTitle"></h2>
  <p data-i18n="brandDlgText"></p>
  <div class="dlg-foot"><button id="brandKeep" class="ghost" data-i18n="brandKeep"></button><button id="brandOff" data-i18n="brandOffAnyway"></button><button id="brandSub" class="primary" data-i18n="brandSub"></button></div>
</dialog>
<dialog id="help">
  ${part('help.html')}
  <h4 data-i18n="helpObsH"></h4>
  <p data-i18n="helpObs"></p>
  <div class="dlg-foot"><button class="primary" id="btnHelpClose" data-i18n="gotIt"></button></div>
</dialog>
<script>
(()=>{
'use strict';
${part('config.js')}
${core}
${part('logic.js')}
coreStart();
})();
</script>
</body>
</html>
`;
}

export function buildStandaloneTool(id, brand = readBrand()) {
	return applyBrand(read(join(SOURCE_DIR, 'standalone', `${id}.html`)), brand);
}

export function buildStreamTools() {
	const brand = readBrand();
	const files = new Map();
	for (const id of STANDALONE_TOOLS) files.set(`${id}.html`, buildStandaloneTool(id, brand));
	for (const id of KIT_TOOLS) files.set(`${id}.html`, buildKitTool(id, brand));
	return files;
}

export function staleStreamTools(files = buildStreamTools()) {
	return [...files].filter(([name, html]) => read(join(OUTPUT_DIR, name), null) !== html).map(([name]) => name);
}

export function writeStreamTools(files = buildStreamTools()) {
	mkdirSync(OUTPUT_DIR, { recursive: true });
	for (const [name, html] of files) writeFileSync(join(OUTPUT_DIR, name), html);
	return [...files.keys()];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	if (process.argv.includes('--check')) {
		const stale = staleStreamTools();
		if (stale.length) {
			console.error(`Out of date in public/stream-tools/: ${stale.join(', ')}\nRun: npm run build:stream-tools`);
			process.exit(1);
		}
		console.log('public/stream-tools/ is up to date.');
	} else {
		for (const name of writeStreamTools()) console.log(`public/stream-tools/${name}`);
	}
}
