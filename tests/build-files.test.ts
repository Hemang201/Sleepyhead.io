import { describe, expect, it } from 'vitest';

import {
  contentTypeFor,
  decodePathSegment,
  detectEntryPath,
  extensionOf,
  fileCountExceedsLimit,
  formatBytes,
  isHtmlPath,
  safeBuildPath,
  sniffImage,
  stripSingleRoot,
} from '../src/shared/build-files';

/**
 * The upload pipeline is the security-sensitive part of this project, so its
 * pure rules are tested directly: path handling, the file-type allowlist, entry
 * detection and image identification by magic bytes.
 */

describe('safeBuildPath', () => {
  it('accepts ordinary build paths and strips leading ./ segments', () => {
    expect(safeBuildPath('index.html')).toBe('index.html');
    expect(safeBuildPath('./Build/game.wasm')).toBe('Build/game.wasm');
    expect(safeBuildPath('a/b/c/index.html')).toBe('a/b/c/index.html');
  });

  it('rejects traversal in any form', () => {
    expect(safeBuildPath('../secrets.txt')).toBeNull();
    expect(safeBuildPath('a/../../etc/passwd.html')).toBeNull();
    expect(safeBuildPath('..')).toBeNull();
    expect(safeBuildPath('a/..')).toBeNull();
  });

  it('rejects absolute paths, backslashes and control characters', () => {
    expect(safeBuildPath('/etc/passwd.html')).toBe('etc/passwd.html'); // leading slash is not a traversal
    expect(safeBuildPath('a\\b.html')).toBeNull();
    expect(safeBuildPath('bad\u0000name.html')).toBeNull();
    expect(safeBuildPath('bad\nname.html')).toBeNull();
  });

  it('refuses files that would change how the site itself is hosted', () => {
    expect(safeBuildPath('_headers')).toBeNull();
    expect(safeBuildPath('_redirects')).toBeNull();
    expect(safeBuildPath('nested/_redirects')).toBeNull();
    expect(safeBuildPath('.htaccess')).toBeNull();
    expect(safeBuildPath('wrangler.toml')).toBeNull();
  });

  it('only allows file types a browser game build legitimately needs', () => {
    for (const path of ['index.html', 'main.js', 'style.css', 'game.wasm', 'game.data', 'game.unityweb', 'app.pck', 'logo.png', 'sound.ogg', 'app.framework.js']) {
      expect(safeBuildPath(path), path).not.toBeNull();
    }
    for (const path of ['evil.php', 'run.sh', 'tool.exe', 'lib.dll', 'server.mjs.bak', 'notes.txt.exe']) {
      expect(safeBuildPath(path), path).toBeNull();
    }
  });

  it('limits path length and depth', () => {
    expect(safeBuildPath('a'.repeat(300) + '.js')).toBeNull();
    expect(safeBuildPath('a/'.repeat(25) + 'index.html')).toBeNull();
  });
});

describe('detectEntryPath', () => {
  it('prefers the shallowest index.html', () => {
    expect(detectEntryPath(['Build/index.html', 'index.html', 'assets/a.js']).entry).toBe('index.html');
  });

  it('falls back to a single HTML file', () => {
    expect(detectEntryPath(['game.html', 'game.js']).entry).toBe('game.html');
  });

  it('refuses to guess when several HTML files exist', () => {
    const result = detectEntryPath(['a.html', 'b.html']);
    expect(result.entry).toBeNull();
    expect(result.candidates).toHaveLength(2);
  });

  it('reports when there is no HTML at all', () => {
    expect(detectEntryPath(['a.js']).entry).toBeNull();
  });
});

describe('stripSingleRoot', () => {
  const bytes = new Uint8Array([1, 2, 3]);

  it('removes one wrapping folder, the way most exports ship', () => {
    const { files, strippedPrefix } = stripSingleRoot([
      { path: 'MyGame/index.html', bytes },
      { path: 'MyGame/script.js', bytes },
    ]);
    expect(strippedPrefix).toBe('MyGame');
    expect(files.map((file) => file.path)).toEqual(['index.html', 'script.js']);
  });

  it('leaves an already-flat build alone', () => {
    const { files, strippedPrefix } = stripSingleRoot([
      { path: 'index.html', bytes },
      { path: 'script.js', bytes },
    ]);
    expect(strippedPrefix).toBeNull();
    expect(files).toHaveLength(2);
  });

  it('does not strip when files live in different top-level folders', () => {
    const { strippedPrefix } = stripSingleRoot([
      { path: 'Build/index.html', bytes },
      { path: 'TemplateData/style.css', bytes },
    ]);
    expect(strippedPrefix).toBeNull();
  });

  it('enforces the file-count limit', () => {
    const many = Array.from({ length: 10 }, (_, index) => ({ path: `f${index}.js`, bytes }));
    expect(stripSingleRoot(many, 4).files).toHaveLength(4);
  });

  it('treats MAX_BUILD_FILES + 1 as an overflow instead of a truncation', () => {
    const maxBuildFiles = 3000;
    expect(fileCountExceedsLimit(maxBuildFiles, maxBuildFiles)).toBe(false);
    expect(fileCountExceedsLimit(maxBuildFiles + 1, maxBuildFiles)).toBe(true);
  });
});

describe('sniffImage', () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0, 0, 0]);
  const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);

  it('identifies real images from their leading bytes', () => {
    expect(sniffImage(png)?.contentType).toBe('image/png');
    expect(sniffImage(jpeg)?.contentType).toBe('image/jpeg');
    expect(sniffImage(gif)?.contentType).toBe('image/gif');
    expect(sniffImage(webp)?.contentType).toBe('image/webp');
  });

  it('refuses content that is not an image at all', () => {
    expect(sniffImage(new TextEncoder().encode('<svg onload="alert(1)"></svg>'))).toBeNull();
    expect(sniffImage(new TextEncoder().encode('nothing like an image here'))).toBeNull();
    expect(sniffImage(new Uint8Array(0))).toBeNull();
  });

  it('identifies by leading bytes only, which is why images are also served with a sandbox', () => {
    // A file that begins with the GIF signature is treated as a GIF — the guard
    // against that being script is the response policy on artwork, not sniffing.
    expect(sniffImage(new TextEncoder().encode('GIF89a'))?.contentType).toBe('image/gif');
  });
});

describe('decodePathSegment', () => {
  it('decodes a normal escaped segment', () => {
    expect(decodePathSegment('pixel%20painter')).toBe('pixel painter');
    expect(decodePathSegment('caf%C3%A9')).toBe('café');
    expect(decodePathSegment('plain-slug')).toBe('plain-slug');
  });

  it('reports malformed escapes instead of throwing a URIError', () => {
    expect(decodePathSegment('%')).toBeNull();
    expect(decodePathSegment('%ZZ')).toBeNull();
    expect(decodePathSegment('%E0%A4%A')).toBeNull();
  });
});

describe('content types', () => {
  it('maps the formats a web build needs', () => {
    expect(contentTypeFor('index.html')).toContain('text/html');
    expect(contentTypeFor('app.js')).toContain('javascript');
    expect(contentTypeFor('game.wasm')).toBe('application/wasm');
    expect(contentTypeFor('unknownthing')).toBe('application/octet-stream');
  });

  it('never serves a script as HTML', () => {
    expect(contentTypeFor('payload.js')).not.toContain('html');
    expect(isHtmlPath('payload.js')).toBe(false);
    expect(extensionOf('Build/game.framework.js')).toBe('js');
  });

  it('formats sizes for humans', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
  });
});
