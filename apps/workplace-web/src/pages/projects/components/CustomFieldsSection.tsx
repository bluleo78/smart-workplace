// 이슈 상세 — 정의된 모든 커스텀 필드 인라인 편집 섹션 (Phase 4c).
// 변경 시 300ms debounce 후 변경된 필드만 PUT. 값 없는 정의는 placeholder 로 노출.

import { useEffect, useMemo, useRef, useState } from 'react';

import { CustomFieldEditor } from '../../../components/customFields/CustomFieldEditor';
import { useCustomFields } from '../../../hooks/queries/useCustomFields';
import { useUpdateIssueFields } from '../../../hooks/queries/useUpdateIssueFields';
import type { IssueFieldEntry } from '../../../types/customField';

export function CustomFieldsSection({
  projectKey,
  issueNumber,
  current,
}: {
  projectKey: string;
  issueNumber: number;
  current: IssueFieldEntry[];
}) {
  const defs = useCustomFields(projectKey);
  const update = useUpdateIssueFields(projectKey, issueNumber);

  // 서버 값을 defId → value Map 으로 정규화 (diff 비교용 원본).
  const initialMap = useMemo(() => {
    const m = new Map<number, unknown>();
    for (const e of current) m.set(e.defId, e.value);
    return m;
  }, [current]);

  // 로컬 편집 상태 — 사용자 입력 즉시 반영, PUT 은 debounce 후.
  const [draft, setDraft] = useState<Map<number, unknown>>(initialMap);
  useEffect(() => {
    setDraft(initialMap);
  }, [initialMap]);

  // debounce — 한 필드를 빠르게 타이핑할 때 마지막 값만 PUT.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function schedule(defId: number, value: unknown) {
    setDraft((prev) => {
      const next = new Map(prev);
      next.set(defId, value);
      return next;
    });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      // 서버 값과 동일하면 PUT 생략. JSON.stringify 로 깊은 비교.
      const prevVal = initialMap.get(defId) ?? null;
      if (JSON.stringify(prevVal) === JSON.stringify(value)) return;
      update.mutate([{ defId, value }]);
    }, 300);
  }

  // 언마운트 시 잔여 타이머 정리.
  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  if (!defs.data || defs.data.length === 0) return null;

  return (
    <section
      className="space-y-2"
      aria-label="커스텀 필드"
      data-testid="custom-fields-section"
    >
      <h3 className="text-sm font-medium">커스텀 필드</h3>
      <div className="space-y-2">
        {defs.data.map((d) => (
          <div key={d.id} className="space-y-1">
            <label className="text-xs text-muted-foreground">{d.name}</label>
            <CustomFieldEditor
              def={d}
              value={draft.get(d.id) ?? null}
              onChange={(v) => schedule(d.id, v)}
            />
          </div>
        ))}
      </div>
    </section>
  );
}
