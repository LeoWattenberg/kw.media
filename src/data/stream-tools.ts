import type { Locale } from '../i18n';

// Stream tools are self-contained HTML apps built from src/stream-tools/ into
// public/stream-tools/ (npm run build:stream-tools). Their tool pages embed them.
export type StreamToolId =
	| 'tier-list'
	| 'stream-bingo'
	| 'chat-hotwords'
	| 'spin-wheel'
	| 'tournament-bracket'
	| 'stream-scenes'
	| 'death-counter';

export interface StreamTool {
	id: StreamToolId;
	file: string;
	obsTip: Record<Locale, string>;
}

export const streamTools: StreamTool[] = [
	{
		id: 'tier-list',
		file: 'tier-list.html',
		obsTip: {
			de: 'Für die Cam-Plätze „Magenta“ wählen und in OBS einen Chroma Key auf die Fensteraufnahme legen – bei einer Browserquelle geht auch „Transparent“.',
			en: 'Choose “Magenta” for the cam slots and add a chroma key to the window capture in OBS – with a browser source, “Transparent” works too.',
		},
	},
	{
		id: 'stream-bingo',
		file: 'stream-bingo.html',
		obsTip: {
			de: 'Den Zuschauer-Link in den Chat posten: Jeder gibt dort seinen Twitch-Namen ein und bekommt seine eigene Karte, auch auf dem Handy.',
			en: 'Post the viewer link in chat: everyone enters their Twitch name there and gets their own card, on mobile too.',
		},
	},
	{
		id: 'chat-hotwords',
		file: 'chat-hotwords.html',
		obsTip: {
			de: 'Als Browserquelle mit „Karte, Rest transparent“ – oder per Fensteraufnahme mit „Karte auf Magenta“ und Chroma Key.',
			en: 'As a browser source with “Card, rest transparent” – or as a window capture with “Card on magenta” and a chroma key.',
		},
	},
	{
		id: 'spin-wheel',
		file: 'spin-wheel.html',
		obsTip: {
			de: 'Das Format „Nur Rad“ mit transparentem Hintergrund passt als kleines Overlay in jede Szene.',
			en: 'The “Wheel only” format with a transparent background fits into any scene as a small overlay.',
		},
	},
	{
		id: 'tournament-bracket',
		file: 'tournament-bracket.html',
		obsTip: {
			de: 'Mit B wechselst du zwischen Duell und Turnierbaum. Nach dem Stream gibt es den Baum als Bild in 1:1, 9:16 oder 16:9.',
			en: 'Press B to switch between duel and bracket. After the stream, export the bracket as an image in 1:1, 9:16, or 16:9.',
		},
	},
	{
		id: 'stream-scenes',
		file: 'stream-scenes.html',
		obsTip: {
			de: 'Feste Szenen ohne Umschalten: Hänge #stream-start, #stream-brb oder #stream-end an die Adresse der Browserquelle.',
			en: 'Fixed scenes without switching: append #stream-start, #stream-brb, or #stream-end to the browser source address.',
		},
	},
	{
		id: 'death-counter',
		file: 'death-counter.html',
		obsTip: {
			de: 'Mitten im Spiel zählst du am einfachsten per Chat: Du oder deine Mods schreiben zum Beispiel !tod. Tasten wirken nur, solange das Tool-Fenster aktiv ist.',
			en: 'Mid-game, counting via chat is easiest: you or your mods type, for example, !death. Keys only work while the tool window is focused.',
		},
	},
];

export function getStreamTool(id: StreamToolId): StreamTool {
	const tool = streamTools.find((candidate) => candidate.id === id);

	if (!tool) {
		throw new Error(`Unknown stream tool: ${id}`);
	}

	return tool;
}

export function streamToolFilePath(tool: StreamTool): string {
	return `/stream-tools/${tool.file}`;
}
