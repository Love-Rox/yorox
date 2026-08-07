import { AS_CONTEXT } from './constants';
import type { ApActivity, ApObject, ObjectOrUri } from './types';

/**
 * アクティビティのビルダー群。
 *
 * Yorox の参加フローの AP 写像(docs/DECISIONS.md):
 * - 抽選枠への Join → TentativeAccept(抽選待ち)→ 当選で Accept
 * - 補欠は TentativeAccept を維持し、繰上時に Accept
 * - 先着枠は Join に即 Accept(参加条件ゲートで防衛)
 * - 参加条件を満たさない Join には理由付き Reject(summary に人間可読の説明)
 */

interface ActivityInit {
  /** アクティビティ自身の id(配信するなら必須) */
  id?: string;
  to?: string | string[];
  cc?: string | string[];
  published?: string;
}

function baseActivity(
  type: ApActivity['type'],
  actor: string,
  object: ObjectOrUri | ObjectOrUri[],
  init: ActivityInit = {},
): ApActivity {
  const activity: ApActivity = {
    '@context': AS_CONTEXT,
    type,
    actor,
    object,
  };
  if (init.id !== undefined) activity.id = init.id;
  if (init.to !== undefined) activity.to = Array.isArray(init.to) ? init.to : [init.to];
  if (init.cc !== undefined) activity.cc = Array.isArray(init.cc) ? init.cc : [init.cc];
  if (init.published !== undefined) activity.published = init.published;
  return activity;
}

/** 参加申込 */
export function join(actor: string, event: ObjectOrUri, init?: ActivityInit): ApActivity {
  return baseActivity('Join', actor, event, init);
}

/** 参加確定(先着即時 / 抽選当選 / 繰上確定) */
export function accept(actor: string, object: ObjectOrUri, init?: ActivityInit): ApActivity {
  return baseActivity('Accept', actor, object, init);
}

/** 抽選待ち・補欠状態の明示 */
export function tentativeAccept(
  actor: string,
  object: ObjectOrUri,
  init?: ActivityInit,
): ApActivity {
  return baseActivity('TentativeAccept', actor, object, init);
}

/**
 * 参加拒否。
 * @param reason 人間可読の理由。summary に載せる(例: 「参加条件を満たしていません: アカウント作成から30日以上が必要です」)
 */
export function reject(
  actor: string,
  object: ObjectOrUri,
  reason?: string,
  init?: ActivityInit,
): ApActivity {
  const activity = baseActivity('Reject', actor, object, init);
  if (reason !== undefined) activity.summary = reason;
  return activity;
}

/** キャンセル(Join の取り消し) */
export function undo(actor: string, object: ObjectOrUri, init?: ActivityInit): ApActivity {
  return baseActivity('Undo', actor, object, init);
}

/** オブジェクト作成の配信(公開イベントの Create など) */
export function create(actor: string, object: ApObject, init?: ActivityInit): ApActivity {
  return baseActivity('Create', actor, object, init);
}

export function update(actor: string, object: ApObject, init?: ActivityInit): ApActivity {
  return baseActivity('Update', actor, object, init);
}

export function deleteActivity(
  actor: string,
  object: ObjectOrUri,
  init?: ActivityInit,
): ApActivity {
  return baseActivity('Delete', actor, object, init);
}

/** コレクションへの追加(開催後の資料公開など) */
export function add(
  actor: string,
  object: ObjectOrUri,
  target: ObjectOrUri,
  init?: ActivityInit,
): ApActivity {
  const activity = baseActivity('Add', actor, object, init);
  activity.target = target;
  return activity;
}

/** アカウント移行(エイリアス統合) */
export function move(
  actor: string,
  object: ObjectOrUri,
  target: ObjectOrUri,
  init?: ActivityInit,
): ApActivity {
  const activity = baseActivity('Move', actor, object, init);
  activity.target = target;
  return activity;
}

/** 通報 */
export function flag(
  actor: string,
  object: ObjectOrUri | ObjectOrUri[],
  reason?: string,
  init?: ActivityInit,
): ApActivity {
  const activity = baseActivity('Flag', actor, object, init);
  if (reason !== undefined) activity.content = reason;
  return activity;
}
