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
