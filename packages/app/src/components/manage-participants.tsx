'use client';
/**
 * 管理画面の枠ごとの参加者リスト。
 * 受付でのリアルタイム検索(名前・ハンドルの部分一致)のためクライアント側で絞り込む。
 */
import { useState } from 'react';
import { ActorName } from './actor-name';
import { Avatar } from './avatar';

const STATUS_LABEL: Record<string, string> = {
  applied: '抽選待ち',
  accepted: '参加確定',
  payment_pending: '支払い待ち',
  waitlisted: '補欠',
  consent_pending: '繰上承諾待ち',
  rejected: '落選',
  cancelled: 'キャンセル済み',
};

const PAYMENT_LABEL: Record<string, string> = {
  pending: '未払い',
  paid: '支払済み',
  refund_required: '要返金',
  refunded: '返金済み',
  waived: '免除',
};

const YEN = new Intl.NumberFormat('ja-JP');
const SLOT_METHOD_LABEL: Record<string, string> = { fcfs: '先着', lottery: '抽選' };
const LOTTERY_LABEL: Record<string, string> = {
  random: '完全ランダム',
  weighted: '出欠率重み付け',
  manual: '手動選定',
};

export interface ManageSlot {
  id: string;
  name: string;
  method: string;
  lotteryLogic: string | null;
  capacity: number;
}

export interface ManageRow {
  id: string;
  slotId: string;
  status: string;
  actorId: string;
  displayName: string;
  handle: string | null;
  domain: string | null;
  avatarUrl: string | null;
  emojis: Record<string, string> | null;
  attendanceStatus: string | null;
  paymentId: string | null;
  paymentStatus: string | null;
  paymentAmount: number | null;
}

export function ManageParticipants({
  slots,
  rows,
  history,
  canLottery,
  canAttendance,
}: {
  slots: ManageSlot[];
  rows: ManageRow[];
  history: Record<string, { attended: number; noShow: number }>;
  canLottery: boolean;
  canAttendance: boolean;
}) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const matches = (r: ManageRow) =>
    !q ||
    r.displayName.toLowerCase().includes(q) ||
    (r.handle ?? '').toLowerCase().includes(q) ||
    (r.domain ?? '').toLowerCase().includes(q);

  return (
    <>
      {rows.length > 0 && (
        <div className="mt-8">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="input"
            placeholder="参加者を検索(名前・ハンドル)…"
            aria-label="参加者を検索"
          />
        </div>
      )}

      {slots.map((slot) => {
        const slotRows = rows.filter((r) => r.slotId === slot.id);
        const visibleRows = slotRows.filter(matches);
        const appliedCount = slotRows.filter((r) => r.status === 'applied').length;
        return (
          <section key={slot.id} className="mt-10">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-ink pb-2">
              <h2 className="display t-md">{slot.name}</h2>
              <div className="meta-mono text-sm text-neutral">
                {SLOT_METHOD_LABEL[slot.method]}
                {slot.lotteryLogic && ` · ${LOTTERY_LABEL[slot.lotteryLogic]}`} · 定員{' '}
                {slot.capacity}
              </div>
            </div>

            {canLottery &&
              slot.method === 'lottery' &&
              slot.lotteryLogic !== 'manual' &&
              appliedCount > 0 && (
                <form method="post" action={`/slots/${slot.id}/lottery/run`} className="mt-4">
                  <button type="submit" className="btn cursor-pointer">
                    抽選を実行({appliedCount}名 → 当選{' '}
                    {Math.min(appliedCount, slot.capacity)}名)
                  </button>
                </form>
              )}

            {slotRows.length === 0 ? (
              <p className="mt-3 text-sm text-neutral">申込はまだありません。</p>
            ) : visibleRows.length === 0 ? (
              <p className="mt-3 text-sm text-neutral">「{query}」に一致する参加者はいません。</p>
            ) : (
              <ul className="mt-2">
                {visibleRows.map((p) => {
                  const h = history[p.actorId] ?? { attended: 0, noShow: 0 };
                  const total = h.attended + h.noShow;
                  return (
                    <li
                      key={p.id}
                      className="flex flex-wrap items-center justify-between gap-3 border-b border-rule py-3"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <Avatar avatarUrl={p.avatarUrl} displayName={p.displayName} />
                        <div className="min-w-0">
                          <span className="font-bold">
                            <ActorName name={p.displayName} emojis={p.emojis} />
                          </span>
                          {p.handle && (
                            <span className="meta-mono ml-2 text-sm text-neutral">
                              @{p.handle}
                              {p.domain && `@${p.domain}`}
                            </span>
                          )}
                          <div className="meta-mono mt-0.5 text-sm text-neutral">
                            {STATUS_LABEL[p.status] ?? p.status}
                            {' · 過去実績 '}
                            {total === 0 ? '記録なし' : `出席 ${h.attended} / ${total} 回`}
                            {p.attendanceStatus && (
                              <span className="ml-2 font-bold text-ink">
                                [{p.attendanceStatus === 'attended' ? '出席' : '無断欠席'}]
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {/* 手動選定 / 判定操作 */}
                        {canLottery &&
                          (p.status === 'applied' || p.status === 'waitlisted') && (
                            <form method="post" action={`/participations/${p.id}/decide`}>
                              <input type="hidden" name="decision" value="accepted" />
                              <button type="submit" className="btn-quiet cursor-pointer text-sm">
                                当選
                              </button>
                            </form>
                          )}
                        {canLottery && p.status === 'applied' && (
                          <>
                            <form method="post" action={`/participations/${p.id}/decide`}>
                              <input type="hidden" name="decision" value="waitlisted" />
                              <button type="submit" className="btn-quiet cursor-pointer text-sm">
                                補欠
                              </button>
                            </form>
                            <form method="post" action={`/participations/${p.id}/decide`}>
                              <input type="hidden" name="decision" value="rejected" />
                              <button type="submit" className="btn-quiet cursor-pointer text-sm">
                                落選
                              </button>
                            </form>
                          </>
                        )}
                        {/* 支払い管理 */}
                        {p.paymentId && p.paymentStatus && (
                          <span
                            className={`border px-2 py-1 text-sm font-bold ${
                              p.paymentStatus === 'paid' || p.paymentStatus === 'waived'
                                ? 'border-accent-2 text-accent-2'
                                : 'border-accent text-accent'
                            }`}
                          >
                            {PAYMENT_LABEL[p.paymentStatus]}
                            {p.paymentAmount != null && ` ¥${YEN.format(p.paymentAmount)}`}
                          </span>
                        )}
                        {canAttendance && p.paymentId && p.paymentStatus === 'pending' && (
                          <form method="post" action={`/payments/${p.paymentId}/mark`}>
                            <input type="hidden" name="status" value="paid" />
                            <button type="submit" className="btn-quiet cursor-pointer text-sm">
                              支払済みにする
                            </button>
                          </form>
                        )}
                        {canAttendance &&
                          p.paymentId &&
                          p.paymentStatus === 'refund_required' && (
                            <form method="post" action={`/payments/${p.paymentId}/mark`}>
                              <input type="hidden" name="status" value="refunded" />
                              <button type="submit" className="btn-quiet cursor-pointer text-sm">
                                返金済みにする
                              </button>
                            </form>
                          )}
                        {/* 出欠記録(確定者のみ) */}
                        {canAttendance && p.status === 'accepted' && (
                          <>
                            <form method="post" action={`/participations/${p.id}/attendance`}>
                              <input type="hidden" name="status" value="attended" />
                              <button type="submit" className="btn-quiet cursor-pointer text-sm">
                                出席
                              </button>
                            </form>
                            <form method="post" action={`/participations/${p.id}/attendance`}>
                              <input type="hidden" name="status" value="no_show" />
                              <button type="submit" className="btn-quiet cursor-pointer text-sm">
                                無断欠席
                              </button>
                            </form>
                          </>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}
    </>
  );
}
