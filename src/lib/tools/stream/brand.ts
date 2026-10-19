import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The stream tools must work as a single downloaded file and as an OBS browser source,
// so they carry the site's logos and favicon from public/ inline as data URIs.
export interface StreamToolBrand {
	light: string;
	dark: string;
	icon: string;
	ar: number;
}

const publicFile = (path: string) => readFileSync(join(process.cwd(), 'public', path));
const dataUri = (path: string, type: string) => `data:${type};base64,${publicFile(path).toString('base64')}`;

function aspectRatio(path: string): number {
	const viewBox = /viewBox="([^"]+)"/.exec(publicFile(path).toString('utf8'))?.[1].trim().split(/\s+/).map(Number);
	return viewBox && viewBox[3] ? Math.round((viewBox[2] / viewBox[3]) * 1000) / 1000 : 2.5;
}

let brand: StreamToolBrand | undefined;

export function streamToolBrand(): StreamToolBrand {
	brand ??= {
		light: dataUri('logo/logo-weiß.svg', 'image/svg+xml'),
		dark: dataUri('logo/logo-schwarz.svg', 'image/svg+xml'),
		icon: dataUri('favicon-32x32.png', 'image/png'),
		ar: aspectRatio('logo/logo-weiß.svg'),
	};
	return brand;
}
