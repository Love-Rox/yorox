import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApActor } from '@yorox/ap';
import { fetchRemoteActor } from './remote-actor';

vi.stubGlobal('__YOROX_VERSION__', 'test');

function actor(id: string, keyOwner = id): ApActor {
  return {
    id,
    type: 'Person',
    inbox: `${id}/inbox`,
    outbox: `${id}/outbox`,
    publicKey: { id: `${keyOwner}#main-key`, owner: keyOwner, publicKeyPem: 'PEM' },
  };
}

/** URL → 返す文書 の対応で fetch を差し替える */
function serve(docs: Record<string, ApActor>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const doc = docs[url];
      return doc ? new Response(JSON.stringify(doc)) : new Response('not found', { status: 404 });
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.stubGlobal('__YOROX_VERSION__', 'test');
});

describe('fetchRemoteActor', () => {
  it('取得先と id が一致する文書はそのまま返す', async () => {
    const victim = 'https://mastodon.example/users/alice';
    serve({ [victim]: actor(victim) });
    expect((await fetchRemoteActor(victim))?.id).toBe(victim);
  });

  it('他人の id を主張する文書は、本人の id から取り直した文書に置き換える', async () => {
    const victim = 'https://mastodon.example/users/alice';
    const forged = { ...actor(victim), inbox: 'https://evil.example/inbox' };
    serve({ 'https://evil.example/actor': forged, [victim]: actor(victim) });
    const doc = await fetchRemoteActor('https://evil.example/actor');
    expect(doc?.inbox).toBe(`${victim}/inbox`);
  });

  it('id の取り直しで別の id が返れば拒否する', async () => {
    const victim = 'https://mastodon.example/users/alice';
    serve({
      'https://evil.example/actor': actor(victim),
      [victim]: actor('https://mastodon.example/users/bob'),
    });
    expect(await fetchRemoteActor('https://evil.example/actor')).toBeNull();
  });

  it('鍵の owner が別アクターなら拒否する', async () => {
    const id = 'https://evil.example/users/eve';
    serve({ [id]: actor(id, 'https://mastodon.example/users/alice') });
    expect(await fetchRemoteActor(id)).toBeNull();
  });
});

describe('fetchRemoteActor: publicKey の形の揺れ', () => {
  const id = 'https://ap.example/users/carol';
  const key = (n: string) => ({ id: `${id}#${n}`, owner: id, publicKeyPem: `PEM-${n}` });

  it('配列の publicKey から本人の鍵を選ぶ(優先 keyId があればそれ)', async () => {
    serve({ [id]: { ...actor(id), publicKey: [key('a'), key('b')] as never } });
    expect((await fetchRemoteActor(id))?.publicKey?.publicKeyPem).toBe('PEM-a');
    expect((await fetchRemoteActor(id, undefined, `${id}#b`))?.publicKey?.publicKeyPem).toBe('PEM-b');
  });

  it('id の無い鍵も owner が本人なら受け付ける', async () => {
    serve({ [id]: { ...actor(id), publicKey: { owner: id, publicKeyPem: 'PEM' } as never } });
    expect((await fetchRemoteActor(id))?.publicKey?.publicKeyPem).toBe('PEM');
  });
});
