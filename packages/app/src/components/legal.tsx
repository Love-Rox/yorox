import { Link } from 'waku';

/** 法的ページ共通のインスタンス情報(env から。未設定はプレースホルダ) */
export async function instanceInfo() {
  const env = (await import('cloudflare:workers')).env as Env;
  const hasForm = !!env.CONTACT_EMAIL;
  // 連絡手段: 問い合わせフォーム(CONTACT_EMAIL)を優先、無ければ LEGAL_CONTACT を表示
  const contact = hasForm
    ? 'お問い合わせフォーム'
    : (env.LEGAL_CONTACT ?? '(連絡先を設定してください)');
  return {
    name: env.INSTANCE_NAME ?? 'このインスタンス',
    operator: env.LEGAL_OPERATOR ?? '(運営者名を設定してください)',
    contact,
    /** 設定されていれば問い合わせフォームへのパス */
    contactHref: hasForm ? '/contact' : null,
    configured: !!(env.LEGAL_OPERATOR && (env.LEGAL_CONTACT || env.CONTACT_EMAIL)),
  };
}

/** 運営者が内容を確認・編集すべき旨の注意(未設定インスタンス向け) */
export function OperatorNotice({ configured }: { configured: boolean }) {
  if (configured) return null;
  return (
    <p className="mt-4 border-2 border-accent p-3 text-sm text-accent">
      これはテンプレートです。インスタンス運営者は法務を確認のうえ、内容と
      運営者情報(<span className="meta-mono">INSTANCE_NAME / LEGAL_OPERATOR</span> と、
      連絡先として <span className="meta-mono">LEGAL_CONTACT</span> または問い合わせ
      フォーム用の <span className="meta-mono">CONTACT_EMAIL</span>)を設定してください。
    </p>
  );
}

/** 連絡先の表示。問い合わせフォームがあればリンク、無ければテキスト */
export function ContactValue({
  contact,
  contactHref,
}: {
  contact: string;
  contactHref: string | null;
}) {
  if (!contactHref) return <>{contact}</>;
  return (
    <Link to={contactHref} className="link">
      {contact}
    </Link>
  );
}

export function LegalNav() {
  return (
    <nav className="mt-2 flex flex-wrap gap-4 text-sm">
      <Link to="/legal/terms" className="link">
        利用規約
      </Link>
      <Link to="/legal/privacy" className="link">
        プライバシーポリシー
      </Link>
      <Link to="/legal/tokushoho" className="link">
        特定商取引法に基づく表記
      </Link>
    </nav>
  );
}
