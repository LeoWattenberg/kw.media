import type { APIContext } from 'astro';

export function GET(context: APIContext) {
	const site = context.site ?? new URL('https://kw.media');
	const body = [
		'User-agent: *',
		'Allow: /',
		`Sitemap: ${new URL('/sitemap-index.xml', site).toString()}`,
		'',
	].join('\n');

	return new Response(body, {
		headers: {
			'Content-Type': 'text/plain; charset=utf-8',
		},
	});
}
