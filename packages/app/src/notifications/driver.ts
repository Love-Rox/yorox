/**
 * 通知ドライバのプラガブル IF(docs/DECISIONS.md「通知」)。
 * メール / Web Push / Webhook を同列に扱う。MVP はメール(Resend)+ 開発用コンソール。
 */

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

/**
 * Resend のメール送信 API を使うドライバ。
 * API キー未設定のときは構築時に例外(ディスパッチャ側で組み込みをスキップする)。
 */
export class ResendDriver implements NotificationDriver {
  readonly name = 'resend';

  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {
    if (!apiKey) throw new Error('RESEND_API_KEY is not set');
  }

  async send(n: Notification): Promise<void> {
    if (!n.email) return; // メールアドレス未解決の宛先はスキップ
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: this.from,
        to: [n.email],
        subject: n.subject,
        text: n.bodyText,
      }),
    });
    if (!res.ok) {
      throw new Error(`Resend API error: ${res.status} ${await res.text()}`);
    }
  }
}
