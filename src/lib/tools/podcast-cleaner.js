export function outputFormat(value) {
	if (value === 'wav') return { extension: 'wav', mime: 'audio/wav', args: ['-c:a', 'pcm_s16le'] };
	if (value === 'm4a') return { extension: 'm4a', mime: 'audio/mp4', args: ['-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart'] };
	if (value === 'opus') return { extension: 'opus', mime: 'audio/ogg', args: ['-c:a', 'libopus', '-b:a', '96k'] };
	return { extension: 'mp3', mime: 'audio/mpeg', args: ['-c:a', 'libmp3lame', '-b:a', '160k'] };
}

export function buildPodcastCleanerArgs(inputName, outputName, outputInfo, settings = {}) {
	const filters = [];
	if (settings.highpass) filters.push(`highpass=f=${Number(settings.highpassFreq || 80)}`);
	if (settings.lowpass) filters.push('lowpass=f=14500');
	if (settings.denoise) filters.push('afftdn=nf=-25');
	if (settings.declick) filters.push('adeclick');
	if (settings.silence) {
		const threshold = Number(settings.silenceThreshold || -45);
		filters.push(`silenceremove=start_periods=1:start_duration=0.25:start_threshold=${threshold}dB:stop_periods=-1:stop_duration=0.7:stop_threshold=${threshold}dB`);
	}
	if (settings.compress) filters.push('acompressor=threshold=-18dB:ratio=3:attack=12:release=180:makeup=2');
	if (settings.loudness) filters.push('loudnorm=I=-16:TP=-1.5:LRA=11');

	const args = ['-i', inputName, '-map', '0:a:0', '-vn'];
	if (filters.length) args.push('-af', filters.join(','));
	args.push(...outputInfo.args, '-y', outputName);
	return args;
}
