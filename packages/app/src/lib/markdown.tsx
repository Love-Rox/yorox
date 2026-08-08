import MarkdownIt from 'markdown-it';

/**
 * Markdown レンダリング。
 * html: false なので生 HTML はエスケープされる(XSS 対策)。
 */
const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
});

// リンクは常に新規タブ + noreferrer
const defaultLinkOpen =
  md.renderer.rules.link_open ??
  ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  tokens[idx]!.attrSet('rel', 'noreferrer');
  tokens[idx]!.attrSet('target', '_blank');
  return defaultLinkOpen(tokens, idx, options, env, self);
};

/** AP の content 等、HTML 文字列が必要な場合に使う(html:false でエスケープ済み) */
export function renderMarkdownToHtml(source: string): string {
  return md.render(source);
}

export function Markdown({ source }: { source: string }) {
  return (
    <div
      className="markdown max-w-[65ch]"
      // markdown-it (html:false) の出力のみを注入する
      dangerouslySetInnerHTML={{ __html: md.render(source) }}
    />
  );
}
