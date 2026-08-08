/**
 * AP 文書(アクター・オブジェクト)のビルダー。
 * Mastodon / Misskey が解決できる最小構成を満たす。
 */
import { AS_CONTEXT, SECURITY_CONTEXT } from './constants';
import type { ApActor, ApCollection, ApEvent, ApObject } from './types';

export interface GroupActorInput {
  /** 正規アクター URI(https://host/groups/{ulid}) */
  uri: string;
  handle: string;
  name: string;
  summary?: string | undefined;
  iconUrl?: string | undefined;
  /** 人間向けプロフィール URL */
  url?: string | undefined;
  publicKeyPem?: string | undefined;
  published?: string | undefined;
}

/** グループの Group アクター文書 */
export function buildGroupActor(input: GroupActorInput): ApActor {
  const actor: ApActor = {
    '@context': [AS_CONTEXT, SECURITY_CONTEXT],
    id: input.uri,
    type: 'Group',
    preferredUsername: input.handle,
    name: input.name,
    inbox: `${input.uri}/inbox`,
    outbox: `${input.uri}/outbox`,
    followers: `${input.uri}/followers`,
  };
  if (input.summary) actor.summary = input.summary;
  if (input.url) actor.url = input.url;
  if (input.published) actor.published = input.published;
  if (input.iconUrl) {
    actor.icon = { type: 'Image', url: input.iconUrl };
  }
  if (input.publicKeyPem) {
    actor.publicKey = {
      id: `${input.uri}#main-key`,
      owner: input.uri,
      publicKeyPem: input.publicKeyPem,
    };
  }
  return actor;
}

export interface EventObjectInput {
  /** 正規オブジェクト URI(https://host/events/{ulid}) */
  uri: string;
  name: string;
  /** 主催グループのアクター URI */
  attributedTo: string;
  contentHtml?: string | undefined;
  startTime: string;
  endTime?: string | undefined;
  /** 会場名(あれば Place として載せる) */
  locationName?: string | undefined;
  locationAddress?: string | undefined;
  latitude?: number | undefined;
  longitude?: number | undefined;
  /** 人間向けイベントページ URL */
  url?: string | undefined;
  imageUrl?: string | undefined;
  published?: string | undefined;
}

/** イベントの AS2 Event オブジェクト(Mobilizon 互換を意識した最小形) */
export function buildEventObject(input: EventObjectInput): ApEvent {
  const event: ApEvent = {
    '@context': AS_CONTEXT,
    id: input.uri,
    type: 'Event',
    name: input.name,
    attributedTo: input.attributedTo,
    startTime: input.startTime,
    to: ['https://www.w3.org/ns/activitystreams#Public'],
  };
  if (input.endTime) event.endTime = input.endTime;
  if (input.contentHtml) {
    event.content = input.contentHtml;
    event.mediaType = 'text/html';
  }
  if (input.url) event.url = input.url;
  if (input.published) event.published = input.published;
  if (input.imageUrl) {
    event.attachment = [{ type: 'Image', url: input.imageUrl }];
  }
  if (input.locationName || input.locationAddress) {
    const location: Record<string, unknown> = {
      type: 'Place',
      name: input.locationName ?? input.locationAddress,
    };
    if (input.locationAddress) location.address = input.locationAddress;
    if (input.latitude != null && input.longitude != null) {
      location.latitude = input.latitude;
      location.longitude = input.longitude;
    }
    event.location = location as unknown as ApObject;
  }
  return event;
}

/** 空の outbox(OrderedCollection)。配信実装までのスタブ */
export function buildEmptyOutbox(uri: string): ApCollection {
  return {
    '@context': AS_CONTEXT,
    id: uri,
    type: 'OrderedCollection',
    totalItems: 0,
    orderedItems: [],
  };
}

/**
 * OrderedCollection(followers など)。
 * items 省略時は件数のみ公開する(フォロワー一覧の列挙を避ける Mastodon 互換挙動)。
 */
export function buildOrderedCollection(
  uri: string,
  totalItems: number,
  orderedItems?: string[],
): ApCollection {
  const collection: ApCollection = {
    '@context': AS_CONTEXT,
    id: uri,
    type: 'OrderedCollection',
    totalItems,
  };
  if (orderedItems) collection.orderedItems = orderedItems;
  return collection;
}
