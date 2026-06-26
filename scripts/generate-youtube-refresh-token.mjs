import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';

const clientId = process.env.YOUTUBE_OAUTH_CLIENT_ID;
const clientSecret = process.env.YOUTUBE_OAUTH_CLIENT_SECRET;
const redirectUri = process.env.YOUTUBE_OAUTH_REDIRECT_URI ?? 'http://127.0.0.1:53682/oauth2callback';
const scope = 'https://www.googleapis.com/auth/youtube.force-ssl';

if (!clientId || !clientSecret) {
	console.error('Set YOUTUBE_OAUTH_CLIENT_ID and YOUTUBE_OAUTH_CLIENT_SECRET before running this script.');
	process.exit(1);
}

const state = randomBytes(24).toString('hex');
const redirect = new URL(redirectUri);

const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
authUrl.searchParams.set('client_id', clientId);
authUrl.searchParams.set('redirect_uri', redirectUri);
authUrl.searchParams.set('response_type', 'code');
authUrl.searchParams.set('scope', scope);
authUrl.searchParams.set('access_type', 'offline');
authUrl.searchParams.set('prompt', 'consent');
authUrl.searchParams.set('state', state);

async function exchangeCode(code) {
	const response = await fetch('https://oauth2.googleapis.com/token', {
		method: 'POST',
		headers: { 'content-type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			code,
			client_id: clientId,
			client_secret: clientSecret,
			redirect_uri: redirectUri,
			grant_type: 'authorization_code',
		}),
	});

	const body = await response.json();

	if (!response.ok) {
		throw new Error(JSON.stringify(body, null, 2));
	}

	return body;
}

const server = createServer(async (request, response) => {
	const requestUrl = new URL(request.url ?? '/', redirectUri);

	if (requestUrl.pathname !== redirect.pathname) {
		response.writeHead(404);
		response.end('Not found');
		return;
	}

	if (requestUrl.searchParams.get('state') !== state) {
		response.writeHead(400);
		response.end('Invalid OAuth state.');
		return;
	}

	const error = requestUrl.searchParams.get('error');
	if (error) {
		response.writeHead(400, { 'content-type': 'text/plain' });
		response.end(`Google returned an OAuth error: ${error}`);
		server.close();
		return;
	}

	const code = requestUrl.searchParams.get('code');
	if (!code) {
		response.writeHead(400, { 'content-type': 'text/plain' });
		response.end('Missing OAuth code.');
		return;
	}

	try {
		const token = await exchangeCode(code);
		response.writeHead(200, { 'content-type': 'text/html' });
		response.end('<p>Refresh token generated. You can close this tab and return to your terminal.</p>');

		console.log('\nAdd this value as the GitHub secret YOUTUBE_OAUTH_REFRESH_TOKEN:\n');
		console.log(token.refresh_token);
		console.log('\nKeep it secret. Do not commit it to the repository.\n');
	} catch (exchangeError) {
		response.writeHead(500, { 'content-type': 'text/plain' });
		response.end('Token exchange failed. Check the terminal output.');
		console.error(exchangeError);
		process.exitCode = 1;
	} finally {
		server.close();
	}
});

server.listen(Number(redirect.port), redirect.hostname, () => {
	console.log('Open this URL in a browser while this script is running:\n');
	console.log(authUrl.toString());
	console.log('\nWaiting for Google OAuth callback...');
});
