import { describe, expect, it } from 'vitest';
import {
  effectiveSurvey,
  hasRequiredQuestions,
  parseSurveyDefinition,
  validateAndSnapshotAnswers,
} from './survey';
import type { SurveyQuestion } from '../db/schema';

describe('parseSurveyDefinition', () => {
  it('正常な定義をパースする', () => {
    const def = parseSurveyDefinition(
      JSON.stringify([
        { id: 'diet', label: '食事制限は？', type: 'text', required: true, multiline: true },
        { id: 'join', label: '懇親会に参加？', type: 'single', required: false, options: ['はい', 'いいえ'] },
      ]),
    );
    expect(def).toHaveLength(2);
    expect(def?.[0]).toMatchObject({ id: 'diet', type: 'text', required: true, multiline: true });
    expect(def?.[1]?.options).toEqual(['はい', 'いいえ']);
  });

  it('選択肢の無い選択式は落とす', () => {
    const def = parseSurveyDefinition([{ label: 'x', type: 'single', options: [] }]);
    expect(def).toBeNull();
  });

  it('ラベル空・空配列は null', () => {
    expect(parseSurveyDefinition([{ label: '', type: 'text' }])).toBeNull();
    expect(parseSurveyDefinition([])).toBeNull();
    expect(parseSurveyDefinition('not json')).toBeNull();
  });

  it('重複 ID は振り直す', () => {
    const def = parseSurveyDefinition([
      { id: 'a', label: 'Q1', type: 'text' },
      { id: 'a', label: 'Q2', type: 'text' },
    ]);
    expect(def?.[0]?.id).not.toEqual(def?.[1]?.id);
  });

  it('質問数の上限で切り捨てる', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ label: `Q${i}`, type: 'text' }));
    expect(parseSurveyDefinition(many)).toHaveLength(20);
  });
});

describe('effectiveSurvey / hasRequiredQuestions', () => {
  const ev: SurveyQuestion[] = [{ id: 'a', label: 'A', type: 'text', required: false }];
  const slot: SurveyQuestion[] = [{ id: 'b', label: 'B', type: 'text', required: true }];

  it('イベント共通の後に枠固有を並べる', () => {
    expect(effectiveSurvey(ev, slot).map((q) => q.id)).toEqual(['a', 'b']);
  });

  it('必須の有無を判定する', () => {
    expect(hasRequiredQuestions(effectiveSurvey(ev, slot))).toBe(true);
    expect(hasRequiredQuestions(effectiveSurvey(ev, null))).toBe(false);
  });
});

describe('validateAndSnapshotAnswers', () => {
  const questions: SurveyQuestion[] = [
    { id: 'diet', label: '食事制限', type: 'text', required: true },
    { id: 'party', label: '懇親会', type: 'single', required: false, options: ['はい', 'いいえ'] },
    { id: 'topics', label: '興味分野', type: 'multiple', required: false, options: ['FE', 'BE'] },
  ];

  it('必須未回答はエラー', () => {
    const r = validateAndSnapshotAnswers(questions, () => undefined);
    expect(r.ok).toBe(false);
  });

  it('正常回答をスナップショット化する', () => {
    const answers: Record<string, string | string[]> = {
      diet: '  ベジタリアン  ',
      party: 'はい',
      topics: ['FE', 'BE'],
    };
    const r = validateAndSnapshotAnswers(questions, (id) => answers[id]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.answers).toEqual([
        { questionId: 'diet', label: '食事制限', type: 'text', value: 'ベジタリアン' },
        { questionId: 'party', label: '懇親会', type: 'single', value: 'はい' },
        { questionId: 'topics', label: '興味分野', type: 'multiple', value: ['FE', 'BE'] },
      ]);
    }
  });

  it('定義外の選択肢は拒否/除外する', () => {
    const single = validateAndSnapshotAnswers(questions, (id) => (id === 'diet' ? 'x' : id === 'party' ? '不正' : undefined));
    expect(single.ok).toBe(false);
    const multi = validateAndSnapshotAnswers(questions, (id) =>
      id === 'diet' ? 'x' : id === 'topics' ? ['FE', '注入'] : undefined,
    );
    expect(multi.ok).toBe(true);
    if (multi.ok) {
      const topics = multi.answers.find((a) => a.questionId === 'topics');
      expect(topics?.value).toEqual(['FE']);
    }
  });

  it('必須の複数選択は最低1つ必要', () => {
    const req: SurveyQuestion[] = [
      { id: 't', label: 'T', type: 'multiple', required: true, options: ['a', 'b'] },
    ];
    expect(validateAndSnapshotAnswers(req, () => []).ok).toBe(false);
    expect(validateAndSnapshotAnswers(req, () => ['a']).ok).toBe(true);
  });
});
