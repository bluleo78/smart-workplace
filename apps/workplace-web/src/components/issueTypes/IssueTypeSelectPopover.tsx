// 이슈 유형 단일 선택 픽커 — 항목 클릭 즉시 PATCH 후 close.
// 검색·상세 페이지의 제목 옆 배지로 사용.
// SUBTASK 는 부모가 필수라(WP-745) 고르면 바로 저장하지 않고 부모 번호를 받는 단계로 넘어가, 유형·부모를 한 요청으로 보낸다.
// WP-2097 — 고른 유형이 기존 상위를 풀면(그리고 상위가 있으면) 저장 전에 「상위 연결 변경」 확인 창을 띄우고,
// 상세에서 넘긴 parentLink 가 없으면(상위 없음·호출부 미전달) 지금처럼 곧바로 저장한다.

import { useState } from 'react';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/overlay/popover';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { parentLinkChangeChoices, shouldShowParentLinkChange } from '@/lib/issueTypeParentLink';
import { SELECTED_ROW_CLASS } from '@/lib/selectionStyles';
import { cn } from '@/lib/utils';

import { useIssueTypes } from '../../hooks/queries/useIssueTypes';
import { useUpdateIssueType } from '../../hooks/queries/useUpdateIssueType';
import type { IssueTypeSummary } from '../../types/issueType';
import { IssueTypeBadge } from './IssueTypeBadge';
import { type ParentLinkChangeChoice, ParentLinkChangeDialog } from './ParentLinkChangeDialog';

/** 「상위 연결 변경」 창에 넘길 지금 상위 요약 — 상세 응답의 summary.parent 에서 호출부가 만든다(WP-2097). */
export interface ParentLink {
  parentKey: string;
  parentTypeName: string;
  parentTitle: string;
  /** 지금 상위의 위에 있는 에픽(할아버지) — 없으면(에픽이 곧 상위) null 이고 창은 「상위 없이 변경」만 그린다. */
  grandparent: { key: string; title: string } | null;
}

export function IssueTypeSelectPopover({
  projectKey,
  issueNumber,
  current,
  disabled = false,
  parentLink,
}: {
  projectKey: string;
  issueNumber: number;
  current: IssueTypeSummary;
  /** 워크플로 편집 권한 없을 때 트리거 비활성화 — 멤버만 유형 변경 가능. */
  disabled?: boolean;
  /** 지금 상위 정보 — 없으면(상위 없는 이슈) 확인 창 판정을 건너뛰고 즉시 저장한다. */
  parentLink?: ParentLink;
}) {
  const types = useIssueTypes(projectKey);
  const update = useUpdateIssueType(projectKey, issueNumber);
  const [open, setOpen] = useState(false);
  // SUBTASK 를 골랐을 때 부모 번호를 받는 단계 — 고른 SUBTASK 유형 id. null 이면 유형 목록.
  const [subtaskTypeId, setSubtaskTypeId] = useState<number | null>(null);
  const [parentValue, setParentValue] = useState('');
  // 확인 창에 띄울 유형 — null 이면 창 없음. 저장은 확인을 받은 뒤 한다(WP-2097).
  // 이름까지 들고 있는 이유: 선택지는 대상 유형을 봐야 한다(EPIC 은 「상위 없이 변경」만 — 완료 기준 7).
  const [pendingType, setPendingType] = useState<{ id: number; name: string } | null>(null);

  // 팝오버를 닫으면 부모 입력 단계를 버린다 — 다시 열면 유형 목록부터. 확인 창 상태(pendingType)는 그대로 둔다.
  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setSubtaskTypeId(null);
      setParentValue('');
    }
  }

  // 부모 번호는 양의 정수만 — 그 밖은 저장 버튼을 막는다(서버도 같은 프로젝트·SUBTASK 가 아닌 부모인지 다시 본다).
  const parentNumber = Number(parentValue.trim());
  const parentValid = parentValue.trim() !== '' && Number.isInteger(parentNumber) && parentNumber > 0;

  async function onSaveSubtask() {
    if (subtaskTypeId == null || !parentValid) return;
    try {
      await update.mutateAsync({ typeId: subtaskTypeId, parentNumber });
      onOpenChange(false);
    } catch {
      // 에러 토스트는 훅이 띄운다 — 입력을 고쳐 다시 저장할 수 있게 열어 둔다.
    }
  }

  // WP-2097 — 지금 상위가 에픽 아래면 이동 선택지, 아니면 상위 없이 변경만. parentLink 없거나 창이 닫혀
  // 있으면(대상 유형을 아직 모른다) 선택지가 없다. 신규 유형이 EPIC 이면 대상이 EPIC 이므로 detach 만.
  const choices =
    parentLink != null && pendingType != null
      ? parentLinkChangeChoices({
          newTypeName: pendingType.name,
          // 상세 응답은 할아버지의 유형 이름을 따로 안 실으는데(에픽일 때만 싣는다) 에픽이 실려 있으면 그 유형이다.
          grandparentTypeName: parentLink.grandparent ? 'EPIC' : null,
          grandparentKey: parentLink.grandparent?.key ?? null,
          grandparentTitle: parentLink.grandparent?.title ?? null,
        })
      : null;

  // 유형 항목 클릭 — 상위가 풀리는 변경이면 확인 창만 띄우고(저장 전), 아니면 지금처럼 즉시 저장한다.
  function applyTypeChoice(t: { id: number; name: string }) {
    if (
      parentLink != null &&
      shouldShowParentLinkChange({ oldTypeName: current.name, newTypeName: t.name, parentKey: parentLink.parentKey })
    ) {
      setPendingType({ id: t.id, name: t.name });
      // 팝오버는 닫고 확인 창만 남긴다 — 모달 확인 창 아래 작은 팝오버를 겹쳐 두지 않는다.
      onOpenChange(false);
      return;
    }
    update.mutate({ typeId: t.id });
    onOpenChange(false);
  }

  // 확인 — 골랐던 유형을 상위 처리 옵션과 함께 보낸 뒤 창 상태를 비운다. 취소·Esc 는 확인 없이 상태만 비운다.
  function onDialogConfirm(p: ParentLinkChangeChoice) {
    if (pendingType == null) return;
    update.mutate({
      typeId: pendingType.id,
      ...(p.moveToEpic && choices?.epic ? { parentKey: choices.epic.key } : {}),
      relateToReleasedParent: p.relateToReleasedParent,
    });
    setPendingType(null);
  }

  return (
    <>
      <Popover open={open} onOpenChange={onOpenChange}>
        <PopoverTrigger asChild>
          <button
            type="button"
            data-testid="issue-type-trigger"
            aria-label="유형 변경"
            disabled={disabled}
            className="inline-flex min-h-6 disabled:pointer-events-none disabled:opacity-50"
          >
            <IssueTypeBadge type={current} />
          </button>
        </PopoverTrigger>
        {/* WP-2058: role=dialog 이름 — 스크린리더가 어느 칸의 팝오버인지 읽게 한다 */}
        <PopoverContent className="w-56 p-1" data-testid="issue-type-picker" aria-label="이슈 유형 선택">
          {subtaskTypeId != null ? (
            <form
              className="space-y-2 p-2"
              data-testid="issue-type-subtask-parent"
              onSubmit={(e) => {
                e.preventDefault();
                void onSaveSubtask();
              }}
            >
              <label className="text-sm font-medium" htmlFor="issue-type-parent-input">
                부모 이슈 번호
              </label>
              <p className="text-xs text-muted-foreground">하위 태스크는 부모 이슈가 있어야 합니다.</p>
              <Input
                id="issue-type-parent-input"
                value={parentValue}
                onChange={(e) => setParentValue(e.target.value)}
                placeholder="예: 12"
                type="number"
                min={1}
                autoFocus
                data-testid="issue-type-parent-input"
              />
              <div className="flex justify-end gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  type="button"
                  onClick={() => {
                    setSubtaskTypeId(null);
                    setParentValue('');
                  }}
                >
                  뒤로
                </Button>
                <Button
                  size="sm"
                  type="submit"
                  disabled={!parentValid || update.isPending}
                  data-testid="issue-type-parent-save"
                >
                  저장
                </Button>
              </div>
            </form>
          ) : (
            <ul className="space-y-0.5" role="radiogroup" aria-label="이슈 유형 선택">
              {(types.data ?? []).map((t) => {
                const checked = t.id === current.id;
                return (
                  <li key={t.id}>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={checked}
                      className={cn(
                        'w-full text-left flex items-center gap-2 px-2 py-1 rounded hover:bg-accent',
                        checked && SELECTED_ROW_CLASS,
                      )}
                      data-testid={`issue-type-option-${t.id}`}
                      onClick={() => {
                        if (checked) return onOpenChange(false);
                        // SUBTASK 는 부모 없이 될 수 없다 — 부모 번호 단계로 넘어간다.
                        if (t.name === 'SUBTASK') return setSubtaskTypeId(t.id);
                        // 그 밖은 상위 해제 여부를 판정해 확인 창 또는 즉시 저장으로 갈린다(WP-2097).
                        applyTypeChoice(t);
                      }}
                    >
                      <IssueTypeBadge
                        type={{
                          id: t.id,
                          name: t.name,
                          colorToken: t.colorToken,
                          icon: t.icon,
                        }}
                      />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </PopoverContent>
      </Popover>
      {/* 「상위 연결 변경」 확인 창 — parentLink 가 있고 지금 열려 있을 때만 그린다. 닫히면 unmount, 열릴 때마다
          새로 마운트해 지난 열림의 라디오·체크 선택이 남지 않는다(선택 초기화는 이 조건부 렌더가 만든다). */}
      {parentLink != null && pendingType != null && (
        <ParentLinkChangeDialog
          open
          onOpenChange={(next) => {
            if (!next) setPendingType(null);
          }}
          currentParent={{
            key: parentLink.parentKey,
            title: parentLink.parentTitle,
            typeName: parentLink.parentTypeName,
          }}
          epic={choices?.epic ?? null}
          onConfirm={onDialogConfirm}
          onCancel={() => setPendingType(null)}
          pending={update.isPending}
        />
      )}
    </>
  );
}
