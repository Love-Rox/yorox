import { describe, expect, it } from 'vitest';
import type { ApActor } from '@yorox/ap';
import { actorLinksTo } from './claim';

const baseActor: ApActor = {
  id: 'https://misskey.example/users/abc',
  type: 'Person',
  inbox: 'https://misskey.example/users/abc/inbox',
  outbox: 'https://misskey.example/users/abc/outbox',
};

describe('actorLinksTo', () => {
  it('attachment の PropertyValue(HTML リンク)から検出する', () => {
    const actor: ApActor = {
      ...baseActor,
      attachment: [
        {
          type: 'PropertyValue',
          name: 'Yorox',
          value:
            '<a href="https://yorox.love-rox.cc/u/sasapiyo" rel="me nofollow noopener">yorox.love-rox.cc/u/sasapiyo</a>',
        },
      ],
    };
    expect(actorLinksTo(actor, ['https://yorox.love-rox.cc/u/sasapiyo'])).toBe(true);
  });

  it('alsoKnownAs から検出する', () => {
    const actor: ApActor = {
      ...baseActor,
      alsoKnownAs: ['https://yorox.love-rox.cc/u/sasapiyo'],
    };
    expect(
      actorLinksTo(actor, [
        'https://yorox.love-rox.cc/u/sasapiyo',
        'https://yorox.love-rox.cc/@sasapiyo',
      ]),
    ).toBe(true);
  });

  it('リンクが無ければ false', () => {
    expect(actorLinksTo(baseActor, ['https://yorox.love-rox.cc/u/sasapiyo'])).toBe(false);
    const other: ApActor = {
      ...baseActor,
      attachment: [{ type: 'PropertyValue', name: 'blog', value: 'https://blog.example' }],
    };
    expect(actorLinksTo(other, ['https://yorox.love-rox.cc/u/sasapiyo'])).toBe(false);
  });
});
