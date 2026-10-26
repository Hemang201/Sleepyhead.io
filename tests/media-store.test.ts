import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  deleteMedia,
  mediaExists,
  mediaLimitBytes,
  mediaProvider,
  MediaStoreError,
  putMedia,
} from '../worker/lib/media-store';
import { isMediaRefObject, isMediaStorageValue, mediaRefUrl, parseMediaRef, serialiseMediaRef } from '../src/shared/media';

/** The store's env type references a Workers-only binding; tests never pass one. */
type StoreEnv = Parameters<typeof putMedia>[0];

function prontoEnv(): StoreEnv {
  return { GETPRONTO_API_KEY: 'pronto_sk_test_key' } as unknown as StoreEnv;
}

const FILE_URL = 'https://cdn.getpronto.io/user-1/cover-abc.png';
const FILE_ID = '123e4567-e89b-12d3-a456-426614174000';

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('media references', () => {
  it('treats a bare value as the legacy bucket key', () => {
    const ref = parseMediaRef('artwork/game-1/shot-1.png');
    expect(ref).toEqual({ provider: 'r2', key: 'artwork/game-1/shot-1.png' });
    expect(mediaRefUrl('artwork/game-1/shot-1.png')).toBeNull();
  });

  it('round-trips a Get Pronto reference', () => {
    const stored = serialiseMediaRef({ provider: 'getpronto', id: FILE_ID, url: FILE_URL });
    expect(isMediaRefObject(stored)).toBe(true);
    expect(parseMediaRef(stored)).toEqual({ provider: 'getpronto', id: FILE_ID, url: FILE_URL });
    expect(mediaRefUrl(stored)).toBe(FILE_URL);
  });

  it('refuses a reference whose address is not on a Get Pronto host', () => {
    const offHost = JSON.stringify({ provider: 'getpronto', id: FILE_ID, url: 'https://evil.example/x.png' });
    expect(isMediaRefObject(offHost)).toBe(false);
    // Still readable, but as an opaque key: it can never become an <img src>.
    expect(parseMediaRef(offHost)).toEqual({ provider: 'r2', key: offHost });
  });

  it('refuses plain http and malformed JSON', () => {
    expect(isMediaRefObject(JSON.stringify({ provider: 'getpronto', id: FILE_ID, url: 'http://cdn.getpronto.io/x.png' }))).toBe(false);
    expect(isMediaRefObject('{"provider":"getpronto"')).toBe(false);
  });

  it('keeps a field-specific prefix rule for legacy keys', () => {
    expect(isMediaStorageValue('content/avatar/a.png', 'content/avatar/')).toBe(true);
    expect(isMediaStorageValue('artwork/a/b.png', 'content/avatar/')).toBe(false);
    expect(isMediaStorageValue('content/avatar/../../secret', 'content/avatar/')).toBe(false);
    // A reference object carries no prefix, so it is accepted outright.
    expect(isMediaStorageValue(serialiseMediaRef({ provider: 'getpronto', id: FILE_ID, url: FILE_URL }), 'music/')).toBe(true);
  });
});

describe('provider selection', () => {
  it('uses Get Pronto when a secret key is present', () => {
    expect(mediaProvider(prontoEnv())).toBe('getpronto');
    expect(mediaLimitBytes(prontoEnv())).toBe(10 * 1024 * 1024);
  });

  it('falls back to the local bucket, and to nothing at all', () => {
    const bucket = { put: vi.fn(), delete: vi.fn(), head: vi.fn() };
    expect(mediaProvider({ FILES: bucket } as unknown as StoreEnv)).toBe('r2');
    expect(mediaProvider({})).toBeNull();
    expect(mediaLimitBytes({} as StoreEnv)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('Get Pronto upload', () => {
  it('presigns, uploads the bytes, confirms, and returns the delivery address', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit = {}) => {
        calls.push({ url, init });
        if (url.endsWith('/upload/presign')) {
          return jsonResponse({ uploadUrl: 'https://storage.example/presigned-put', pendingUploadId: 'pending-1', expiresIn: 3600 });
        }
        if (url === 'https://storage.example/presigned-put') return new Response(null, { status: 200 });
        if (url.endsWith('/upload/confirm')) {
          return jsonResponse({
            message: 'File uploaded successfully',
            file: {
              id: FILE_ID,
              name: 'cover-abc.png',
              secureUrl: `https://api.getpronto.io/v1/file/user-1/cover-abc.png`,
              rawUrl: FILE_URL,
              type: 'image',
              rawType: 'image/png',
              rawSize: png.byteLength,
            },
          });
        }
        return new Response('unexpected', { status: 500 });
      }),
    );

    const ref = await putMedia(prontoEnv(), {
      bytes: png,
      contentType: 'image/png',
      key: 'artwork/game-1/cover-abc.png',
      filename: 'cover-abc.png',
    });

    // The CDN address wins over the API's own delivery URL.
    expect(ref).toEqual({ provider: 'getpronto', id: FILE_ID, url: FILE_URL });
    expect(calls).toHaveLength(3);

    const [presign, upload, confirm] = calls;
    expect(presign.url).toBe('https://api.getpronto.io/v1/upload/presign');
    expect((presign.init.headers as Record<string, string>).Authorization).toBe('ApiKey pronto_sk_test_key');
    expect(JSON.parse(String(presign.init.body))).toEqual({
      filename: 'cover-abc.png',
      mimetype: 'image/png',
      size: png.byteLength,
    });

    expect(upload.url).toBe('https://storage.example/presigned-put');
    expect(upload.init.method).toBe('PUT');
    expect((upload.init.headers as Record<string, string>)['Content-Type']).toBe('image/png');
    const body = upload.init.body as Blob;
    expect(body.size).toBe(png.byteLength);
    expect(body.type).toBe('image/png');
    expect(new Uint8Array(await body.arrayBuffer())).toEqual(png);

    expect(confirm.url).toBe('https://api.getpronto.io/v1/upload/confirm');
    expect(JSON.parse(String(confirm.init.body))).toEqual({ pendingUploadId: 'pending-1' });
  });

  it('stops an image over the free-plan limit before uploading anything', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    await expect(
      putMedia(prontoEnv(), {
        bytes: new Uint8Array(10 * 1024 * 1024 + 1),
        contentType: 'image/png',
        key: 'artwork/g/x.png',
        filename: 'x.png',
      }),
    ).rejects.toMatchObject({ code: 'too_large' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('reports a refused key and a rate limit as their own failures', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 401 })));
    await expect(
      putMedia(prontoEnv(), { bytes: png, contentType: 'image/png', key: 'a/b.png', filename: 'b.png' }),
    ).rejects.toMatchObject({ code: 'rejected' });

    vi.stubGlobal('fetch', vi.fn(async () => new Response('slow down', { status: 429 })));
    await expect(
      putMedia(prontoEnv(), { bytes: png, contentType: 'image/png', key: 'a/b.png', filename: 'b.png' }),
    ).rejects.toMatchObject({ code: 'rate_limited' });
  });

  it('refuses a confirmation that points somewhere else', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/upload/presign')) return jsonResponse({ uploadUrl: 'https://storage.example/put', pendingUploadId: 'p' });
        if (url === 'https://storage.example/put') return new Response(null, { status: 200 });
        return jsonResponse({ file: { id: FILE_ID, rawUrl: 'https://evil.example/x.png', secureUrl: 'https://evil.example/y.png' } });
      }),
    );
    await expect(
      putMedia(prontoEnv(), { bytes: png, contentType: 'image/png', key: 'a/b.png', filename: 'b.png' }),
    ).rejects.toMatchObject({ code: 'upstream' });
  });

  it('says so plainly when no store is configured', async () => {
    vi.stubGlobal('fetch', vi.fn());
    await expect(
      putMedia({}, { bytes: png, contentType: 'image/png', key: 'a/b.png', filename: 'b.png' }),
    ).rejects.toBeInstanceOf(MediaStoreError);
    await expect(
      putMedia({}, { bytes: png, contentType: 'image/png', key: 'a/b.png', filename: 'b.png' }),
    ).rejects.toMatchObject({ code: 'unconfigured' });
  });
});

describe('delete and existence', () => {
  it('deletes by id, and treats an already-deleted file as done', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit = {}) => {
        calls.push({ url, init });
        return new Response(null, { status: 404 });
      }),
    );
    const stored = serialiseMediaRef({ provider: 'getpronto', id: FILE_ID, url: FILE_URL });
    await expect(deleteMedia(prontoEnv(), stored)).resolves.toBe(true);
    expect(calls[0].url).toBe(`https://api.getpronto.io/v1/files/${FILE_ID}`);
    expect(calls[0].init.method).toBe('DELETE');
  });

  it('never throws when a delete fails, or when there is nothing to delete', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 500 })));
    const stored = serialiseMediaRef({ provider: 'getpronto', id: FILE_ID, url: FILE_URL });
    await expect(deleteMedia(prontoEnv(), stored)).resolves.toBe(false);
    await expect(deleteMedia(prontoEnv(), null)).resolves.toBe(false);
  });

  it('reports a missing object, and keeps the music playing through a blip', async () => {
    const stored = serialiseMediaRef({ provider: 'getpronto', id: FILE_ID, url: FILE_URL });

    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })));
    await expect(mediaExists(prontoEnv(), stored)).resolves.toBe(false);

    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 200 })));
    await expect(mediaExists(prontoEnv(), stored)).resolves.toBe(true);

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      }),
    );
    await expect(mediaExists(prontoEnv(), stored)).resolves.toBe(true);
  });
});
