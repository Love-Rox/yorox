/**
 * 参加枠フォームの入力欄(追加・編集で共有)。
 *
 * 追加と編集で項目がずれると、編集した瞬間に設定が消える事故になるため、
 * 入力欄はここ一箇所にまとめてある。既定値は slot を渡すと入る。
 */
import { HelpTip } from './help-tip';
import type { schema } from '../db/client';

type Slot = typeof schema.slots.$inferSelect;

/** datetime-local 用に JST の "YYYY-MM-DDTHH:mm" にする */
function toLocalInput(d: Date | null | undefined): string | undefined {
  if (!d) return undefined;
  return new Date(d.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 16);
}

export function SlotFormFields({
  slot,
  groupDiscordGuildId,
  stripeConnected,
}: {
  /** 編集時の既定値。未指定なら新規追加 */
  slot?: Slot | undefined;
  groupDiscordGuildId?: string | null | undefined;
  stripeConnected: boolean;
}) {
  const c = slot?.conditions ?? null;
  return (
    <>
      <label className="block">
        <span className="text-sm font-bold">枠名 *</span>
        <input
          type="text"
          name="name"
          required
          maxLength={100}
          defaultValue={slot?.name}
          className="input mt-1"
          placeholder="一般参加"
        />
      </label>
      <label className="block">
        <span className="text-sm font-bold">定員 *</span>
        <input
          type="number"
          name="capacity"
          required
          min={1}
          defaultValue={slot?.capacity}
          className="input meta-mono mt-1"
        />
      </label>
      <fieldset>
        <legend className="text-sm font-bold">方式<HelpTip text="先着: 申込順に確定し、満席後は補欠。抽選: 申込を集めて抽選日時に当選者を決定します。" /></legend>
        <div className="mt-1 flex gap-6">
          <label className="flex min-h-11 items-center gap-2">
            <input
              type="radio"
              name="method"
              value="fcfs"
              defaultChecked={slot ? slot.method === 'fcfs' : true}
            />{' '}
            先着
          </label>
          <label className="flex min-h-11 items-center gap-2">
            <input
              type="radio"
              name="method"
              value="lottery"
              defaultChecked={slot?.method === 'lottery'}
            />{' '}
            抽選
          </label>
        </div>
      </fieldset>
      <label className="block">
        <span className="text-sm font-bold">抽選ロジック(抽選時)<HelpTip text="完全ランダム: 全員同確率。出欠率重み付け: 過去の出席実績が高い人が当たりやすくなります。手動選定: 管理画面で主催者が一人ずつ当選・補欠・落選を決めます。" /></span>
        <select
          name="lottery_logic"
          defaultValue={slot?.lotteryLogic ?? undefined}
          className="input mt-1"
        >
          <option value="random">完全ランダム</option>
          <option value="weighted">出欠率による重み付け</option>
          <option value="manual">主催の手動選定</option>
        </select>
      </label>
      <label className="block">
        <span className="text-sm font-bold">抽選日時(抽選時)</span>
        <input
          type="datetime-local"
          name="lottery_at"
          defaultValue={toLocalInput(slot?.lotteryAt)}
          className="input meta-mono mt-1"
        />
      </label>
      <label className="block">
        <span className="text-sm font-bold">補欠モデル<HelpTip text="Connpass 流: 落選や定員溢れは全員自動的に補欠になります。指定する: 補欠の人数にも上限を設けます。" /></span>
        <select
          name="waitlist_model"
          defaultValue={slot?.waitlistModel ?? undefined}
          className="input mt-1"
        >
          <option value="connpass">落選・溢れは補欠(Connpass 流)</option>
          <option value="separate">補欠数を指定する</option>
        </select>
      </label>
      <label className="block">
        <span className="text-sm font-bold">補欠定員(指定時)</span>
        <input
          type="number"
          name="waitlist_capacity"
          min={0}
          defaultValue={slot?.waitlistCapacity ?? undefined}
          className="input meta-mono mt-1"
        />
      </label>
      <label className="block">
        <span className="text-sm font-bold">繰上ポリシー<HelpTip text="キャンセルで空きが出たときの補欠の扱い。即時自動: すぐ繰上げ。締切付き自動: 開催 X 時間前以降は繰上げない。承諾制: 本人が承諾したら確定します。" /></span>
        <select
          name="promotion_policy"
          defaultValue={slot?.promotionPolicy ?? undefined}
          className="input mt-1"
        >
          <option value="auto">即時自動</option>
          <option value="auto_deadline">締切付き自動</option>
          <option value="consent">本人承諾型</option>
        </select>
      </label>
      <label className="block">
        <span className="text-sm font-bold">繰上停止(開催の何時間前)</span>
        <input
          type="number"
          name="promotion_deadline_hours"
          min={0}
          defaultValue={slot?.promotionDeadlineHours ?? undefined}
          className="input meta-mono mt-1"
        />
      </label>
      <fieldset>
        <legend className="text-sm font-bold">参加費</legend>
        <label className="mt-1 block">
          <span className="text-sm">金額(円。空欄で無料)</span>
          <input
            type="number"
            name="price"
            min={0}
            defaultValue={slot?.price ?? undefined}
            className="input meta-mono mt-1"
            placeholder="1000"
          />
        </label>
        <label className="mt-2 block">
          <span className="text-sm">支払方法</span>
          <select
            name="payment_method"
            defaultValue={slot?.paymentMethod ?? undefined}
            className="input mt-1"
          >
            <option value="onsite">現地払い</option>
            <option value="external">外部決済リンク</option>
            {stripeConnected && (
              <option value="stripe">Stripe(カード事前決済)</option>
            )}
          </select>
        </label>
        <label className="mt-2 block">
          <span className="text-sm">決済 URL(外部決済リンク時)</span>
          <input
            type="url"
            name="payment_url"
            defaultValue={slot?.paymentUrl ?? undefined}
            className="input meta-mono mt-1"
            placeholder="https://buy.stripe.com/…"
          />
        </label>
        <label className="mt-2 block">
          <span className="text-sm">確定条件</span>
          <select
            name="payment_confirm"
            defaultValue={slot?.paymentConfirm ?? undefined}
            className="input mt-1"
          >
            <option value="independent">申込/当選で確定(支払いは別管理)</option>
            <option value="required">支払い確認で確定</option>
          </select>
        </label>
      </fieldset>
      <fieldset>
        <legend className="text-sm font-bold">参加条件(AND)<HelpTip text="すべての条件を満たす人だけが申込できます。満たさない申込は理由付きで断られます。" /></legend>
        <label className="mt-1 flex min-h-11 items-center gap-2">
          <input type="checkbox" name="require_claimed" defaultChecked={!!c?.requireClaimed} />
          アカウント連携済み(本人確認済み)の人のみ
          <HelpTip text="Fediverse からの申込者のうち、プロフィール設定で Yorox アカウントと連携済みの人に限定します。Yorox アカウントで直接申し込む人は常に対象です。" />
        </label>
        <label className="block">
          <span className="text-sm">アカウント作成からの最低日数</span>
          <input
            type="number"
            name="min_account_age_days"
            min={0}
            defaultValue={c?.minAccountAgeDays ?? undefined}
            className="input meta-mono mt-1"
          />
        </label>
        <label className="block">
          <span className="text-sm">参加実績の最低回数</span>
          <input
            type="number"
            name="min_attended_count"
            min={0}
            defaultValue={c?.minAttendedCount ?? undefined}
            className="input meta-mono mt-1"
          />
        </label>
        <label className="mt-1 flex min-h-11 items-center gap-2">
          <input
            type="checkbox"
            name="require_discord_guild"
            defaultChecked={!!c?.requireDiscordGuild}
          />
          指定の Discord サーバーの参加者のみ
          <HelpTip text="申込時に Discord サーバーへの所属を確認します。申込者が Discord を連携していない場合や、所属を確認できなかった場合は申込を断ります。" />
        </label>
        <label className="block">
          <span className="text-sm">
            対象の Discord サーバー ID(空欄ならグループ既定)
          </span>
          <input
            type="text"
            name="discord_guild_id"
            inputMode="numeric"
            pattern="\d{17,20}"
            defaultValue={c?.discordGuildId ?? undefined}
            className="input meta-mono mt-1"
            placeholder={groupDiscordGuildId ?? '123456789012345678'}
          />
          {!groupDiscordGuildId && (
            <span className="mt-1 block text-sm text-neutral">
              グループ設定でサーバー ID を登録しておくと、枠ごとの入力を省けます
            </span>
          )}
        </label>
      </fieldset>
      <fieldset>
        <legend className="text-sm font-bold">登壇枠<HelpTip text="LT 枠・発表枠など。参加確定した人はイベントページの「主催・登壇」欄にも登壇者として表示されます。" /></legend>
        <label className="mt-1 flex min-h-11 items-center gap-2">
          <input type="checkbox" name="is_speaker_slot" defaultChecked={!!slot?.isSpeakerSlot} />
          登壇枠にする(確定者を登壇者として表示)
        </label>
      </fieldset>
      <fieldset>
        <legend className="text-sm font-bold">連合(Fediverse)<HelpTip text="オンにすると、Misskey / Mastodon などのアカウントのまま(Yorox 未登録でも)この枠に参加申込できます。告知へのリプライ「参加」で申し込め、結果はリプライで届きます。" /></legend>
        <label className="mt-1 flex min-h-11 items-center gap-2">
          <input type="checkbox" name="allow_remote" defaultChecked={!!slot?.allowRemote} />
          リモート参加を受け入れる(Misskey / Mastodon 等からの申込)
        </label>
      </fieldset>
    </>
  );
}
