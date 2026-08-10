import { Link } from 'waku';
import { unstable_getRequest as getRequest } from 'waku/router/server';
import { eq } from 'drizzle-orm';
import { Avatar } from '../../components/avatar';
import { HelpTip } from '../../components/help-tip';
import { LoginRequired } from '../../components/login-required';
import { schema } from '../../db/client';
import { getCurrentUser } from '../../server/current-user';
import { enabledProviders } from '../../auth/oauth';
import { PasskeyRegisterButton } from '../../components/passkey-buttons';
import { listClaimedAliases } from '../../server/claim';
import { listAccessTokens } from '../../domain/access-token';
import { getDb } from '../../server/data';
import { getUploadConfig } from '../../storage/driver';
import { SectionNavLayout, type SectionNavItem } from '../../components/section-nav';
import { SubmitButton } from '../../components/submit-button';

const ERROR_MESSAGES: Record<string, string> = {
  invalid_input: '表示名は必須です。',
  uploads_disabled: 'このインスタンスではファイルアップロードが無効です。',
  no_file: 'ファイルが選択されていません。',
  too_large: 'ファイルサイズが上限を超えています。',
  bad_type: '対応していない画像形式です(PNG / JPEG / WebP / GIF)。',
  delete_confirm: '退会するには確認欄に「退会」と入力してください。',
  delete_owner:
    'あなたが唯一の管理者になっている共同グループがあります。先に他の管理者へ引き継ぐか、グループを削除してから退会してください。',
};

export default async function ProfileSettingsPage() {
  const user = await getCurrentUser();
  if (!user) return <LoginRequired />;

  const db = await getDb();
  const me = await db.query.actors.findFirst({
    where: eq(schema.actors.id, user.actorId),
  });
  if (!me) return <LoginRequired />;

  const { env } = await import('cloudflare:workers');
  const uploads = getUploadConfig(env);
  const discordInvite = (env as Env).DISCORD_INVITE_URL ?? null;

  const url = new URL(getRequest().url);
  const error = url.searchParams.get('error');
  const links = me.profileLinks ?? [];

  const claimCode = url.searchParams.get('claim_code');
  const claimOk = url.searchParams.get('claim_ok');
  const claimError = url.searchParams.get('claim_error');
  const notifySaved = url.searchParams.get('notify_saved');
  const discordTest = url.searchParams.get('discord_test');
  const calSaved = url.searchParams.get('cal_saved');
  const oauthOk = url.searchParams.get('oauth_ok');
  const oauthError = url.searchParams.get('oauth_error');
  const aliases = await listClaimedAliases(db, user.actorId);
  const account = await db.query.users.findFirst({
    where: eq(schema.users.actorId, user.actorId),
  });
  const host = url.host;
  const providers = enabledProviders(env);
  const oauthLinks = await db.query.oauthAccounts.findMany({
    where: eq(schema.oauthAccounts.userActorId, user.actorId),
  });
  const passkeyList = await db.query.passkeys.findMany({
    where: eq(schema.passkeys.userActorId, user.actorId),
  });
  const providerName = (id: string) => providers.find((p) => p.id === id)?.name ?? id;

  const tokens = await listAccessTokens(db, user.actorId);

  const sections: SectionNavItem[] = [
    { id: 'avatar', label: 'アバター' },
    { id: 'oauth', label: 'ログイン方法' },
    { id: 'calendar', label: '参加予定カレンダー' },
    { id: 'notifications', label: 'お知らせ' },
    { id: 'fediverse', label: 'Fediverse 連携' },
    { id: 'tokens', label: 'アクセストークン' },
    { id: 'danger', label: 'データと退会' },
  ];

  return (
    <div>
      <title>プロフィール設定 - Yorox</title>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="display t-xl">プロフィール設定</h1>
        {me.handle && (
          <Link to={`/u/${me.handle}`} className="link text-sm">
            公開プロフィールを見る
          </Link>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-4 border-2 border-accent p-3 text-sm text-accent">
          {ERROR_MESSAGES[error] ?? 'エラーが発生しました。'}
        </p>
      )}

      <div className="mt-6">
        <SectionNavLayout title="設定" items={sections}>
      {/* ---- アバター ---- */}
      <section id="avatar" className="scroll-mt-4 border-2 border-ink p-4">
        <h2 className="text-sm font-bold">アバター</h2>
        <div className="mt-3 flex items-center gap-4">
          <Avatar avatarUrl={me.avatarUrl} displayName={me.displayName} size="lg" />
          {uploads.enabled ? (
            <form
              method="post"
              action="/profile/avatar"
              encType="multipart/form-data"
              className="flex flex-wrap items-center gap-3"
            >
              <input
                type="file"
                name="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                required
                className="text-sm"
              />
              <button type="submit" className="btn-quiet cursor-pointer">
                アップロード
              </button>
            </form>
          ) : (
            <p className="text-sm text-neutral">
              このインスタンスでは画像アップロードが無効です
            </p>
          )}
        </div>
      </section>

      {/* ---- 基本情報 ---- */}
      <form method="post" action="/profile/update" className="mt-6 space-y-5">
        <label className="block">
          <span className="text-sm font-bold">表示名 *</span>
          <input
            type="text"
            name="display_name"
            required
            maxLength={80}
            defaultValue={me.displayName}
            className="input mt-1"
          />
        </label>
        <div className="meta-mono text-sm text-neutral">@{me.handle}(変更不可)</div>
        <label className="block">
          <span className="text-sm font-bold">自己紹介(Markdown)</span>
          <textarea
            name="summary"
            rows={5}
            defaultValue={me.summary ?? ''}
            className="input mt-1 leading-relaxed"
            placeholder={'京都でフロントエンドをやっています。\n好きな技術: …'}
          />
        </label>
        <fieldset>
          <legend className="text-sm font-bold">リンク(最大3つ)</legend>
          <p className="mt-1 text-sm text-neutral">
            X / GitHub / Bluesky / Mastodon などはアイコン付きで表示されます
          </p>
          {[0, 1, 2].map((i) => (
            <input
              key={i}
              type="url"
              name={`link${i + 1}`}
              defaultValue={links[i] ?? ''}
              className="input meta-mono mt-2"
              placeholder={
                i === 0 ? 'https://x.com/…' : i === 1 ? 'https://github.com/…' : 'https://…'
              }
            />
          ))}
        </fieldset>
        <button type="submit" className="btn cursor-pointer">
          保存する
        </button>
      </form>

      {/* ---- ログイン方法(OAuth) ---- */}
      <section id="oauth" className="mt-10 scroll-mt-4 border-2 border-ink p-4">
        <h2 className="display t-md">
          ログイン方法
          <HelpTip text="メールでのログインリンクは常に使えます。外部サービスを連携すると、そのアカウントのボタン一つでログインできるようになります。連携を解除してもメールでログインできるため安全です。" />
        </h2>
        {oauthOk && (
          <p role="status" className="mt-3 border-2 border-accent-2 p-3 text-sm text-accent-2">
            連携しました。
          </p>
        )}
        {oauthError && (
          <p role="alert" className="mt-3 border-2 border-accent p-3 text-sm text-accent">
            {oauthError}
          </p>
        )}
        <p className="mt-3 text-sm">
          メール({account?.email})でのログイン: <strong>常に有効</strong>
        </p>

        <div className="mt-4 border-t border-rule pt-4">
          <h3 className="text-sm font-bold">パスキー</h3>
          <p className="mt-1 text-sm text-neutral">
            指紋・顔認証などでワンタップログインできます。デバイスごとに登録してください。
          </p>
          {passkeyList.length > 0 && (
            <ul className="mt-2 space-y-2">
              {passkeyList.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm">
                    {p.label || 'パスキー'}
                    <span className="meta-mono ml-2 text-neutral">
                      {new Intl.DateTimeFormat('ja-JP', {
                        dateStyle: 'medium',
                        timeZone: 'Asia/Tokyo',
                      }).format(p.createdAt)}{' '}
                      登録
                    </span>
                  </span>
                  <form method="post" action={`/auth/passkey/${p.id}/delete`}>
                    <button
                      type="submit"
                      className="min-h-11 cursor-pointer text-sm text-neutral underline underline-offset-3 hover:text-ink"
                    >
                      削除
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3">
            <PasskeyRegisterButton />
          </div>
        </div>
        {oauthLinks.length > 0 && (
          <ul className="mt-3 space-y-2">
            {oauthLinks.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  {providerName(o.provider)}
                  {o.label && (
                    <span className="meta-mono ml-2 text-sm text-neutral">{o.label}</span>
                  )}
                </span>
                <form method="post" action={`/auth/oauth/${o.id}/unlink`}>
                  <button
                    type="submit"
                    className="min-h-11 cursor-pointer text-sm text-neutral underline underline-offset-3 hover:text-ink"
                  >
                    解除
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
        {providers.filter((p) => !oauthLinks.some((o) => o.provider === p.id)).length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {providers
              .filter((p) => !oauthLinks.some((o) => o.provider === p.id))
              .map((p) => (
                <a
                  key={p.id}
                  href={`/auth/oauth/${p.id}/start?link=1`}
                  className="btn-quiet"
                >
                  {p.name} を連携
                </a>
              ))}
          </div>
        )}
        {providers.length === 0 && (
          <p className="mt-3 text-sm text-neutral">
            このインスタンスでは外部サービスログインは設定されていません。
          </p>
        )}
      </section>

      {/* ---- お知らせ設定 ---- */}
      {/* ---- 参加予定カレンダー(ics 購読) ---- */}
      <section id="calendar" className="mt-10 scroll-mt-4 border-2 border-ink p-4">
        <h2 className="display t-md">
          参加予定カレンダー
          <HelpTip text="参加確定したイベントが自動で入るカレンダーを、Google カレンダーや Apple カレンダーで購読できます。以後の参加・キャンセルも自動で反映されます。URL は秘密にしてください(知っている人はあなたの参加予定を見られます)。" />
        </h2>
        {calSaved && (
          <p role="status" className="mt-3 border-2 border-accent-2 p-3 text-sm text-accent-2">
            発行しました。
          </p>
        )}
        {account?.calendarToken ? (
          (() => {
            const icsPath = `/calendar/${account.calendarToken}/yorox.ics`;
            const httpsUrl = host ? `https://${host}${icsPath}` : icsPath;
            const webcalUrl = host ? `webcal://${host}${icsPath}` : icsPath;
            const googleUrl = host
              ? `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(httpsUrl)}`
              : null;
            return (
              <div className="mt-3">
                <p className="text-sm text-neutral">
                  ボタンから購読するか、URL をカレンダーアプリの「URL で購読」に貼り付けてください。
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <a href={webcalUrl} className="btn-quiet inline-block">
                    カレンダーに購読(Apple ほか)
                  </a>
                  {googleUrl && (
                    <a
                      href={googleUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="btn-quiet inline-block"
                    >
                      Google カレンダーに追加
                    </a>
                  )}
                  <a href={icsPath} className="btn-quiet inline-block" download>
                    .ics をダウンロード
                  </a>
                </div>
                <p className="mt-3 text-sm text-neutral">購読 URL(貼り付け用):</p>
                <a
                  href={httpsUrl}
                  className="link meta-mono mt-1 block rounded border border-rule bg-paper-2 p-2 text-sm break-all"
                >
                  {httpsUrl}
                </a>
                <form method="post" action="/profile/calendar-token" className="mt-3">
                  <button
                    type="submit"
                    className="min-h-11 cursor-pointer text-sm text-neutral underline underline-offset-3 hover:text-ink"
                  >
                    URL を再発行(古い URL は無効になります)
                  </button>
                </form>
              </div>
            );
          })()
        ) : (
          <form method="post" action="/profile/calendar-token" className="mt-3">
            <button type="submit" className="btn-quiet cursor-pointer">
              購読用 URL を発行
            </button>
          </form>
        )}
      </section>

      <section id="notifications" className="mt-10 scroll-mt-4 border-2 border-ink p-4">
        <h2 className="display t-md">
          お知らせの受け取り
          <HelpTip text="参加確定・補欠繰上・抽選結果などのお知らせの届け方です。オフにしてもログイン用メール(マジックリンク)は届きます。Fediverse 連携アカウントで参加した分は、そのアカウント宛のメンションで届きます。" />
        </h2>
        {notifySaved && (
          <p role="status" className="mt-3 border-2 border-accent-2 p-3 text-sm text-accent-2">
            保存しました。
          </p>
        )}
        <form method="post" action="/profile/notifications" className="mt-3">
          <label className="flex min-h-11 items-center gap-2">
            <input
              type="checkbox"
              name="email_notifications"
              defaultChecked={account?.emailNotifications ?? true}
            />
            <span>参加状況のお知らせをメール({account?.email})で受け取る</span>
          </label>
          <label className="mt-3 flex min-h-11 items-center gap-2">
            <input
              type="checkbox"
              name="discord_dm_notifications"
              defaultChecked={account?.discordDmNotifications ?? true}
            />
            <span>Discord の DM でも受け取る(アカウント連携済みの場合)</span>
          </label>
          <p className="mt-1 text-sm text-neutral">
            Discord でログイン連携していると、Bot から DM が届きます。
          </p>
          <div className="mt-2 border border-rule bg-paper-2 p-3 text-sm">
            <p className="font-bold">DM を受け取るには</p>
            <ol className="mt-1 list-inside list-decimal space-y-1 text-neutral">
              <li>
                Bot と<strong>同じ Discord サーバーに参加</strong>する
                (Discord の仕様で Bot はフレンド登録できないため、共通のサーバーが必要です)
                {discordInvite && (
                  <>
                    {' '}
                    —{' '}
                    <a href={discordInvite} className="link" target="_blank" rel="noreferrer">
                      サーバーに参加する
                    </a>
                  </>
                )}
              </li>
              <li>
                Discord の<strong>プライバシー設定</strong>で
                「サーバーにいるメンバーからのダイレクトメッセージを許可する」をオンにする
                (サーバーごとの設定もあります)
              </li>
            </ol>
            <p className="mt-2 text-neutral">
              条件を満たさない場合でもメールでは届きます。
            </p>
          </div>

          <label className="mt-4 block">
            <span className="text-sm font-bold">Discord Webhook URL(任意)</span>
            <input
              type="url"
              name="discord_webhook_url"
              defaultValue={account?.discordWebhookUrl ?? ''}
              className="input meta-mono mt-1"
              placeholder="https://discord.com/api/webhooks/…"
            />
          </label>
          <p className="mt-1 border-2 border-accent p-2 text-sm text-accent">
            注意: Webhook を設定すると、あなた宛の通知(参加確定・抽選結果など)が
            そのチャンネルに投稿されます。<strong>チャンネルを見られる人全員に内容が見えます</strong>。
            自分だけのプライベートチャンネルを使うことを強くおすすめします。
          </p>

          <button type="submit" className="btn-quiet mt-3 cursor-pointer">
            保存
          </button>
        </form>

        {discordTest && (
          <p role="status" className="mt-4 border-2 border-accent-2 p-3 text-sm text-accent-2">
            {discordTest}
          </p>
        )}
        <form method="post" action="/profile/discord/test" className="mt-3">
          <SubmitButton pendingLabel="Discord に送信中…">Discord にテスト送信</SubmitButton>
          <span className="ml-2 text-sm text-neutral">
            設定を保存してから試すと、DM と Webhook の到達を確認できます
          </span>
        </form>
      </section>

      {/* ---- Fediverse アカウント連携(claim) ---- */}
      <section id="fediverse" className="mt-10 scroll-mt-4 border-2 border-ink p-4">
        <h2 className="display t-md">Fediverse アカウント連携</h2>
        <p className="mt-2 text-sm text-neutral">
          Misskey / Mastodon などのアカウントを紐付けると、そのアカウントからの
          イベント参加があなたの参加履歴として扱われ、「アカウント連携済みの人」限定の枠にも
          参加できるようになります。
        </p>

        {claimOk && (
          <p role="status" className="mt-3 border-2 border-accent-2 p-3 text-sm text-accent-2">
            連携が完了しました。
          </p>
        )}
        {claimError && (
          <p role="alert" className="mt-3 border-2 border-accent p-3 text-sm text-accent">
            {claimError}
          </p>
        )}

        {aliases.length > 0 && (
          <ul className="mt-4 space-y-2">
            {aliases.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2">
                <a href={a.uri} className="link meta-mono text-sm" rel="noreferrer" target="_blank">
                  {a.domain === 'bsky' ? `@${a.handle} (Bluesky)` : `@${a.handle}@${a.domain}`}
                </a>
                <form method="post" action="/profile/claim-unlink">
                  <input type="hidden" name="remote_actor_id" value={a.id} />
                  <button
                    type="submit"
                    className="min-h-11 cursor-pointer text-sm text-neutral underline underline-offset-3 hover:text-ink"
                  >
                    解除
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-5 space-y-6">
          <div>
            <h3 className="text-sm font-bold">方法1: コードを投稿して連携</h3>
            {claimCode ? (
              <div className="mt-2 border border-rule p-3">
                <p className="text-sm">
                  連携したいアカウントから、次のコードを
                  <span className="meta-mono font-bold"> @{me.handle}@{host} </span>
                  宛のメンション付きで投稿してください(DM でも可、30分有効):
                </p>
                <p className="meta-mono mt-2 t-lg font-bold">{claimCode}</p>
              </div>
            ) : (
              <form method="post" action="/profile/claim-code" className="mt-2">
                <button type="submit" className="btn-quiet cursor-pointer">
                  連携コードを発行
                </button>
              </form>
            )}
          </div>
          <div>
            <h3 className="text-sm font-bold">方法3: Bluesky アカウントを連携</h3>
            <p className="mt-1 text-sm text-neutral">
              Bluesky プロフィールの説明文に
              <span className="meta-mono"> https://{host}/u/{me.handle} </span>
              を追加してから、ハンドルを入力してください。
            </p>
            <form
              method="post"
              action="/profile/claim-bsky"
              className="mt-2 flex flex-wrap gap-2"
            >
              <input
                type="text"
                name="bsky_handle"
                required
                className="input meta-mono max-w-xs"
                placeholder="you.bsky.social"
              />
              <button type="submit" className="btn-quiet cursor-pointer">
                確認して連携
              </button>
            </form>
          </div>
          <div>
            <h3 className="text-sm font-bold">方法2: プロフィールのリンクで連携(rel=me)</h3>
            <p className="mt-1 text-sm text-neutral">
              リモート側プロフィールのリンク欄(メタデータ)に
              <span className="meta-mono"> https://{host}/u/{me.handle} </span>
              を追加してから、アカウントを入力してください。
            </p>
            <form
              method="post"
              action="/profile/claim-relme"
              className="mt-2 flex flex-wrap gap-2"
            >
              <input
                type="text"
                name="remote_account"
                required
                className="input meta-mono max-w-xs"
                placeholder="@you@misskey.example"
              />
              <button type="submit" className="btn-quiet cursor-pointer">
                確認して連携
              </button>
            </form>
          </div>
        </div>
      </section>

      {/* ---- アクセストークン(API / MCP) ---- */}
      <section id="tokens" className="mt-10 scroll-mt-4 border-2 border-ink p-4">
        <h2 className="display t-md">
          アクセストークン
          <HelpTip text="MCP クライアントや API から Yorox をあなたとして操作するための鍵です。発行時に一度だけ表示されるので安全に保管してください。不要になったら失効できます。" />
        </h2>
        <p className="mt-2 text-sm text-neutral">
          MCP サーバー(<span className="meta-mono">/mcp</span>)にこのトークンを{' '}
          <span className="meta-mono">Authorization: Bearer …</span>{' '}
          として設定すると、イベント作成・参加などの操作ができます。
        </p>

        {tokens.length > 0 ? (
          <ul className="mt-4">
            {tokens.map((t) => (
              <li
                key={t.id}
                className="flex flex-wrap items-center justify-between gap-3 border-b border-rule py-3"
              >
                <div className="min-w-0">
                  <span className="font-bold">{t.name}</span>
                  <p className="meta-mono mt-0.5 text-sm text-neutral">
                    発行 {t.createdAt.toLocaleDateString('ja-JP')}
                    {t.lastUsedAt
                      ? ` · 最終利用 ${t.lastUsedAt.toLocaleDateString('ja-JP')}`
                      : ' · 未使用'}
                  </p>
                </div>
                <form method="post" action={`/profile/tokens/${t.id}/revoke`}>
                  <button
                    type="submit"
                    className="min-h-11 cursor-pointer text-sm text-neutral underline underline-offset-3 hover:text-accent"
                  >
                    失効
                  </button>
                </form>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 text-sm text-neutral">発行済みのトークンはありません。</p>
        )}

        <form
          method="post"
          action="/profile/tokens"
          className="mt-4 flex flex-wrap items-end gap-3"
        >
          <label className="block min-w-48 flex-1">
            <span className="text-sm font-bold">トークン名</span>
            <input
              type="text"
              name="name"
              maxLength={60}
              required
              className="input mt-1"
              placeholder="例: Claude Desktop"
            />
          </label>
          <button type="submit" className="btn cursor-pointer">
            発行
          </button>
        </form>
      </section>

      {/* ---- データと退会(危険な操作) ---- */}
      <section id="danger" className="mt-10 scroll-mt-4 border-2 border-accent p-4">
        <h2 className="display t-md text-accent">データと退会</h2>

        <div className="mt-4">
          <h3 className="text-sm font-bold">データのエクスポート</h3>
          <p className="mt-1 text-sm text-neutral">
            プロフィール・参加履歴・出欠・支払い・グループ所属を JSON でまとめてダウンロードします。
          </p>
          <a href="/profile/export.json" className="btn-quiet mt-2 inline-block" download>
            エクスポート(JSON)
          </a>
        </div>

        <div className="mt-6 border-t border-rule pt-6">
          <h3 className="text-sm font-bold text-accent">アカウントの削除(退会)</h3>
          <p className="mt-1 text-sm text-neutral">
            退会すると、メールアドレス・ログイン情報・連携アカウントは削除され、
            進行中の申込はキャンセルされます。過去の参加・出欠の記録は、主催者側の
            集計のため匿名化された形で残ることがあります。この操作は取り消せません。
          </p>
          <form method="post" action="/profile/delete" className="mt-3">
            <label className="block text-sm">
              確認のため <span className="font-bold">退会</span> と入力してください
              <input
                type="text"
                name="confirm"
                autoComplete="off"
                className="input mt-1 max-w-xs"
                placeholder="退会"
              />
            </label>
            <button
              type="submit"
              className="mt-3 min-h-11 cursor-pointer border-2 border-accent px-4 font-bold text-accent hover:bg-accent hover:text-paper"
            >
              退会する
            </button>
          </form>
        </div>
      </section>
        </SectionNavLayout>
      </div>
    </div>
  );
}

export const getConfig = async () => {
  return {
    render: 'dynamic',
  } as const;
};
