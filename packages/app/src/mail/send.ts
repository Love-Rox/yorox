/**
 * 即時送信ヘルパー(マジックリンク等、ユーザーが待っているメール用)。
 * トランスポート未設定ならコンソールへ出力する(開発時はここにリンクが出る)。
 */
import { createTransportFromEnv, type MailMessage } from './transport';

export function createDirectSender(env: Env): (message: MailMessage) => Promise<void> {
  const transport = createTransportFromEnv(env);
  if (transport) {
    return (message) => transport.send(message);
  }
  return async (message) => {
    console.log(`[mail:console] to=${message.to} ${message.subject}\n${message.bodyText}`);
  };
}
