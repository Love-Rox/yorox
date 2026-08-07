/**
 * WebFinger (RFC 7033) の JRD 型とビルダー。
 */

export interface JrdLink {
  rel: string;
  type?: string;
  href?: string;
  template?: string;
}

export interface Jrd {
  subject: string;
  aliases?: string[];
  links?: JrdLink[];
}

/** `acct:user@example.com` 形式の resource をパースする */
export function parseAcct(resource: string): { user: string; host: string } | null {
  const match = /^acct:([^@]+)@(.+)$/.exec(resource);
  if (!match) return null;
  const user = match[1];
  const host = match[2];
  if (!user || !host) return null;
  return { user, host };
}

/** アクター用の JRD を組み立てる */
export function actorJrd(options: {
  handle: string;
  host: string;
  actorUri: string;
  profileUrl?: string;
}): Jrd {
  const links: JrdLink[] = [
    {
      rel: 'self',
      type: 'application/activity+json',
      href: options.actorUri,
    },
  ];
  if (options.profileUrl) {
    links.push({
      rel: 'http://webfinger.net/rel/profile-page',
      type: 'text/html',
      href: options.profileUrl,
    });
  }
  return {
    subject: `acct:${options.handle}@${options.host}`,
    aliases: [options.actorUri],
    links,
  };
}
