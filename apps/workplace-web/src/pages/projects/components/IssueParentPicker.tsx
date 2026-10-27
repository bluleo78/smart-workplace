// 부모 인라인 편집기 (Phase 4a). 빈 문자열로 저장하면 부모 해제 (null) — 단 SUBTASK 는 부모가 필수라 비워 저장할 수 없다(WP-745).
// 상위 에픽(SUBTASK 아님)은 번호를 몰라도 제목 일부로 찾아 고른다(WP-1018) — 같은 프로젝트의 열린 에픽이 후보로 뜨고,
// 위·아래·Enter 로 고르면 바로 연결한다. 번호를 그대로 입력해 저장하는 기존 방식도 그대로다. SUBTASK 부모는 번호 입력만 둔다.
// 친 번호(목록에 없는 번호)·빈 값(해제)은 맨 위 항목으로 둔다 — cmdk 가 첫 항목을 저절로 고르므로 바로 Enter 하면 친 값이 저장되고,
// 화살표로 옮기면 그 후보가 저장된다(「7」을 쳤는데 제목에 「1.7」이 든 에픽이 연결되거나, 비우고 Enter 했는데 첫 에픽이 연결되지 않게).

import { useState } from 'react';

import { EpicColorDot } from '@/components/issues/EpicColorDot';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Input } from '@/components/ui/input';

import { useProjectEpics } from '../../../hooks/queries/useProjectEpics';
import { useUpdateIssueParent } from '../../../hooks/queries/useUpdateIssueParent';
import { matchEpicCandidates, parseIssueNumberQuery } from '../../../lib/epicCandidates';

export function IssueParentPicker({
  projectKey,
  issueNumber,
  currentParentNumber,
  isSubtask = false,
  onClose,
}: {
  projectKey: string;
  issueNumber: number;
  currentParentNumber: number | null;
  /** SUBTASK 면 부모 해제(빈 값 저장)를 막는다 — 서버도 400 으로 거절한다. */
  isSubtask?: boolean;
  onClose: () => void;
}) {
  const update = useUpdateIssueParent(projectKey, issueNumber);
  const [value, setValue] = useState(
    currentParentNumber == null ? '' : String(currentParentNumber),
  );
  // 에픽 후보 — 행 메뉴·모바일 에픽 시트와 같은 목록(열린 에픽, 캐시 공유). SUBTASK 부모 편집에서는 부르지 않는다(빈 목록).
  const { epics, loading } = useProjectEpics(projectKey, !isSubtask);
  const candidates = matchEpicCandidates(epics, value);
  const trimmed = value.trim();
  const parsed = parseIssueNumberQuery(value);

  // 맨 위 「친 값」 항목 — 후보에 없는 번호면 그 번호로 연결, 비웠고 부모가 있으면 해제. 그 밖엔 없다.
  const typedOption: { parentNumber: number | null; label: string } | null =
    parsed != null && !candidates.some((e) => e.number === parsed)
      ? { parentNumber: parsed, label: `#${parsed} 로 연결` }
      : trimmed === '' && currentParentNumber != null
        ? { parentNumber: null, label: '상위 에픽 해제' }
        : null;

  // 저장 — null 이면 해제, 수면 그 번호로 연결. mutation 의 성공/실패 토스트는 훅 내부에서 처리. 성공 시에만 닫는다.
  async function save(parentNumber: number | null) {
    try {
      await update.mutateAsync(parentNumber);
      onClose();
    } catch {
      // 에러 토스트는 훅에서 표시. 편집기는 열어두어 재시도 가능하게.
    }
  }

  // 저장 버튼 — 빈 문자열 → null(해제), 번호 → 그 번호. 번호가 아닌 글자는 후보에서 고르게 둔다(버튼 비활성).
  function onSave() {
    if (trimmed === '') {
      if (!isSubtask) void save(null);
      return;
    }
    if (parsed != null) void save(parsed);
  }

  const saveDisabled = update.isPending || (trimmed === '' ? isSubtask : parsed == null);

  return (
    <div className="space-y-2" data-testid="issue-parent-picker">
      {isSubtask ? (
        <>
          <label className="text-sm font-medium" htmlFor="parent-number-input">
            부모 이슈 번호
          </label>
          <Input
            id="parent-number-input"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="예: 12"
            type="number"
            min={1}
            data-testid="parent-number-input"
          />
        </>
      ) : (
        <>
          {/* cmdk 가 입력 id 를 스스로 정해 htmlFor 로 이을 수 없다 — 읽기용 이름은 Command 의 label 이 맡는다. */}
          <p className="text-sm font-medium" aria-hidden>
            에픽 번호 또는 제목
          </p>
          {/* 서버 검색 대신 받아 둔 에픽 목록을 직접 거른다(shouldFilter=false) — cmdk 는 위·아래·Enter 고르기만 맡는다. */}
          <Command shouldFilter={false} label="에픽 번호 또는 제목" className="rounded-md border">
            <CommandInput
              value={value}
              onValueChange={setValue}
              placeholder="예: 12 또는 v1.7 (비우면 해제)"
              data-testid="parent-number-input"
            />
            <CommandList className="max-h-56" label="에픽 후보" data-testid="parent-epic-candidates">
              <CommandEmpty className="text-muted-foreground px-3 py-2 text-sm">
                {loading ? '에픽을 불러오는 중…' : '맞는 에픽이 없습니다'}
              </CommandEmpty>
              {typedOption && (
                <CommandItem
                  // 에픽 번호와 겹치지 않는 값 — cmdk 는 값으로 항목을 구분한다.
                  value="__typed__"
                  disabled={update.isPending}
                  onSelect={() => void save(typedOption.parentNumber)}
                  data-testid="parent-typed-option"
                >
                  {typedOption.label}
                </CommandItem>
              )}
              {candidates.map((epic) => (
                <CommandItem
                  key={epic.number}
                  // 같은 제목의 에픽이 있어도 겹치지 않게 번호를 값으로 쓴다.
                  value={String(epic.number)}
                  disabled={update.isPending}
                  onSelect={() => void save(epic.number)}
                  data-testid={`parent-epic-option-${epic.number}`}
                >
                  <EpicColorDot epic={epic} />
                  <span className="text-muted-foreground shrink-0 tabular-nums">#{epic.number}</span>
                  <span className="truncate">{epic.title}</span>
                </CommandItem>
              ))}
            </CommandList>
          </Command>
        </>
      )}
      <div className="flex gap-2 justify-end">
        <Button variant="ghost" size="sm" onClick={onClose} type="button">
          취소
        </Button>
        <Button
          size="sm"
          onClick={onSave}
          disabled={saveDisabled}
          type="button"
          data-testid="parent-save"
        >
          저장
        </Button>
      </div>
    </div>
  );
}
