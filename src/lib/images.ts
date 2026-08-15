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

function widthsFor(source: ImageMetadata, candidates: number[]): number[] {
	// Never upscale: an emitted variant wider than the original just wastes bytes.
	const usable = candidates.filter((width) => width <= source.width);
	return usable.length ? usable : [source.width];
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
 * A hero background as a CSS `image-set()`, so the browser picks a width-appropriate
 * variant for a background-image that cannot carry a srcset.
 */
export interface HeroImage {
	/** Narrowest variant, used as the plain `url()` fallback for browsers without image-set. */
	fallbackSrc: string;
	imageSet: string;
	/**
	 * The same variants in srcset syntax. A background-image cannot be preloaded by URL
	 * without guessing which variant the browser will pick, so the preload carries the
	 * whole set and lets the browser preload exactly the one it is about to use.
	 */
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
		imageSet: variants
			.map((variant, index) => `url("${variant.src}") ${widths[index]}w`)
			.join(', '),
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
