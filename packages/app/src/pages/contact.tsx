import {
  unstable_getRequest as getRequest,
  unstable_notFound as notFound,
} from 'waku/router/server';

/** お問い合わせフォーム(CONTACT_EMAIL が設定されているときだけ表示) */
export default async function ContactPage() {
  const env = (await import('cloudflare:workers')).env as Env;
  if (!env.CONTACT_EMAIL) return notFound();
  const turnstileSiteKey = env.TURNSTILE_SITE_KEY ?? null;

  const url = new URL(getRequest().url);
  const sent = url.searchParams.get('sent') === '1';
  const error = url.searchParams.get('error');

  return (
    <div className="max-w-xl">
      <title>お問い合わせ - Yorox</title>
      <h1 className="display t-xl">お問い合わせ</h1>
      <p className="mt-3 text-sm text-neutral">
        本サービスに関するお問い合わせはこちらから。個別のイベントに関するご質問は、
        各イベントの主催者へお願いします。
      </p>

      {sent && (
        <p role="status" className="mt-4 border-2 border-accent-2 p-3 text-sm text-accent-2">
          送信しました。お問い合わせありがとうございます。順次確認いたします。
        </p>
      )}
      {error === 'turnstile' ? (
        <p role="alert" className="mt-4 border-2 border-accent p-3 text-sm text-accent">
          bot 対策の確認に失敗しました。ページを再読み込みして、もう一度お試しください。
        </p>
      ) : error ? (
        <p role="alert" className="mt-4 border-2 border-accent p-3 text-sm text-accent">
          メールアドレスの形式、または本文(5文字以上)をご確認ください。
        </p>
      ) : null}

      <form method="post" action="/contact" className="mt-6 space-y-5">
        <label className="block">
          <span className="text-sm font-bold">お名前(任意)</span>
          <input type="text" name="name" maxLength={100} className="input mt-1" />
        </label>
        <label className="block">
          <span className="text-sm font-bold">返信先メールアドレス *</span>
          <input
            type="email"
            name="email"
            required
            maxLength={200}
            className="input meta-mono mt-1"
            placeholder="you@example.com"
          />
        </label>
        <label className="block">
          <span className="text-sm font-bold">お問い合わせ内容 *</span>
          <textarea
            name="message"
            required
            rows={8}
            maxLength={4000}
            className="input mt-1 min-h-40 leading-relaxed"
          />
        </label>
        {/* ハニーポット(人間には見えない。ボット対策) */}
        <div aria-hidden className="absolute left-[-9999px] h-0 w-0 overflow-hidden">
          <label>
            Website
            <input type="text" name="website" tabIndex={-1} autoComplete="off" />
          </label>
        </div>
        {turnstileSiteKey && (
          <div className="cf-turnstile" data-sitekey={turnstileSiteKey} data-theme="auto" />
        )}
        <button type="submit" className="btn cursor-pointer">
          送信
        </button>
      </form>
      {turnstileSiteKey && (
        <script
          src="https://challenges.cloudflare.com/turnstile/v0/api.js"
          async
          defer
        />
      )}
    </div>
  );
}

export const getConfig = async () => {
  return {
    render: 'dynamic',
  } as const;
};
