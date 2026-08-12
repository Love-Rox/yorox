'use client';
/**
 * 「1つ以上必須」の複数選択を、送信前のネイティブ検証で通知するための群。
 *
 * checkbox の required 属性は「その1つが必須」の意味しかなく、
 * 群として「最低1つ」を表せない。そこで未選択の間だけ全 checkbox に
 * required を付け、1つでも選ばれたら全部から外す。これでブラウザの
 * 標準バリデーション(送信前の吹き出し)が効く。
 */
import { useState } from 'react';

export function RequiredCheckboxGroup({
  name,
  options,
}: {
  name: string;
  options: string[];
}) {
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const stillRequired = checked.size === 0;
  return (
    <div className="mt-1 space-y-1">
      {options.map((opt, i) => (
        <label key={i} className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name={name}
            value={opt}
            required={stillRequired}
            onChange={(e) =>
              setChecked((prev) => {
                const next = new Set(prev);
                if (e.target.checked) next.add(opt);
                else next.delete(opt);
                return next;
              })
            }
          />
          {opt}
        </label>
      ))}
    </div>
  );
}
