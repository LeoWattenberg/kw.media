// @ts-check
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig } from 'astro/config';

import sitemap from '@astrojs/sitemap';

const site = process.env.ASTRO_SITE ?? 'https://kw.media';
const base = process.env.ASTRO_BASE ?? '/';
const redirects = {
  '/de/': '/',

  '/ads/': '/en/ads/',
  '/b2b/': '/de/b2b/',
  '/creator/': '/de/creator/',
  '/imprint-service/': '/en/imprint-service/',
  '/live/': '/de/live/',
  '/vtuber/': '/en/vtuber/',
  '/webdesign/': '/de/webdesign-management/',
  '/website-design-management/': '/en/website-design-management/',
  '/werbung/': '/de/werbung/',

  '/new/ads/': '/en/ads/',
  '/new/creator/': '/en/creator/',
  '/new/': '/en/',

  '/de/games/mp3guesser/': '/de/games/mp3-guesser/',
  '/en/games/mp3guesser/': '/en/games/mp3-guesser/',

  '/blog/': '/en/youtube-tips/',
  '/category/': '/en/youtube-tips/',
  '/category/blog/': '/en/youtube-tips/',
  '/category/uncategorized/': '/en/youtube-tips/',
  '/category/uncategorized-de/': '/de/youtube-tipps/',
  '/category/youtube-tips-de/': '/de/youtube-tipps/',
  '/category/youtube-tips-en/': '/en/youtube-tips/',
  '/category/youtube-tipps-de/': '/de/youtube-tipps/',
  '/youtube-tips-en/': '/en/youtube-tips/',
  '/youtube-tipps-de/': '/de/youtube-tipps/',

  '/author/koytekconsulting/': '/en/creator/',
  '/author/leo/': '/en/vtuber/',
  '/author/': '/en/creator/',
  '/creatorguides/': '/en/youtube-tips/',
  '/youtube/': 'https://www.youtube.com/channel/UCGu6U-UNczXKxShRiJj6kXQ',
};

const redirectSourceUrls = new Set(Object.keys(redirects).map((path) => new URL(path, site).toString()));
const postLastmodByUrl = readPostLastmodByUrl();

function readPostLastmodByUrl() {
  const postsDir = join(process.cwd(), 'src/data/posts');
  const entries = new Map();

  for (const filePath of markdownFiles(postsDir)) {
    const frontmatter = readFrontmatter(filePath);
    if (!frontmatter.path) {
      continue;
    }

    const lastmod = frontmatter.modified ?? frontmatter.date;
    if (!lastmod) {
      continue;
    }

    entries.set(new URL(frontmatter.path, site).toString(), new Date(lastmod).toISOString());
  }

  return entries;
}

function markdownFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = join(directory, entry.name);

    if (entry.isDirectory()) {
      return markdownFiles(entryPath);
    }

    return entry.isFile() && entry.name.endsWith('.md') ? [entryPath] : [];
  });
}

function readFrontmatter(filePath) {
  const raw = readFileSync(filePath, 'utf8');
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const frontmatter = {};

  for (const line of (match?.[1] ?? '').split(/\r?\n/)) {
    const fieldMatch = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (!fieldMatch) {
      continue;
    }

    frontmatter[fieldMatch[1]] = parseFrontmatterValue(fieldMatch[2]);
  }

  return frontmatter;
}

function parseFrontmatterValue(value) {
  if (/^".*"$/.test(value)) {
    return JSON.parse(value);
  }

  return value;
}

// https://astro.build/config
export default defineConfig({
  site,
  base,

  redirects,

  integrations: [sitemap({
    filter: (page) => !redirectSourceUrls.has(page),
    serialize: (item) => {
      const lastmod = postLastmodByUrl.get(item.url);
      return lastmod ? { ...item, lastmod } : item;
    },
    namespaces: {
      news: false,
      xhtml: true,
      image: false,
      video: false,
    },
  })],

});
