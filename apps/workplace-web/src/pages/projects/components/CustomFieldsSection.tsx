// 이슈 상세 — 정의된 모든 커스텀 필드 인라인 편집 섹션 (Phase 4c).
// 변경 시 필드별 300ms debounce 후 그 필드만 PUT. 값 없는 정의는 placeholder 로 노출.

import { useEffect, useMemo, useRef, useState } from 'react';

import { CustomFieldEditor } from '../../../components/customFields/CustomFieldEditor';
import { useCustomFields } from '../../../hooks/queries/useCustomFields';
import { useUpdateIssueFields } from '../../../hooks/queries/useUpdateIssueFields';
import type { IssueFieldEntry } from '../../../types/customField';

export function CustomFieldsSection({
  projectKey,
  issueNumber,
  current,
  disabled = false,
}: {
  projectKey: string;
  issueNumber: number;
  current: IssueFieldEntry[];
  /** 워크플로 편집 권한 없음(OPEN 비멤버) — 서버가 멤버만 저장을 허용해 고르면 403 이었다(WP-503). */
  disabled?: boolean;
}) {
  const defs = useCustomFields(projectKey);
  const update = useUpdateIssueFields(projectKey, issueNumber);

  // 서버 값을 defId → value Map 으로 정규화 (diff 비교용 원본).
  const initialMap = useMemo(() => {
    const m = new Map<number, unknown>();
    for (const e of current) m.set(e.defId, e.value);
    return m;
  }, [current]);

  // 아직 보내지 않은 변경 — 필드마다 마지막 값과 debounce 타이머를 따로 둔다(WP-503).
  // 예전엔 타이머 하나를 공유해 300ms 안에 다른 필드를 바꾸면 앞 필드의 저장이 취소돼 입력이 조용히 사라졌다.
  // 한 PUT 에 묶지 않는 이유: 서버는 목록을 한 트랜잭션으로 검증해, 한 필드가 거절되면 같이 보낸 다른 필드도 저장되지 않는다.
  const pending = useRef(new Map<number, { value: unknown; timer: ReturnType<typeof setTimeout> }>());

  // 로컬 편집 상태 — 사용자 입력 즉시 반영, PUT 은 debounce 후.
  // 서버 값이 새로 오면 덮어쓰되, 아직 보내지 않은 필드는 입력 중인 값을 지킨다(다른 필드 저장 뒤 재조회가 입력을 되돌리지 않게).
  const [draft, setDraft] = useState<Map<number, unknown>>(initialMap);
  useEffect(() => {
    setDraft((prev) => {
      const next = new Map(initialMap);
      for (const id of pending.current.keys()) next.set(id, prev.get(id));
      return next;
    });
  }, [initialMap]);

  // 한 필드의 대기 중 변경을 보낸다. 서버 값과 같아도 보낸다 — 앞 저장이 아직 반영되기 전에 원래 값으로 되돌린 경우를 놓치지 않으려고.
  const { mutate } = update;
  function flush(defId: number) {
    const entry = pending.current.get(defId);
    if (!entry) return;
    clearTimeout(entry.timer);
    pending.current.delete(defId);
    mutate([{ defId, value: entry.value }]);
  }

  function schedule(defId: number, value: unknown) {
    setDraft((prev) => {
      const next = new Map(prev);
      next.set(defId, value);
      return next;
    });
    clearTimeout(pending.current.get(defId)?.timer);
    pending.current.set(defId, { value, timer: setTimeout(() => flush(defId), 300) });
  }

  // 언마운트(시트 닫기·그룹 접기·이동) 때 기다리던 변경은 버리지 않고 바로 보낸다.
  useEffect(() => {
    const waiting = pending.current;
    return () => {
      for (const [defId, { value, timer }] of waiting) {
        clearTimeout(timer);
        mutate([{ defId, value }]);
      }
      waiting.clear();
    };
  }, [mutate]);

  if (!defs.data || defs.data.length === 0) return null;

  return (
    <section
      className="space-y-2"
      aria-label="커스텀 필드"
      data-testid="custom-fields-section"
    >
      {/* 그룹 카드 제목(커스텀 필드)이 이미 있으므로 내부 헤딩 제거(중복). */}
      <div className="space-y-2">
        {defs.data.map((d) => (
          <div key={d.id} className="space-y-1">
            <label className="text-xs text-muted-foreground">{d.name}</label>
            <CustomFieldEditor
              def={d}
              value={draft.get(d.id) ?? null}
              onChange={(v) => schedule(d.id, v)}
              disabled={disabled}
            />
          </div>
        ))}
      </div>
    </section>
  );
}
