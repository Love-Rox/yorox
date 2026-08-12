'use client';
/**
 * 申込アンケートの編集 UI(主催者用)。
 *
 * 質問の配列を管理し、送信用の hidden input(既定名 survey_json)へ
 * JSON をシリアライズする。サーバー側は domain/survey.ts の
 * parseSurveyDefinition で再検証・サニタイズする。
 */
import { useId, useState } from 'react';
import type { ApplicationSurvey, SurveyQuestionType } from '../db/schema';

type Row = {
  key: number;
  id: string;
  label: string;
  type: SurveyQuestionType;
  required: boolean;
  multiline: boolean;
  /** 選択肢を改行区切りで編集する */
  optionsText: string;
};

let keySeq = 0;

function toRow(q: ApplicationSurvey[number]): Row {
  return {
    key: keySeq++,
    id: q.id,
    label: q.label,
    type: q.type,
    required: q.required,
    multiline: q.multiline ?? false,
    optionsText: (q.options ?? []).join('\n'),
  };
}

function serialize(rows: Row[]): string {
  const out = rows
    .filter((r) => r.label.trim())
    .map((r, i) => {
      const base: Record<string, unknown> = {
        id: r.id || `q${i + 1}`,
        label: r.label.trim(),
        type: r.type,
        required: r.required,
      };
      if (r.type === 'text') {
        if (r.multiline) base.multiline = true;
      } else {
        base.options = r.optionsText
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean);
      }
      return base;
    })
    // 選択式は選択肢が無いと無効なので送らない
    .filter((q) => q.type === 'text' || ((q.options as string[]).length ?? 0) > 0);
  return out.length > 0 ? JSON.stringify(out) : '';
}

export function SurveyBuilder({
  name = 'survey_json',
  initial,
}: {
  name?: string;
  initial?: ApplicationSurvey | null | undefined;
}) {
  const [rows, setRows] = useState<Row[]>(() => (initial ?? []).map(toRow));
  const baseId = useId();

  const update = (key: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const remove = (key: number) => setRows((rs) => rs.filter((r) => r.key !== key));
  const move = (key: number, dir: -1 | 1) =>
    setRows((rs) => {
      const i = rs.findIndex((r) => r.key === key);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= rs.length) return rs;
      const next = [...rs];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });
  const add = () =>
    setRows((rs) => [
      ...rs,
      {
        key: keySeq++,
        id: `q${rs.length + 1}`,
        label: '',
        type: 'text',
        required: false,
        multiline: false,
        optionsText: '',
      },
    ]);

  return (
    <div>
      <input type="hidden" name={name} value={serialize(rows)} />
      {rows.length === 0 && (
        <p className="text-sm text-neutral">質問はありません。「質問を追加」で作成できます。</p>
      )}
      <ol className="space-y-3">
        {rows.map((r, i) => (
          <li key={r.key} className="border-2 border-ink p-3">
            <div className="flex items-start gap-2">
              <span className="meta-mono mt-2 text-neutral">{i + 1}.</span>
              <div className="flex-1 space-y-2">
                <input
                  type="text"
                  value={r.label}
                  onChange={(e) => update(r.key, { label: e.target.value })}
                  placeholder="質問文(例: 食事制限はありますか？)"
                  maxLength={200}
                  className="input w-full"
                  aria-label="質問文"
                />
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  <label className="flex items-center gap-1">
                    形式
                    <select
                      value={r.type}
                      onChange={(e) =>
                        update(r.key, { type: e.target.value as SurveyQuestionType })
                      }
                      className="input"
                      aria-label="回答形式"
                    >
                      <option value="text">自由記述</option>
                      <option value="single">単一選択</option>
                      <option value="multiple">複数選択</option>
                    </select>
                  </label>
                  <label className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={r.required}
                      onChange={(e) => update(r.key, { required: e.target.checked })}
                    />
                    必須
                  </label>
                  {r.type === 'text' && (
                    <label className="flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={r.multiline}
                        onChange={(e) => update(r.key, { multiline: e.target.checked })}
                      />
                      複数行
                    </label>
                  )}
                </div>
                {(r.type === 'single' || r.type === 'multiple') && (
                  <label className="block text-sm">
                    選択肢(1行に1つ)
                    <textarea
                      value={r.optionsText}
                      onChange={(e) => update(r.key, { optionsText: e.target.value })}
                      rows={3}
                      placeholder={'はい\nいいえ'}
                      className="input mt-1 w-full"
                    />
                  </label>
                )}
              </div>
              <div className="flex flex-col gap-1">
                <button
                  type="button"
                  onClick={() => move(r.key, -1)}
                  disabled={i === 0}
                  className="cursor-pointer px-2 text-neutral hover:text-ink disabled:opacity-30"
                  aria-label="上へ"
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => move(r.key, 1)}
                  disabled={i === rows.length - 1}
                  className="cursor-pointer px-2 text-neutral hover:text-ink disabled:opacity-30"
                  aria-label="下へ"
                >
                  ↓
                </button>
                <button
                  type="button"
                  onClick={() => remove(r.key)}
                  className="cursor-pointer px-2 text-neutral hover:text-accent"
                  aria-label={`${baseId}-remove`}
                >
                  ✕
                </button>
              </div>
            </div>
          </li>
        ))}
      </ol>
      <button type="button" onClick={add} className="btn-quiet mt-3 cursor-pointer text-sm">
        質問を追加
      </button>
    </div>
  );
}
