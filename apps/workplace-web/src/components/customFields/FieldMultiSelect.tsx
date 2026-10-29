// MULTI_SELECT 타입 위젯 — 옵션 토글 칩. 빈 집합은 null 로 변환 (row 삭제).

import type { IssueFieldDef } from '../../types/customField';

export function FieldMultiSelect({
  def,
  value,
  onChange,
  disabled = false,
}: {
  def: IssueFieldDef;
  value: string[] | null;
  onChange: (next: string[] | null) => void;
  disabled?: boolean;
}) {
  const set = new Set(value ?? []);
  function toggle(opt: string) {
    const next = new Set(set);
    if (next.has(opt)) next.delete(opt);
    else next.add(opt);
    onChange(next.size === 0 ? null : Array.from(next));
  }
  return (
    <div
      className="flex flex-wrap gap-1"
      role="group"
      aria-label={def.name}
      data-testid={`field-input-${def.id}`}
    >
      {(def.options ?? []).map((opt) => (
        <button
          key={opt}
          type="button"
          onClick={() => toggle(opt)}
          disabled={disabled}
          aria-pressed={set.has(opt)}
          // max-w-full + wrap-anywhere: 띄어쓰기 없는 긴 옵션(영문·URL·코드값, 최대 40자)도 칩 안에서 줄바꿈해
          // 카드·시트 폭을 넘지 않게 한다 — 한글 옵션처럼 전체 이름이 보인다(WP-1122). text-left 는 줄바꿈된 줄 정렬.
          className={`max-w-full text-left wrap-anywhere px-2 py-0.5 rounded text-xs border disabled:opacity-50 ${
            set.has(opt) ? 'bg-primary text-primary-foreground' : 'bg-background'
          }`}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}
