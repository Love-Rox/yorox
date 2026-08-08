import { describe, expect, it } from 'vitest';
import { activities, acceptsActivityPub, actorJrd, parseAcct } from './index';

describe('parseAcct', () => {
  it('acct:user@host をパースする', () => {
    expect(parseAcct('acct:alice@yorox.example')).toEqual({
      user: 'alice',
      host: 'yorox.example',
    });
  });

  it('ポート付きホストも扱える', () => {
    expect(parseAcct('acct:alice@localhost:8799')).toEqual({
      user: 'alice',
      host: 'localhost:8799',
    });
  });

  it('acct 以外は null', () => {
    expect(parseAcct('https://yorox.example/users/alice')).toBeNull();
    expect(parseAcct('acct:noathost')).toBeNull();
  });
});

describe('actorJrd', () => {
  it('self リンクと profile-page リンクを生成する', () => {
    const jrd = actorJrd({
      handle: 'kyoto-tech',
      host: 'yorox.example',
      actorUri: 'https://yorox.example/groups/01ABC',
      profileUrl: 'https://yorox.example/g/kyoto-tech',
    });
    expect(jrd.subject).toBe('acct:kyoto-tech@yorox.example');
    expect(jrd.links).toContainEqual({
      rel: 'self',
      type: 'application/activity+json',
      href: 'https://yorox.example/groups/01ABC',
    });
    expect(jrd.links).toContainEqual({
      rel: 'http://webfinger.net/rel/profile-page',
      type: 'text/html',
      href: 'https://yorox.example/g/kyoto-tech',
    });
  });
});

describe('acceptsActivityPub', () => {
  it('activity+json を受理する', () => {
    expect(acceptsActivityPub('application/activity+json')).toBe(true);
    expect(
      acceptsActivityPub(
        'application/ld+json; profile="https://www.w3.org/ns/activitystreams"',
      ),
    ).toBe(true);
  });
  it('text/html は拒否する', () => {
    expect(acceptsActivityPub('text/html,application/xhtml+xml')).toBe(false);
    expect(acceptsActivityPub(null)).toBe(false);
  });
});

describe('activities', () => {
  it('join は @context と actor/object を持つ', () => {
    const a = activities.join('https://a.example/users/1', 'https://b.example/events/2');
    expect(a['@context']).toBe('https://www.w3.org/ns/activitystreams');
    expect(a.type).toBe('Join');
    expect(a.actor).toBe('https://a.example/users/1');
    expect(a.object).toBe('https://b.example/events/2');
  });

  it('reject は理由を summary に載せる', () => {
    const a = activities.reject(
      'https://b.example/events/2',
      'https://a.example/users/1',
      '参加条件を満たしていません',
    );
    expect(a.type).toBe('Reject');
    expect(a.summary).toBe('参加条件を満たしていません');
  });

  it('move は target を持つ', () => {
    const a = activities.move(
      'https://a.example/users/1',
      'https://a.example/users/1',
      'https://c.example/users/9',
    );
    expect(a.type).toBe('Move');
    expect(a.target).toBe('https://c.example/users/9');
  });

  it('to/cc は配列に正規化される', () => {
    const a = activities.accept('https://x', 'https://y', {
      to: 'https://www.w3.org/ns/activitystreams#Public',
    });
    expect(a.to).toEqual(['https://www.w3.org/ns/activitystreams#Public']);
  });
});

describe('buildGroupActor', () => {
  it('Mastodon が解決できる最小構成を満たす', async () => {
    const { buildGroupActor } = await import('./documents');
    const actor = buildGroupActor({
      uri: 'https://yorox.example/groups/01ABC',
      handle: 'kyoto-tech',
      name: 'Kyoto Tech Meetup',
      summary: '京都の技術コミュニティ',
      url: 'https://yorox.example/g/kyoto-tech',
      publicKeyPem: '-----BEGIN PUBLIC KEY-----\nAAA\n-----END PUBLIC KEY-----',
    });
    expect(actor.type).toBe('Group');
    expect(actor.preferredUsername).toBe('kyoto-tech');
    expect(actor.inbox).toBe('https://yorox.example/groups/01ABC/inbox');
    expect(actor.outbox).toBe('https://yorox.example/groups/01ABC/outbox');
    expect(actor.publicKey?.id).toBe('https://yorox.example/groups/01ABC#main-key');
    expect(actor.publicKey?.owner).toBe('https://yorox.example/groups/01ABC');
    expect(actor['@context']).toContain('https://w3id.org/security/v1');
  });
});

describe('buildEventObject', () => {
  it('Event に Place と Public 宛先を持たせる', async () => {
    const { buildEventObject } = await import('./documents');
    const event = buildEventObject({
      uri: 'https://yorox.example/events/01DEF',
      name: '開発ミートアップ',
      attributedTo: 'https://yorox.example/groups/01ABC',
      startTime: '2026-08-28T10:00:00Z',
      endTime: '2026-08-28T12:00:00Z',
      locationName: '京都リサーチパーク',
      locationAddress: '京都市下京区',
      latitude: 34.99,
      longitude: 135.74,
      url: 'https://yorox.example/g/kyoto-tech/events/01DEF',
    });
    expect(event.type).toBe('Event');
    expect(event.to).toContain('https://www.w3.org/ns/activitystreams#Public');
    const loc = event.location as Record<string, unknown>;
    expect(loc.type).toBe('Place');
    expect(loc.latitude).toBe(34.99);
  });
});

describe('buildEmptyOutbox', () => {
  it('空の OrderedCollection を返す', async () => {
    const { buildEmptyOutbox } = await import('./documents');
    const outbox = buildEmptyOutbox('https://yorox.example/groups/01ABC/outbox');
    expect(outbox.type).toBe('OrderedCollection');
    expect(outbox.totalItems).toBe(0);
  });
});
