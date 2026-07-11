self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil((async () => {
	const scopePath = new URL(self.registration.scope).pathname;
	if (!scopePath.includes('/tools/')) {
		await self.registration.unregister();
		return;
	}
	await self.clients.claim();
})()));

self.addEventListener('fetch', (event) => {
	if (event.request.cache === 'only-if-cached' && event.request.mode !== 'same-origin') return;
	if (event.request.method !== 'GET' || !/^https?:$/.test(new URL(event.request.url).protocol)) return;

	event.respondWith(fetch(event.request).then((response) => {
		if (response.type === 'opaque' || response.type === 'opaqueredirect') return response;
		const headers = new Headers(response.headers);
		headers.set('Cross-Origin-Opener-Policy', 'same-origin');
		headers.set('Cross-Origin-Embedder-Policy', 'credentialless');
		return new Response(response.body, {
			status: response.status,
			statusText: response.statusText,
			headers,
		});
	}).catch(() => Response.error()));
});
