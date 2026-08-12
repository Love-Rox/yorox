/**
 * Discord 通知ドライバ(個人宛)。
 * - Bot からの DM: Discord 連携済み かつ 本人が DM 通知を有効にしている場合
 *   (DISCORD_BOT_TOKEN 未設定なら送らない)
 * - 個人 Webhook: 本人が設定していれば、そのチャンネルにも同じ内容を送る
 *
 * 注意: Discord の仕様上、Bot と共通のサーバーに所属していないユーザーには
 * DM を送れない。その場合は静かに諦める(メール通知が別途届く)。
 */
import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { schema } from '../db/client';
import { sendDiscordDm, sendDiscordWebhook } from '../lib/discord';
import type { Notification, NotificationDriver } from './driver';

export class DiscordDmDriver implements NotificationDriver {
  readonly name = 'discord';

  constructor(
    private readonly db: Db,
    private readonly botToken?: string | undefined,
  ) {}

  async send(n: Notification): Promise<void> {
    const user = await this.db.query.users.findFirst({
      where: eq(schema.users.actorId, n.actorId),
    });
    if (!user) return;

    const content = `**${n.subject}**\n${n.bodyText}`;

    // 1) Bot からの DM(この種別で DM チャンネルが有効なときのみ)
    if (this.botToken && n.allowDiscordDm) {
      const link = await this.db.query.oauthAccounts.findFirst({
        where: and(
          eq(schema.oauthAccounts.userActorId, n.actorId),
          eq(schema.oauthAccounts.provider, 'discord'),
        ),
      });
      if (link) await sendDiscordDm(this.botToken, link.providerUserId, content);
    }

    // 2) 個人の Webhook(URL 設定済み かつ この種別で有効なとき)
    if (n.allowDiscordWebhook && user.discordWebhookUrl) {
      await sendDiscordWebhook(user.discordWebhookUrl, content);
    }
  }
}
