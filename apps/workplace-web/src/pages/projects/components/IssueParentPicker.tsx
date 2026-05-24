// SUBTASK 부모 number 인라인 편집기 (Phase 4a).
// 양의 정수만 허용. 빈 문자열로 저장하면 부모 해제 (null).
// 향후 검색 UI 로 확장할 여지 — 현재는 직접 입력.

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

import { useUpdateIssueParent } from '../../../hooks/queries/useUpdateIssueParent';

export function IssueParentPicker({
  projectKey,
  issueNumber,
  currentParentNumber,
  onClose,
}: {
  projectKey: string;
  issueNumber: number;
  currentParentNumber: number | null;
  onClose: () => void;
}) {
  const update = useUpdateIssueParent(projectKey, issueNumber);
  const [value, setValue] = useState(
    currentParentNumber == null ? '' : String(currentParentNumber),
  );

  // 저장 핸들러 — 빈 문자열 → null(해제), 양의 정수 → number 전달.
  // mutation 의 성공/실패 토스트는 훅 내부에서 처리. 성공 시에만 닫는다.
  async function onSave() {
    const trimmed = value.trim();
    if (trimmed === '') {
      try {
        await update.mutateAsync(null);
        onClose();
      } catch {
        // 에러 토스트는 훅에서 표시. 다이얼로그는 열어두어 재시도 가능하게.
      }
      return;
    }
    const n = Number(trimmed);
    if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) return;
    try {
      await update.mutateAsync(n);
      onClose();
    } catch {
      // 동일 — 에러 시 모달 유지.
    }
  }

  return (
    <div className="space-y-2" data-testid="issue-parent-picker">
      <label className="text-sm font-medium" htmlFor="parent-number-input">
        부모 이슈 번호
      </label>
      <Input
        id="parent-number-input"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="예: 12 (비우면 해제)"
        type="number"
        min={1}
        data-testid="parent-number-input"
      />
      <div className="flex gap-2 justify-end">
        <Button variant="ghost" size="sm" onClick={onClose} type="button">
          취소
        </Button>
        <Button
          size="sm"
          onClick={onSave}
          disabled={update.isPending}
          type="button"
          data-testid="parent-save"
        >
          저장
        </Button>
      </div>
    </div>
  );
}
