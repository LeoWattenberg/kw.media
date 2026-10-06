import assert from 'node:assert/strict';
import test from 'node:test';
import {
	buildRequestMailto,
	formatRequestBody,
	formatRequestCopy,
	formatRequestSubject,
	requestFieldLines,
} from '../src/lib/request-form.js';

const FIELDS = [
	{ name: 'name', label: 'Name', type: 'text' },
	{ name: 'channel', label: 'Link to your channel', type: 'text' },
	{ name: 'goal', label: 'What do you want?', type: 'textarea' },
	{ name: 'tried', label: 'What have you tried?', type: 'textarea' },
	{ name: 'example', label: 'You may use my channel as an example.', type: 'checkbox' },
];

test('short fields become "label: value" lines and textareas keep their own block', () => {
	const lines = requestFieldLines(FIELDS, {
		name: '  Ada  ',
		channel: 'youtube.com/@ada',
		goal: 'More regulars\nFewer one-off viewers',
		tried: '',
		example: true,
	});

	assert.deepEqual(lines, [
		'Name: Ada',
		'Link to your channel: youtube.com/@ada',
		'What do you want?\r\nMore regulars\r\nFewer one-off viewers',
		'[x] You may use my channel as an example.',
	]);
});

test('empty optional fields and unticked checkboxes are left out of the body', () => {
	const body = formatRequestBody(FIELDS, { name: 'Ada', channel: '', goal: '   ', tried: '', example: false });

	assert.equal(body, 'Name: Ada');
});

test('blocks are separated by a blank CRLF line', () => {
	const body = formatRequestBody(FIELDS, { name: 'Ada', channel: 'x', goal: 'y', tried: '', example: false });

	assert.equal(body, 'Name: Ada\r\n\r\nLink to your channel: x\r\n\r\nWhat do you want?\r\ny');
});

test('subject placeholders take the field value and drop a dangling separator', () => {
	assert.equal(formatRequestSubject('Channel Check – {channel}', { channel: ' youtube.com/@ada ' }), 'Channel Check – youtube.com/@ada');
	assert.equal(formatRequestSubject('Channel Check – {channel}', { channel: '' }), 'Channel Check');
	assert.equal(formatRequestSubject('Kanal-Check – {channel}', {}), 'Kanal-Check');
	assert.equal(formatRequestSubject('Check: {channel}', { channel: 'a\nb' }), 'Check: a b');
});

test('the mailto link encodes subject and body so mail clients restore them exactly', () => {
	const subject = 'Channel Check – youtube.com/@ada';
	const body = 'Name: Ada & Co\r\n\r\nWhat do you want?\r\n100% more?';
	const href = buildRequestMailto({ email: 'team@kw.media', subject, body });
	const url = new URL(href);

	assert.equal(url.protocol, 'mailto:');
	assert.equal(url.pathname, 'team@kw.media');
	assert.equal(url.searchParams.get('subject'), subject);
	assert.equal(url.searchParams.get('body'), body);
	assert.match(href, /body=Name%3A%20Ada%20%26%20Co%0D%0A%0D%0A/);
});

test('the copy text names recipient and subject above the body', () => {
	assert.equal(
		formatRequestCopy({ email: 'team@kw.media', subject: 'Channel Check', body: 'Name: Ada' }),
		'To: team@kw.media\r\nSubject: Channel Check\r\n\r\nName: Ada',
	);
});
