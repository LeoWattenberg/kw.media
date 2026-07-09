interface AudioTransportOptions {
	onTick?: () => void;
	loop?: boolean;
}

type AudioContextConstructor = typeof AudioContext;

export class AudioTransport {
	private static readonly constructorRef: AudioContextConstructor | undefined =
		typeof window !== 'undefined'
			? window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioContextConstructor }).webkitAudioContext
			: undefined;

	private context: AudioContext | null = null;
	private source: AudioBufferSourceNode | null = null;
	private active: AudioBuffer | null = null;
	private startedAt = 0;
	private positionValue = 0;
	private durationValue = 0;
	private playing = false;
	private raf = 0;
	private readonly onTick?: () => void;

	loop: boolean;

	constructor(options: AudioTransportOptions = {}) {
		this.onTick = options.onTick;
		this.loop = options.loop ?? false;
	}

	static isSupported(): boolean {
		return Boolean(AudioTransport.constructorRef);
	}

	getContext(): AudioContext | null {
		if (!this.context && AudioTransport.constructorRef) {
			this.context = new AudioTransport.constructorRef();
		}

		return this.context;
	}

	async decode(arrayBuffer: ArrayBuffer): Promise<AudioBuffer> {
		const context = this.getContext();
		if (!context) {
			throw new Error('AudioContext is not available');
		}

		return context.decodeAudioData(arrayBuffer);
	}

	get isPlaying(): boolean {
		return this.playing;
	}

	get duration(): number {
		return this.durationValue;
	}

	set duration(value: number) {
		this.durationValue = Math.max(0, value);
	}

	get activeBuffer(): AudioBuffer | null {
		return this.active;
	}

	getPosition(): number {
		if (!this.playing || !this.context) {
			return this.positionValue;
		}

		const elapsed = this.context.currentTime - this.startedAt;
		return Math.min(this.durationValue, this.positionValue + elapsed);
	}

	play(buffer: AudioBuffer): void {
		const context = this.getContext();
		if (!context || !buffer) {
			return;
		}

		void context.resume();

		const nextPosition = this.playing ? this.getPosition() : this.positionValue;
		this.stopSource();
		this.active = buffer;
		this.positionValue = this.durationValue > 0 && nextPosition >= this.durationValue ? 0 : Math.max(0, nextPosition);
		this.startSource();
	}

	resume(): void {
		if (this.playing || !this.active) {
			return;
		}

		this.startSource();
	}

	pause(): void {
		if (this.playing) {
			this.positionValue = this.getPosition();
		}

		this.playing = false;
		this.stopSource();
		this.stopAnimation();
		this.notifyTick();
	}

	stop(): void {
		this.positionValue = 0;
		this.playing = false;
		this.stopSource();
		this.stopAnimation();
		this.notifyTick();
	}

	seek(seconds: number): void {
		this.positionValue = Math.max(0, Math.min(this.durationValue, seconds));

		if (this.playing && this.active) {
			this.startSource();
		} else {
			this.notifyTick();
		}
	}

	dispose(): void {
		this.stop();
		this.active = null;
	}

	private startSource(): void {
		const context = this.getContext();
		if (!context || !this.active) {
			return;
		}

		this.stopSource();

		const source = context.createBufferSource();
		source.buffer = this.active;
		source.connect(context.destination);
		source.onended = () => {
			if (this.source !== source) {
				return;
			}

			this.source = null;

			if (this.loop && this.playing) {
				this.positionValue = 0;
				this.startSource();
				return;
			}

			this.positionValue = this.durationValue;
			this.playing = false;
			this.stopAnimation();
			this.notifyTick();
		};

		const remaining = Math.max(0.01, this.durationValue - this.positionValue);
		source.start(0, this.positionValue, remaining);
		this.source = source;
		this.startedAt = context.currentTime;
		this.playing = true;
		this.startAnimation();
		this.notifyTick();
	}

	private stopSource(): void {
		if (!this.source) {
			return;
		}

		this.source.onended = null;
		try {
			this.source.stop();
		} catch {
			// The source may already have ended.
		}
		this.source.disconnect();
		this.source = null;
	}

	private startAnimation(): void {
		this.stopAnimation();

		const tick = () => {
			this.notifyTick();
			this.raf = window.requestAnimationFrame(tick);
		};

		this.raf = window.requestAnimationFrame(tick);
	}

	private stopAnimation(): void {
		if (this.raf) {
			window.cancelAnimationFrame(this.raf);
			this.raf = 0;
		}
	}

	private notifyTick(): void {
		this.onTick?.();
	}
}

export function formatAudioTime(seconds: number): string {
	if (!Number.isFinite(seconds) || seconds <= 0) {
		return '0:00';
	}

	const minutes = Math.floor(seconds / 60);
	const wholeSeconds = Math.floor(seconds % 60);
	return `${minutes}:${String(wholeSeconds).padStart(2, '0')}`;
}
