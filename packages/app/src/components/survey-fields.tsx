/**
 * 申込フォームに出すアンケート回答欄(表示用)。
 * サーバー側は survey_<questionId> という名前で回答を受け取る。
 * 複数選択は同名 checkbox の配列(parseBody({ all: true }))。
 */
import type { SurveyQuestion } from '../db/schema';

export function SurveyFields({ questions }: { questions: SurveyQuestion[] }) {
  if (questions.length === 0) return null;
  return (
    <div className="mb-3 space-y-3 text-left">
      {questions.map((q) => {
        const fieldName = `survey_${q.id}`;
        return (
          <div key={q.id}>
            <span className="block text-sm font-bold">
              {q.label}
              {q.required && <span className="ml-1 text-accent">*</span>}
            </span>
            {q.type === 'text' &&
              (q.multiline ? (
                <textarea
                  name={fieldName}
                  rows={3}
                  required={q.required}
                  maxLength={2000}
                  className="input mt-1 w-full"
                />
              ) : (
                <input
                  type="text"
                  name={fieldName}
                  required={q.required}
                  maxLength={2000}
                  className="input mt-1 w-full"
                />
              ))}
            {q.type === 'single' && (
              <div className="mt-1 space-y-1">
                {(q.options ?? []).map((opt, i) => (
                  <label key={i} className="flex items-center gap-2 text-sm">
                    <input type="radio" name={fieldName} value={opt} required={q.required} />
                    {opt}
                  </label>
                ))}
              </div>
            )}
            {q.type === 'multiple' && (
              <div className="mt-1 space-y-1">
                {(q.options ?? []).map((opt, i) => (
                  <label key={i} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name={fieldName} value={opt} />
                    {opt}
                  </label>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
