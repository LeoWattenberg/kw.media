import { getImage } from 'astro:assets';
import type { ImageMetadata } from 'astro';

/**
 * Images that live in src/assets go through Astro's image pipeline, which emits
 * resized AVIF/WebP variants with content-hashed filenames. Page data refers to them
 * by their old public-directory path (`/assets/about.jpg`), so this module maps those
 * paths back onto the bundled asset.
 *
 * Anything the pipeline cannot resolve — legacy WordPress uploads under
 * /assets/wp-content/, and remote thumbnails — is passed through untouched.
 */
const localAssets = import.meta.glob<{ default: ImageMetadata }>(
	'/src/assets/**/*.{jpg,jpeg,png,avif,webp}',
	{ eager: true },
);

/** Widths emitted for full-bleed hero backgrounds, covering phone through desktop. */
const heroWidths = [640, 1024, 1600, 2400];

/** Widths emitted for in-flow content images, which never render full-bleed. */
const contentWidths = [420, 840, 1260];

/** Facebook, LinkedIn and X all expect a 1.91:1 preview. */
const socialWidth = 1200;
const socialHeight = 630;

export function resolveLocalImage(path: string | undefined): ImageMetadata | undefined {
	if (!path) {
		return undefined;
	}

	// Page data stores URL-encoded paths for filenames containing spaces.
	return localAssets[`/src${decodeURIComponent(path)}`]?.default;
}

/**
 * The emitted URL of a bundled asset at its original size, for consumers that need a plain
 * href rather than a picked variant — structured data, mainly. Returns undefined for paths
 * the pipeline does not own, so callers can fall back to the path as written.
 */
export function assetUrl(path: string | undefined): string | undefined {
	return resolveLocalImage(path)?.src;
}

function widthsFor(source: ImageMetadata, candidates: number[]): number[] {
	// Never upscale: an emitted variant wider than the original just wastes bytes. The source
	// width is always offered as the top variant, though — dropping every candidate above it
	// would cap a source that sits just below the next candidate well under what a high-DPI
	// screen asks for, and a 640px portrait in a 280px box needs 560px, not 420px.
	const usable = candidates.filter((width) => width < source.width);
	return [...usable, source.width];
}

export interface ResponsiveImage {
	src: string;
	srcset: string;
	width: number;
	height: number;
}

async function buildResponsive(
	source: ImageMetadata,
	candidates: number[],
	format: 'avif' | 'webp',
): Promise<ResponsiveImage> {
	const widths = widthsFor(source, candidates);
	const variants = await Promise.all(
		widths.map((width) => getImage({ src: source, width, format })),
	);
	const largest = variants[variants.length - 1];

	return {
		src: largest.src,
		srcset: variants.map((variant, index) => `${variant.src} ${widths[index]}w`).join(', '),
		width: largest.attributes.width ?? source.width,
		height: largest.attributes.height ?? source.height,
	};
}

/** A content image sized for in-flow rendering, or undefined if it is not a bundled asset. */
export async function contentImage(path: string | undefined): Promise<ResponsiveImage | undefined> {
	const source = resolveLocalImage(path);
	return source ? buildResponsive(source, contentWidths, 'webp') : undefined;
}

/**
 * A hero background, rendered as a full-bleed `<img>` rather than a CSS background. A
 * background-image can only pick a variant by resolution (`image-set()` takes `<resolution>`
 * descriptors, not the `w` descriptors a full-bleed image actually needs), so an `<img>` with
 * `srcset` and `sizes="100vw"` is the only way the browser can size the hero to the viewport.
 */
export interface HeroImage {
	/** Narrowest variant, used as the plain `src` for browsers that ignore `srcset`. */
	fallbackSrc: string;
	/** The variants in srcset syntax, shared verbatim with the `<link rel=preload>` in the head. */
	srcset: string;
}

export async function heroImage(path: string | undefined): Promise<HeroImage | undefined> {
	const source = resolveLocalImage(path);
	if (!source) {
		return undefined;
	}

	const widths = widthsFor(source, heroWidths);
	const variants = await Promise.all(
		widths.map((width) => getImage({ src: source, width, format: 'avif' })),
	);

	return {
		fallbackSrc: variants[0].src,
		srcset: variants
			.map((variant, index) => `${variant.src} ${widths[index]}w`)
			.join(', '),
	};
}

/**
 * A social preview image. Always JPEG: link-preview scrapers at Facebook, LinkedIn and X
 * cannot decode AVIF or WebP, so an AVIF og:image renders as no preview at all.
 */
export async function socialImage(path: string | undefined): Promise<string | undefined> {
	const source = resolveLocalImage(path);
	if (!source) {
		return undefined;
	}

	const image = await getImage({
		src: source,
		width: Math.min(socialWidth, source.width),
		height: Math.min(socialHeight, source.height),
		fit: 'cover',
		format: 'jpeg',
	});

	return image.src;
}
