/**
 * 監査ログ。管理・モデレーション操作の証跡を残す。
 *
 * - グループ単位: groupActorId を付けて記録。グループ管理者(member.manage)が閲覧
 * - インスタンス全体: サイト管理者(SITE_ADMIN_HANDLES)が全件閲覧
 *
 * 記録の失敗が本処理を壊さないよう、recordAudit は例外を飲み込む。
 */
import { and, desc, eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { schema } from '../db/client';
import { ulid } from '../lib/ulid';

export interface AuditInput {
  /** 操作者。自動処理は null */
  actorId?: string | null;
  /** 例: 'member.add' / 'block.add' / 'payment.refund' */
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  /** グループ単位のスコープ(null = インスタンス全体) */
  groupActorId?: string | null;
  metadata?: Record<string, unknown> | null;
}

/** 監査ログを1件記録する(失敗しても本処理は継続) */
export async function recordAudit(
  db: Db,
  input: AuditInput,
  now: Date = new Date(),
): Promise<void> {
  try {
    await db.insert(schema.auditLogs).values({
      id: ulid(),
      actorId: input.actorId ?? null,
      action: input.action,
      targetType: input.targetType ?? null,
      targetId: input.targetId ?? null,
      groupActorId: input.groupActorId ?? null,
      metadata: input.metadata ?? null,
      createdAt: now,
    });
  } catch (err) {
    console.error('[audit] 記録に失敗:', err);
  }
}

/** 操作の日本語ラベル(UI 表示用) */
export const AUDIT_LABELS: Record<string, string> = {
  'member.add': 'メンバー追加',
  'member.remove': 'メンバー削除',
  'member.role': 'ロール変更',
  'role.create': 'ロール作成',
  'role.update': 'ロールを編集',
  'role.delete': 'ロール削除',
  'block.add': '参加者をブロック',
  'block.remove': 'ブロック解除',
  'group.create': 'グループ作成',
  'group.settings': 'グループ設定の変更',
  'group.stripe.connect': 'Stripe 連携',
  'group.stripe.disconnect': 'Stripe 連携解除',
  'event.create': 'イベント作成',
  'event.publish': 'イベント公開',
  'event.duplicate': 'イベント複製',
  'event.cancel': 'イベント中止',
  'event.uncancel': 'イベント中止の取り消し',
  'post.create': 'お知らせ投稿',
  'post.delete': 'お知らせ削除',
  'event.manager.add': 'イベント管理者を追加',
  'event.manager.remove': 'イベント管理者を削除',
  'participation.decide': '参加可否の決定',
  'attendance.record': '出欠の記録',
  'payment.mark': '支払い状態の更新',
  'slot.update': '枠を編集',
  'slot.delete': '枠を削除',
  'lottery.run': '抽選の実行',
  'account.delete': 'アカウント削除(退会)',
};

export function auditLabel(action: string): string {
  return AUDIT_LABELS[action] ?? action;
}

export interface AuditRow {
  id: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  groupActorId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  actorHandle: string | null;
  actorName: string | null;
}

/** グループの監査ログ(新しい順) */
export async function listGroupAudit(
  db: Db,
  groupActorId: string,
  limit = 100,
): Promise<AuditRow[]> {
  return db
    .select({
      id: schema.auditLogs.id,
      action: schema.auditLogs.action,
      targetType: schema.auditLogs.targetType,
      targetId: schema.auditLogs.targetId,
      groupActorId: schema.auditLogs.groupActorId,
      metadata: schema.auditLogs.metadata,
      createdAt: schema.auditLogs.createdAt,
      actorHandle: schema.actors.handle,
      actorName: schema.actors.displayName,
    })
    .from(schema.auditLogs)
    .leftJoin(schema.actors, eq(schema.auditLogs.actorId, schema.actors.id))
    .where(eq(schema.auditLogs.groupActorId, groupActorId))
    .orderBy(desc(schema.auditLogs.createdAt))
    .limit(limit);
}

/** インスタンス全体の監査ログ(新しい順)。サイト管理者向け */
export async function listAllAudit(db: Db, limit = 200): Promise<AuditRow[]> {
  return db
    .select({
      id: schema.auditLogs.id,
      action: schema.auditLogs.action,
      targetType: schema.auditLogs.targetType,
      targetId: schema.auditLogs.targetId,
      groupActorId: schema.auditLogs.groupActorId,
      metadata: schema.auditLogs.metadata,
      createdAt: schema.auditLogs.createdAt,
      actorHandle: schema.actors.handle,
      actorName: schema.actors.displayName,
    })
    .from(schema.auditLogs)
    .leftJoin(schema.actors, eq(schema.auditLogs.actorId, schema.actors.id))
    .orderBy(desc(schema.auditLogs.createdAt))
    .limit(limit);
}

/**
 * サイト管理者か判定する。
 * env の SITE_ADMIN_HANDLES(カンマ区切りのローカル handle)で指定する。
 */
export async function isSiteAdmin(db: Db, actorId: string | null): Promise<boolean> {
  if (!actorId) return false;
  const env = (await import('cloudflare:workers')).env as Env;
  const handles = (env.SITE_ADMIN_HANDLES ?? '')
    .split(',')
    .map((h) => h.trim().replace(/^@/, '').toLowerCase())
    .filter(Boolean);
  if (handles.length === 0) return false;
  const actor = await db.query.actors.findFirst({
    where: and(eq(schema.actors.id, actorId), eq(schema.actors.kind, 'user')),
  });
  return !!actor?.handle && handles.includes(actor.handle.toLowerCase());
}
