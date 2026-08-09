/**
 * 特定商取引法に基づく表記(通信販売)のグループ設定。
 *
 * ここで扱うのは「テンプレの雛形」であり、法的な充足性を保証するものではない。
 * 実際の記載義務・内容は事業者(主催者)自身の責任で確認・記載する。
 */

export interface Tokushoho {
  /** 事業者の氏名または名称 */
  seller: string;
  /** 運営統括責任者 */
  manager: string;
  /** 所在地 */
  address: string;
  /** 電話番号 */
  phone: string;
  /** メールアドレス等の連絡先 */
  email: string;
  /** 販売価格 */
  price: string;
  /** 商品代金以外の必要料金 */
  extraFees: string;
  /** 支払方法 */
  paymentMethods: string;
  /** 支払時期 */
  paymentTiming: string;
  /** 引渡時期(役務提供時期) */
  deliveryTiming: string;
  /** 返品・キャンセル(返品特約) */
  returns: string;
}

/** 表記の各項目のラベルと、記載の要点(概要チェックリスト用) */
export const TOKUSHOHO_FIELDS: {
  key: keyof Tokushoho;
  label: string;
  hint: string;
  multiline?: boolean;
}[] = [
  { key: 'seller', label: '事業者の氏名・名称', hint: '個人は氏名、法人は登記上の名称。屋号のみは不可' },
  { key: 'manager', label: '運営統括責任者', hint: '実際に運営を統括する個人の氏名' },
  { key: 'address', label: '所在地', hint: '請求があれば遅滞なく開示できるなら「請求により開示」も可' },
  { key: 'phone', label: '電話番号', hint: '同上。確実に連絡が取れる番号' },
  { key: 'email', label: '連絡先(メール等)', hint: '問い合わせを受け付ける手段' },
  { key: 'price', label: '販売価格', hint: '各イベントページに表示する旨でも可。消費税の扱いも明記' },
  {
    key: 'extraFees',
    label: '商品代金以外の必要料金',
    hint: '決済手数料・通信費など、参加者が別途負担する費用',
    multiline: true,
  },
  { key: 'paymentMethods', label: '支払方法', hint: '現地払い / クレジットカード / 外部決済 など' },
  { key: 'paymentTiming', label: '支払時期', hint: '申込時・当日など、いつ支払うか' },
  { key: 'deliveryTiming', label: '引渡・役務提供時期', hint: 'イベント開催日時など、いつ提供されるか' },
  {
    key: 'returns',
    label: '返品・キャンセル(返品特約)',
    hint: 'キャンセルの可否・期限・返金の有無と方法を明確に',
    multiline: true,
  },
];

/** 新規作成時の雛形(そのままでは不十分。事業者が必ず書き換える前提) */
export function tokushohoTemplate(): Tokushoho {
  return {
    seller: '',
    manager: '',
    address: '請求があった場合に遅滞なく開示します',
    phone: '請求があった場合に遅滞なく開示します',
    email: '',
    price: '各イベントページに表示された金額(消費税込)',
    extraFees: '決済に係る手数料が発生する場合は参加者の負担となります。',
    paymentMethods: '現地払い / クレジットカード(Stripe)/ 外部決済リンク',
    paymentTiming: '申込時にお支払いいただきます(現地払いは当日)。',
    deliveryTiming: '各イベントの開催日時(イベントページに表示)。',
    returns:
      'キャンセル・返金の可否は各イベントの定めによります。開催中止・主催者都合の場合を除き、原則として返金いたしません。詳細は主催者までお問い合わせください。',
  };
}

/** すべての必須項目が埋まっているか(公開してよい状態か) */
export function isTokushohoComplete(t: Tokushoho | null | undefined): boolean {
  if (!t) return false;
  return TOKUSHOHO_FIELDS.every((f) => (t[f.key] ?? '').trim().length > 0);
}
