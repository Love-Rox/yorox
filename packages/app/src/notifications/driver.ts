/**
 * 通知ドライバのプラガブル IF(docs/DECISIONS.md「通知」)。
 * メール / Web Push / Webhook を同列に扱う。
 * メールは直接送らず送信キュー(mail_queue)に積み、Cron がレート制御しながら
 * トランスポート(Resend / SMTP)経由で送る(docs/MAIL.md)。
 */
import type { Db } from '../db/client';
import { enqueueMail } from '../mail/queue';

export interface Notification {
  /** 宛先アクター ID */
  actorId: string;
  /** 宛先メールアドレス(メールドライバ用。解決済みで渡す) */
  email?: string;
  subject: string;
  bodyText: string;
  /** 由来のドメインイベント種別(例: 'participation.accepted') */
  eventType: string;
}

export interface NotificationDriver {
  readonly name: string;
  send(notification: Notification): Promise<void>;
}

/** 開発・テスト用: コンソールに書くだけのドライバ */
export class ConsoleDriver implements NotificationDriver {
  readonly name = 'console';
  async send(n: Notification): Promise<void> {
    console.log(`[notification] to=${n.actorId} (${n.email ?? 'no-email'}) [${n.eventType}] ${n.subject}\n${n.bodyText}`);
  }
}

/** メール通知を送信キューに積むドライバ(実送信は Cron のキュー処理が行う) */
export class QueueEmailDriver implements NotificationDriver {
  readonly name = 'queue-email';

  constructor(private readonly db: Db) {}

  async send(n: Notification): Promise<void> {
    if (!n.email) return; // メールアドレス未解決の宛先はスキップ
    await enqueueMail(this.db, {
      to: n.email,
      subject: n.subject,
      bodyText: n.bodyText,
    });
  }
}
