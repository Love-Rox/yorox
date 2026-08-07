/**
 * 抽選ロジック。純粋関数(DB 非依存)。
 *
 * - random: 完全ランダム
 * - weighted: 出欠率による重み付け
 *   コールドスタート保護: 実績母数が少ない申込者は中立の重みにする
 * - manual: 主催の手動選定(ここでは扱わない。UI から直接 accepted を付ける)
 */

export interface LotteryApplicant {
  participationId: string;
  /** 出席回数(attended) */
  attendedCount?: number;
  /** no-show 回数 */
  noShowCount?: number;
}

/** 一様乱数で配列をシャッフル(Fisher–Yates) */
function shuffle<T>(items: T[], random: () => number): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
}

function defaultRandom(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0]! / 0x100000000;
}

/** 完全ランダム抽選。当選者の participationId 集合を返す */
export function drawRandom(
  applicants: LotteryApplicant[],
  capacity: number,
  random: () => number = defaultRandom,
): Set<string> {
  const winners = shuffle(applicants, random).slice(0, capacity);
  return new Set(winners.map((a) => a.participationId));
}

/** コールドスタート保護の閾値: 実績がこれ未満なら中立重み */
const MIN_HISTORY_FOR_WEIGHT = 3;

/**
 * 出欠率の重みを計算する。
 * 重み = 出席率(attended / (attended + noShow))。実績が少なければ中立 (0.5)。
 * 全員 no-show でも当選確率が 0 にならないよう下限を設ける。
 */
export function attendanceWeight(applicant: LotteryApplicant): number {
  const attended = applicant.attendedCount ?? 0;
  const noShow = applicant.noShowCount ?? 0;
  const total = attended + noShow;
  if (total < MIN_HISTORY_FOR_WEIGHT) return 0.5;
  const rate = attended / total;
  return Math.max(0.1, rate);
}

/**
 * 重み付き抽選(重みに比例した確率で非復元抽出)。
 */
export function drawWeighted(
  applicants: LotteryApplicant[],
  capacity: number,
  random: () => number = defaultRandom,
): Set<string> {
  const pool = applicants.map((a) => ({ id: a.participationId, w: attendanceWeight(a) }));
  const winners = new Set<string>();
  while (winners.size < capacity && pool.length > 0) {
    const totalW = pool.reduce((s, p) => s + p.w, 0);
    let r = random() * totalW;
    let picked = pool.length - 1;
    for (let i = 0; i < pool.length; i++) {
      r -= pool[i]!.w;
      if (r <= 0) {
        picked = i;
        break;
      }
    }
    winners.add(pool[picked]!.id);
    pool.splice(picked, 1);
  }
  return winners;
}
