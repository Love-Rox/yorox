/**
 * 申込アンケートのドメインロジック。
 *
 * - 定義(質問リスト)のパース/サニタイズ(主催者フォーム由来の untrusted 入力)
 * - 有効質問の合成(イベント共通 + 枠固有)
 * - 回答の検証とスナップショット化(申込時)
 *
 * 保存形は schema.ts の ApplicationSurvey / SurveyAnswer。
 */
import type {
  ApplicationSurvey,
  SurveyAnswer,
  SurveyQuestion,
  SurveyQuestionType,
} from '../db/schema';

const MAX_QUESTIONS = 20;
const MAX_OPTIONS = 20;
const MAX_LABEL = 200;
const MAX_OPTION = 100;
const MAX_ANSWER = 2000;
const QUESTION_TYPES: SurveyQuestionType[] = ['text', 'single', 'multiple'];

/** 制御文字を除去して長さ制限する */
function clean(v: unknown, max: number): string {
  if (typeof v !== 'string') return '';
  return v.replace(/\p{Cc}/gu, '').trim().slice(0, max);
}

/**
 * 主催者が入力したアンケート定義(JSON)をパース・サニタイズする。
 * 不正な質問は落とし、上限を超えた分は切り捨てる。空なら null。
 */
export function parseSurveyDefinition(raw: unknown): ApplicationSurvey | null {
  let arr: unknown = raw;
  if (typeof raw === 'string') {
    const s = raw.trim();
    if (!s) return null;
    try {
      arr = JSON.parse(s);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(arr)) return null;

  const questions: SurveyQuestion[] = [];
  const seenIds = new Set<string>();
  for (const item of arr.slice(0, MAX_QUESTIONS)) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const label = clean(o.label, MAX_LABEL);
    if (!label) continue;
    const type: SurveyQuestionType = QUESTION_TYPES.includes(o.type as SurveyQuestionType)
      ? (o.type as SurveyQuestionType)
      : 'text';

    // ID は安定させたいので入力を尊重しつつ、無効/重複なら振り直す
    let id = clean(o.id, 32).replace(/[^a-zA-Z0-9_-]/g, '');
    if (!id || seenIds.has(id)) id = `q${questions.length + 1}`;
    while (seenIds.has(id)) id = `${id}_`;
    seenIds.add(id);

    const question: SurveyQuestion = { id, label, type, required: o.required === true };

    if (type === 'single' || type === 'multiple') {
      const rawOptions = Array.isArray(o.options) ? o.options : [];
      const options = rawOptions
        .map((x) => clean(x, MAX_OPTION))
        .filter((x, i, a) => x && a.indexOf(x) === i)
        .slice(0, MAX_OPTIONS);
      if (options.length === 0) continue; // 選択肢の無い選択式は無効
      question.options = options;
    } else if (o.multiline === true) {
      question.multiline = true;
    }
    questions.push(question);
  }
  return questions.length > 0 ? questions : null;
}

/** イベント共通 + 枠固有の有効質問を合成する(表示順もこの順) */
export function effectiveSurvey(
  eventSurvey: ApplicationSurvey | null | undefined,
  slotSurvey: ApplicationSurvey | null | undefined,
): SurveyQuestion[] {
  return [...(eventSurvey ?? []), ...(slotSurvey ?? [])];
}

/** 有効質問に必須のものが1つでもあるか */
export function hasRequiredQuestions(questions: SurveyQuestion[]): boolean {
  return questions.some((q) => q.required);
}

export type AnswerValidation =
  | { ok: true; answers: SurveyAnswer[] }
  | { ok: false; error: string };

/**
 * フォーム回答を検証し、保存用スナップショットに変換する。
 * @param questions 有効質問(effectiveSurvey の結果)
 * @param get questionId に対する生の回答を返す。text/single は string、
 *            multiple は string[](チェックされた値)。未回答は undefined。
 */
export function validateAndSnapshotAnswers(
  questions: SurveyQuestion[],
  get: (questionId: string) => string | string[] | undefined,
): AnswerValidation {
  const answers: SurveyAnswer[] = [];
  for (const q of questions) {
    const raw = get(q.id);
    if (q.type === 'multiple') {
      const selectedRaw = Array.isArray(raw) ? raw : raw !== undefined ? [raw] : [];
      const allowed = new Set(q.options ?? []);
      const selected = selectedRaw
        .map((v) => (typeof v === 'string' ? v.trim() : ''))
        .filter((v) => allowed.has(v));
      if (q.required && selected.length === 0) {
        return { ok: false, error: `「${q.label}」は1つ以上選んでください` };
      }
      if (selected.length > 0) {
        answers.push({ questionId: q.id, label: q.label, type: q.type, value: selected });
      }
      continue;
    }

    const value = typeof raw === 'string' ? raw.trim().slice(0, MAX_ANSWER) : '';
    if (!value) {
      if (q.required) return { ok: false, error: `「${q.label}」は必須です` };
      continue;
    }
    if (q.type === 'single' && !(q.options ?? []).includes(value)) {
      return { ok: false, error: `「${q.label}」の回答が不正です` };
    }
    answers.push({ questionId: q.id, label: q.label, type: q.type, value });
  }
  return { ok: true, answers };
}

/** 回答を1行のテキストにする(CSV/一覧表示用) */
export function answerToText(answer: SurveyAnswer): string {
  return Array.isArray(answer.value) ? answer.value.join(' / ') : answer.value;
}
