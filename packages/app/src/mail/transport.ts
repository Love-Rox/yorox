/**
 * メールトランスポートの抽象化(docs/MAIL.md)。
 *
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

  if (env.MAIL_TRANSPORT === 'smtp' && env.SMTP_HOST) {
    const port = Number.parseInt(env.SMTP_PORT ?? '587', 10);
    return new SmtpTransport(
      {
        host: env.SMTP_HOST,
        port,
        username: env.SMTP_USERNAME,
        password: env.SMTP_PASSWORD,
        secure: env.SMTP_SECURE === '1' || port === 465,
        startTls: env.SMTP_START_TLS !== '0' && port !== 465,
      },
      from,
    );
  }

  if (env.RESEND_API_KEY) {
    return new ResendTransport(env.RESEND_API_KEY, from);
  }

  return null;
}
