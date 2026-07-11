import { createPandocInstance } from '../../../node_modules/pandoc-wasm/src/core.js';

export const PANDOC_WASM_URL = 'https://unpkg.com/pandoc-wasm@1.1.0/src/pandoc.wasm';

let pandocPromise;

async function loadPandoc() {
	if (!pandocPromise) {
		pandocPromise = fetch(PANDOC_WASM_URL)
			.then((response) => {
				if (!response.ok) {
					throw new Error(`Pandoc WASM could not be loaded (${response.status}).`);
				}
				return response.arrayBuffer();
			})
			.then(createPandocInstance);
	}

	return pandocPromise;
}

export async function convert(...args) {
	return (await loadPandoc()).convert(...args);
}

export async function query(...args) {
	return (await loadPandoc()).query(...args);
}
