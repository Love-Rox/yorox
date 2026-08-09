/**
 * メールトランスポートの抽象化(docs/MAIL.md)。
 *
 * - cloudflare: Cloudflare Email Service(send_email バインディング、API キー不要)
 * - resend: Resend の HTTP API
 * - smtp: worker-mailer(cloudflare:sockets)。Gmail は smtp.gmail.com:587 +
 *   アプリパスワードでこのトランスポートをそのまま使える
 * - 将来: Gmail API(OAuth)トランスポート / Docker 版は nodemailer 実装を
 *   同じ IF で差し替える
 */
export interface MailMessage {
  to: string;
  subject: string;
  bodyText: string;
}

export interface MailTransport {
  readonly name: string;
  send(message: MailMessage): Promise<void>;
  /**
   * まとめ送り(対応トランスポートのみ)。全件成功か例外かの単純なセマンティクス。
   * 失敗時は呼び出し側が全件を再試行対象にする。
   */
  sendBatch?(messages: MailMessage[]): Promise<void>;
}

export class ResendTransport implements MailTransport {
  readonly name = 'resend';

  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}

  async send(message: MailMessage): Promise<void> {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: this.from,
        to: [message.to],
        subject: message.subject,
        text: message.bodyText,
      }),
    });
    if (!res.ok) {
      throw new Error(`Resend API error: ${res.status} ${await res.text()}`);
    }
  }

  /** Resend Batch API(1リクエスト最大100通)でまとめ送りする */
  async sendBatch(messages: MailMessage[]): Promise<void> {
    for (let i = 0; i < messages.length; i += 100) {
      const chunk = messages.slice(i, i + 100);
      const res = await fetch('https://api.resend.com/emails/batch', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(
          chunk.map((m) => ({
            from: this.from,
            to: [m.to],
            subject: m.subject,
            text: m.bodyText,
          })),
        ),
      });
      if (!res.ok) {
        throw new Error(`Resend batch API error: ${res.status} ${await res.text()}`);
      }
    }
  }
}

/** "Yorox <noreply@example.com>" 形式を分解する */
export function parseFrom(from: string): { email: string; name?: string } {
  const m = /^(.*)<([^>]+)>\s*$/.exec(from);
  if (m) {
    const name = m[1]!.trim().replace(/^"|"$/g, '');
    return name ? { email: m[2]!.trim(), name } : { email: m[2]!.trim() };
  }
  return { email: from.trim() };
}

/**
 * Cloudflare Email Service(send_email バインディング)。
 * ドメインを `wrangler email sending enable <domain>` で有効化しておくこと。
 */
export class CloudflareEmailTransport implements MailTransport {
  readonly name = 'cloudflare';

  constructor(
    private readonly binding: SendEmail,
    private readonly from: string,
  ) {}

  async send(message: MailMessage): Promise<void> {
    const from = parseFrom(this.from);
    const builder: EmailMessageBuilder = {
      to: message.to,
      from: from.name ? { email: from.email, name: from.name } : from.email,
      subject: message.subject,
      text: message.bodyText,
    };
    await this.binding.send(builder);
  }
}

export interface SmtpConfig {
  host: string;
  port: number;
  username?: string | undefined;
  password?: string | undefined;
  /** 465(implicit TLS)なら true。587 は startTls を使う */
  secure: boolean;
  startTls: boolean;
}

export class SmtpTransport implements MailTransport {
  readonly name = 'smtp';

  constructor(
    private readonly config: SmtpConfig,
    private readonly from: string,
  ) {}

  async send(message: MailMessage): Promise<void> {
    // worker-mailer はトップレベルで cloudflare:sockets を import するため、
    // SSG(Node)で評価されないよう送信時にロードする
    const { WorkerMailer } = await import('worker-mailer');
    await WorkerMailer.send(
      {
        host: this.config.host,
        port: this.config.port,
        secure: this.config.secure,
        startTls: this.config.startTls,
        ...(this.config.username && this.config.password
          ? {
              credentials: {
                username: this.config.username,
                password: this.config.password,
              },
            }
          : {}),
      },
      {
        from: this.from,
        to: message.to,
        subject: message.subject,
        text: message.bodyText,
      },
    );
  }
}


/** Node(Docker)ランタイム用 SMTP 実装(nodemailer)。ビルド時に選択される */
export class NodeSmtpTransport implements MailTransport {
  readonly name = 'smtp-node';

  constructor(
    private readonly config: SmtpConfig,
    private readonly from: string,
  ) {}

  async send(message: MailMessage): Promise<void> {
    // Node ビルドでのみ実行される(vite にはバンドルさせない)
    const nodemailer = (await import(/* @vite-ignore */ 'nodemailer')) as
      typeof import('nodemailer');
    const transporter = nodemailer.createTransport({
      host: this.config.host,
      port: this.config.port,
      secure: this.config.secure,
      ...(this.config.username && this.config.password
        ? { auth: { user: this.config.username, pass: this.config.password } }
        : {}),
    });
    await transporter.sendMail({
      from: this.from,
      to: message.to,
      subject: message.subject,
      text: message.bodyText,
    });
  }
}

/**
 * 環境変数からトランスポートを構築する。未設定なら null(コンソールのみで動く)。
 *
 * MAIL_TRANSPORT=resend: RESEND_API_KEY + MAIL_FROM
 * MAIL_TRANSPORT=smtp:   SMTP_HOST (+ SMTP_PORT / SMTP_USERNAME / SMTP_PASSWORD /
 *                        SMTP_SECURE / SMTP_START_TLS) + MAIL_FROM
 */
export function createTransportFromEnv(env: Env): MailTransport | null {
  const from = env.MAIL_FROM;
  if (!from) return null;

  if (env.MAIL_TRANSPORT === 'cloudflare' && env.EMAIL) {
    return new CloudflareEmailTransport(env.EMAIL, from);
  }

  if (env.MAIL_TRANSPORT === 'smtp' && env.SMTP_HOST) {
    const port = Number.parseInt(env.SMTP_PORT ?? '587', 10);
    const config = {
      host: env.SMTP_HOST,
      port,
      username: env.SMTP_USERNAME,
      password: env.SMTP_PASSWORD,
      secure: env.SMTP_SECURE === '1' || port === 465,
      startTls: env.SMTP_START_TLS !== '0' && port !== 465,
    };
    // Node(Docker)ビルドでは nodemailer、Workers では worker-mailer
    return __YOROX_TARGET__ === 'node'
      ? new NodeSmtpTransport(config, from)
      : new SmtpTransport(config, from);
  }

  if (env.RESEND_API_KEY) {
    return new ResendTransport(env.RESEND_API_KEY, from);
  }

  return null;
}
