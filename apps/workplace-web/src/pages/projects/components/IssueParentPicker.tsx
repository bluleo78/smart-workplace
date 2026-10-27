// 부모 인라인 편집기 (Phase 4a). 빈 문자열로 저장하면 부모 해제 (null) — 단 SUBTASK 는 부모가 필수라 비워 저장할 수 없다(WP-745).
// 상위 에픽(SUBTASK 아님)은 번호를 몰라도 제목 일부로 찾아 고른다(WP-1018) — 같은 프로젝트의 열린 에픽이 후보로 뜨고,
// 위·아래·Enter 로 고르면 바로 연결한다. 번호를 그대로 입력해 저장하는 기존 방식도 그대로다. SUBTASK 부모는 번호 입력만 둔다.
// 친 번호(목록에 없는 번호)·빈 값(해제)은 맨 위 항목으로 둔다 — cmdk 가 첫 항목을 저절로 고르므로 바로 Enter 하면 친 값이 저장되고,
// 화살표로 옮기면 그 후보가 저장된다(「7」을 쳤는데 제목에 「1.7」이 든 에픽이 연결되거나, 비우고 Enter 했는데 첫 에픽이 연결되지 않게).
// 같은 프로젝트 에픽 아래에 「다른 프로젝트」 묶음으로 읽을 수 있는 다른 프로젝트의 열린 에픽을 키·제목으로 찾아 보인다(WP-1039) — 고르면 그 키로 연결한다.
// 부모가 있으면 연 직후(입력을 고치기 전) 맨 위에 「현재」 항목을 둔다 — cmdk 가 첫 항목을 저절로 고르므로, 열자마자 Enter 해도 지금 부모를 그대로
// 둔다(가려진 부모로 열면 빈 입력이라 「상위 에픽 해제」가 첫 항목이 되어 Enter 한 번에 연결이 풀리던 문제). 지금 부모는 후보에서 빼고, 같은 부모를
// 다시 고르면 요청 없이 닫는다(헛 PATCH 방지).

import { Check } from 'lucide-react';
import { useState } from 'react';

import { EpicColorDot } from '@/components/issues/EpicColorDot';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Input } from '@/components/ui/input';

import { IssueTypeBadge } from '../../../components/issueTypes/IssueTypeBadge';
import { useOtherProjectEpics } from '../../../hooks/queries/useOtherProjectEpics';
import { useProjectEpics } from '../../../hooks/queries/useProjectEpics';
import { useUpdateIssueParent } from '../../../hooks/queries/useUpdateIssueParent';
import { matchEpicCandidates, parseIssueNumberQuery } from '../../../lib/epicCandidates';
import { formatIssueKey } from '../../../lib/issueKey';
import {
  isHiddenParent,
  isSameParent,
  parentIssueKey,
  parentProjectKey,
  type ParentTargetInput,
  parentTitleLabel,
} from '../../../lib/parentRef';
import type { ParentRef } from '../../../types/issue';

/** 편집기를 열 때의 입력값 — 같은 프로젝트 부모는 번호, 다른 프로젝트 에픽은 키(찾기로 바로 다시 보이게), 가려진 부모·없음은 빈 값. */
function initialValue(parent: ParentRef | null, projectKey: string): string {
  if (parent == null || isHiddenParent(parent)) return '';
  return parentProjectKey(parent, projectKey) === projectKey ? String(parent.number) : (parentIssueKey(parent, projectKey) ?? '');
}

/**
 * 친 값이 지금 부모에 맞는가 — 같은 프로젝트 부모는 후보 거르기(matchEpicCandidates)와 같은 기준(번호·제목), 다른 프로젝트 부모는 키 일치·제목 포함.
 * 가려진 부모·빈 입력은 맞지 않는다.
 */
function currentMatches(parent: ParentRef, value: string, projectKey: string): boolean {
  const q = value.trim().toLowerCase();
  if (q === '' || isHiddenParent(parent)) return false;
  if (parentProjectKey(parent, projectKey) === projectKey) return matchEpicCandidates([parent], value).length > 0;
  return parentIssueKey(parent, projectKey)?.toLowerCase() === q || parent.title.toLowerCase().includes(q);
}

export function IssueParentPicker({
  projectKey,
  issueNumber,
  currentParent,
  isSubtask = false,
  onClose,
}: {
  projectKey: string;
  issueNumber: number;
  /** 지금 부모 — 다른 프로젝트 에픽(WP-1038)이면 키로, 가려진 에픽이면 빈 값으로 연다. */
  currentParent: ParentRef | null;
  /** SUBTASK 면 부모 해제(빈 값 저장)를 막는다 — 서버도 400 으로 거절한다. */
  isSubtask?: boolean;
  onClose: () => void;
}) {
  // 지금 부모를 넘겨 다른 프로젝트 에픽에서 옮길 때 그 에픽의 진행률·하위 목록도 갱신한다(WP-1039).
  const update = useUpdateIssueParent(projectKey, issueNumber, currentParent);
  // 연 순간의 입력값 — 입력을 고치기 전까지만 「현재」 항목을 맨 위에 둔다.
  const [initialText] = useState(() => initialValue(currentParent, projectKey));
  const [value, setValue] = useState(initialText);
  // 지금 부모와 같은 대상인가 — 후보에서 빼고, 골라도 요청하지 않는다.
  const isCurrent = (target: ParentTargetInput | null) => isSameParent(currentParent, target, projectKey);
  // 에픽 후보 — 행 메뉴·모바일 에픽 시트와 같은 목록(열린 에픽, 캐시 공유). SUBTASK 부모 편집에서는 부르지 않는다(빈 목록).
  const { epics, loading } = useProjectEpics(projectKey, !isSubtask);
  // 지금 부모는 상한(20건)으로 자르기 전에 뺀다 — 자른 뒤 빼면 지금 부모가 앞에 있을 때 후보가 하나 모자란다.
  const candidates = matchEpicCandidates(
    epics.filter((e) => !isCurrent(e)),
    value,
  );
  // 다른 프로젝트 에픽(WP-1039) — 친 키·제목으로 찾는다(번호만 친 입력은 묻지 않는다). SUBTASK 부모는 같은 프로젝트만이라 찾지 않는다.
  // 연 순간 채워 둔 값(지금 다른 프로젝트 부모의 키)은 그 부모뿐이라 묻지 않는다 — 입력을 고친 뒤부터 찾는다.
  const others = useOtherProjectEpics(value, projectKey, !isSubtask && value !== initialText);
  const otherEpics = others.epics.filter((e) => !isCurrent(e));
  const trimmed = value.trim();
  const parsed = parseIssueNumberQuery(value);
  // 「현재」 항목 — 상위 에픽 편집에서 부모가 있고, 아직 입력을 고치지 않았거나 친 값이 지금 부모에 맞을 때.
  // 지금 부모는 후보·친 값 항목에서 빠지므로, 그 번호·제목을 치면(예: 지금 #7 에 「7」) 목록이 비지 않게 「현재」로 보인다.
  const showCurrent = !isSubtask && currentParent != null && (value === initialText || currentMatches(currentParent, value, projectKey));

  // 맨 위 「친 값」 항목 — 후보에 없는 번호면 그 번호로 연결(지금 부모 번호면 없음), 비웠고 부모가 있으면 해제. 그 밖엔 없다.
  const typedOption: { target: ParentTargetInput | null; label: string } | null =
    parsed != null && !candidates.some((e) => e.number === parsed) && !isCurrent({ number: parsed })
      ? { target: { number: parsed }, label: `#${parsed} 로 연결` }
      : trimmed === '' && currentParent != null
        ? { target: null, label: '상위 에픽 해제' }
        : null;

  // 저장 — null 이면 해제, { number } 면 같은 프로젝트 그 번호로, { projectKey, number } 면 그 (다른 프로젝트) 에픽으로 연결.
  // mutation 의 성공/실패 토스트는 훅 내부에서 처리. 성공 시에만 닫는다.
  async function save(parent: ParentTargetInput | null) {
    // 지금 부모 그대로면 요청 없이 닫는다(헛 PATCH·「저장했습니다」 토스트 방지).
    if (isCurrent(parent)) {
      onClose();
      return;
    }
    try {
      await update.mutateAsync(parent);
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
    if (parsed != null) void save({ number: parsed });
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
              placeholder="예: 12, v1.7 또는 PLAN-3 (비우면 해제)"
              data-testid="parent-number-input"
            />
            <CommandList className="max-h-56" label="에픽 후보" data-testid="parent-epic-candidates">
              <CommandEmpty className="text-muted-foreground px-3 py-2 text-sm">
                {loading || others.searching ? '에픽을 불러오는 중…' : '맞는 에픽이 없습니다'}
              </CommandEmpty>
              {showCurrent && currentParent && (
                <CommandItem
                  // 후보 값(번호·other:키)·친 값과 겹치지 않는 값.
                  value="__current__"
                  disabled={update.isPending}
                  onSelect={onClose}
                  data-testid="parent-current-option"
                >
                  <Check className="text-primary" aria-hidden />
                  <span className="text-muted-foreground shrink-0">현재</span>
                  {!isHiddenParent(currentParent) && (
                    <span className="text-muted-foreground shrink-0 tabular-nums">
                      {parentIssueKey(currentParent, projectKey)}
                    </span>
                  )}
                  <span className="truncate">{parentTitleLabel(currentParent)}</span>
                </CommandItem>
              )}
              {typedOption && (
                <CommandItem
                  // 에픽 번호와 겹치지 않는 값 — cmdk 는 값으로 항목을 구분한다.
                  value="__typed__"
                  disabled={update.isPending}
                  onSelect={() => void save(typedOption.target)}
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
                  onSelect={() => void save({ number: epic.number })}
                  data-testid={`parent-epic-option-${epic.number}`}
                >
                  <EpicColorDot epic={epic} />
                  <span className="text-muted-foreground shrink-0 tabular-nums">#{epic.number}</span>
                  <span className="truncate">{epic.title}</span>
                </CommandItem>
              ))}
              {/* 다른 프로젝트 에픽 — 같은 프로젝트 후보 뒤에 둬, 기본(같은 프로젝트)이 먼저 고르기 쉽게 한다. 키를 앞에 보여 어느 프로젝트인지 알린다. */}
              {otherEpics.length > 0 && (
                <CommandGroup heading="다른 프로젝트" data-testid="parent-other-epics">
                  {otherEpics.map((epic) => {
                    const key = formatIssueKey(epic.projectKey, epic.number);
                    return (
                      <CommandItem
                        key={key}
                        // 같은 프로젝트 후보(번호 값)·친 값과 겹치지 않게 접두를 둔다.
                        value={`other:${key}`}
                        disabled={update.isPending}
                        onSelect={() => void save({ projectKey: epic.projectKey, number: epic.number })}
                        data-testid={`parent-other-epic-option-${key}`}
                      >
                        {epic.type && <IssueTypeBadge type={epic.type} size="sm" iconOnly />}
                        <span className="text-muted-foreground shrink-0 tabular-nums">{key}</span>
                        <span className="truncate">{epic.title}</span>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              )}
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
