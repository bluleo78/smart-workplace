// 이슈 유형 단일 선택 픽커 — 항목 클릭 즉시 PATCH 후 close.
// 검색·상세 페이지의 제목 옆 배지로 사용.
// SUBTASK 는 부모가 필수라(WP-745) 고르면 바로 저장하지 않고 부모 번호를 받는 단계로 넘어가, 유형·부모를 한 요청으로 보낸다.
// WP-2097 — 고른 유형이 기존 상위를 풀면(그리고 상위가 있으면) 저장 전에 「상위 연결 변경」 확인 창을 띄우고,
// 상세에서 넘긴 parentLink 가 없으면(상위 없음·호출부 미전달) 지금처럼 곧바로 저장한다.
// WP-2131 — 읽을 수 없는 상위(parentLink.hidden)도 같은 창을 가린 모드(이동·관련 관계 선택 없음)로 띄우고, 확인하면 { typeId } 만 PATCH 한다.

import { useRef, useState } from 'react';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/overlay/popover';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { handleApiError } from '@/lib/api-error';
import { fetchAllChildren } from '@/lib/fetchAllChildren';
import { parentLinkChangeChoices, shouldShowParentLinkChange } from '@/lib/issueTypeParentLink';
import { convertTargetTypes, subtaskChildrenOf } from '@/lib/issueTypeSubtaskConvert';
import { SELECTED_ROW_CLASS } from '@/lib/selectionStyles';
import { cn } from '@/lib/utils';
import type { IssueStatus } from '@/types/issue';

import { useIssueTypes } from '../../hooks/queries/useIssueTypes';
import { useUpdateIssueType } from '../../hooks/queries/useUpdateIssueType';
import type { IssueResponse } from '../../types/issue';
import type { IssueTypeSummary } from '../../types/issueType';
import { IssueTypeBadge } from './IssueTypeBadge';
import { type ParentLinkChangeChoice, ParentLinkChangeDialog } from './ParentLinkChangeDialog';
import { type SubtaskConvertChoice, SubtaskConvertDialog } from './SubtaskConvertDialog';

/** 「상위 연결 변경」 창에 넘길 지금 상위 요약 — 상세 응답의 summary.parent 에서 호출부가 만든다(WP-2097). */
export interface VisibleParentLink {
  /** (WP-2131) 읽을 수 있는 상위 — 가린 변형과 구분하는 표지. */
  hidden?: false;
  parentKey: string;
  /** 응답에 유형이 없으면 생략 — 창이 배지를 그리지 않는다(WP-2131). */
  parentTypeName?: string;
  parentTitle: string;
  /** 지금 상위의 위에 있는 에픽(할아버지) — 없으면(에픽이 곧 상위) null 이고 창은 「상위 없이 변경」만 그린다. */
  grandparent: { key: string; title: string; status?: IssueStatus } | null;
  /** 이 이슈의 상태(summary.status) — 완료된 에픽으로의 이동 막힘 판정에 쓴다(WP-2132). */
  issueStatus?: IssueStatus;
}

/** (WP-2131) 호출자가 읽을 수 없는 상위 — 키·제목·유형을 모르므로 아무것도 싣지 않는다. */
export interface HiddenParentLink {
  hidden: true;
}

export type ParentLink = VisibleParentLink | HiddenParentLink;

export function IssueTypeSelectPopover({
  projectKey,
  issueNumber,
  current,
  disabled = false,
  parentLink,
  childCount = 0,
}: {
  projectKey: string;
  issueNumber: number;
  current: IssueTypeSummary;
  /** 워크플로 편집 권한 없을 때 트리거 비활성화 — 멤버만 유형 변경 가능. */
  disabled?: boolean;
  /**
   * 지금 상위 정보 — 없으면(상위 없는 이슈) 확인 창 판정을 건너뛰고 즉시 저장한다.
   * (WP-2131) { hidden: true } 면 가린 모드 창(이동·관련 관계 선택 없음)을 띄우고 확인 시 { typeId } 만 PATCH 한다.
   */
  parentLink?: ParentLink;
  /** 딸린 하위 수(상세 summary.childCount, WP-2098) — 0 이면 에픽으로 바꿀 때 하위 조회를 건너뛴다. */
  childCount?: number;
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

  // WP-2098 — 에픽으로 바꿀 때 하위 태스크 유형 변경 확인 창 상태. null 이면 창 없음.
  const [convertPending, setConvertPending] = useState<{ id: number; subtasks: IssueResponse[] } | null>(null);
  // 하위를 읽는 중 — 켜 있는 동안 유형 목록을 잠가 중복 선택·조회를 막는다.
  const [loadingChildren, setLoadingChildren] = useState(false);
  // 하위 조회 회차 — 조회 중 팝오버를 닫으면(취소) 회차가 바뀌어, 늦게 온 결과로 저장하지 않는다.
  const epicFetchSeq = useRef(0);

  // 팝오버를 닫으면 부모 입력 단계를 버린다 — 다시 열면 유형 목록부터. 확인 창 상태(pendingType)는 그대로 둔다.
  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      // 회차를 넘기며 잠금도 함께 푼다 — 버린 회차의 finally 는 잠금을 건드리지 않으므로(아래) 여기서 풀어야 다시 열 때 고를 수 있다.
      epicFetchSeq.current += 1;
      setLoadingChildren(false);
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

  // 읽을 수 있는 상위만 — 가린 상위(WP-2131)·상위 없음은 undefined. 키·제목·관계 옵션을 쓰는 곳은 이것으로 가른다.
  const visibleParent = parentLink != null && !parentLink.hidden ? parentLink : undefined;

  // WP-2097 — 지금 상위가 에픽 아래면 이동 선택지, 아니면 상위 없이 변경만. parentLink 없거나 창이 닫혀
  // 있으면(대상 유형을 아직 모른다) 선택지가 없다. 신규 유형이 EPIC 이면 대상이 EPIC 이므로 detach 만.
  const choices =
    visibleParent != null && pendingType != null
      ? parentLinkChangeChoices({
          newTypeName: pendingType.name,
          // 상세 응답은 할아버지의 유형 이름을 따로 안 실으는데(에픽일 때만 싣는다) 에픽이 실려 있으면 그 유형이다.
          grandparentTypeName: visibleParent.grandparent ? 'EPIC' : null,
          grandparentKey: visibleParent.grandparent?.key ?? null,
          grandparentTitle: visibleParent.grandparent?.title ?? null,
          grandparentStatus: visibleParent.grandparent?.status ?? null,
          issueStatus: visibleParent.issueStatus ?? null,
        })
      : null;

  // 유형 항목 클릭 — 상위가 풀리는 변경이면 확인 창만 띄우고(저장 전), 아니면 지금처럼 즉시 저장한다.
  function applyTypeChoice(t: { id: number; name: string }) {
    // 에픽 + 하위 있음 — 하위 태스크가 있는지 전체를 읽어 보고 갈린다(없으면 아래 기존 흐름).
    if (t.name === 'EPIC' && childCount > 0) {
      void applyEpicChoice(t);
      return;
    }
    proceedTypeChoice(t);
  }

  // 하위 전체(열림·닫힘, 모든 페이지)를 읽어 하위 태스크가 있으면 변환 확인 창, 없으면 기존 흐름으로 간다.
  // 읽기 실패는 알림만 띄우고 저장하지 않는다 — 하위를 모르는 채 보내면 서버가 400 으로 막을 뿐이라 사용자에게 먼저 알린다.
  async function applyEpicChoice(t: { id: number; name: string }) {
    setLoadingChildren(true);
    const seq = ++epicFetchSeq.current;
    try {
      const subtasks = subtaskChildrenOf(await fetchAllChildren(projectKey, issueNumber));
      // 읽는 사이 사용자가 팝오버를 닫았으면(취소) 아무것도 하지 않는다 — 하위 태스크가 없을 때 에픽으로 저장해 버리지 않게.
      if (seq !== epicFetchSeq.current) return;
      if (subtasks.length > 0) {
        setConvertPending({ id: t.id, subtasks });
        onOpenChange(false);
      } else {
        proceedTypeChoice(t);
      }
    } catch (e) {
      if (seq === epicFetchSeq.current) handleApiError(e, '하위 태스크를 불러오지 못했습니다');
    } finally {
      // 지금 회차일 때만 잠금을 푼다 — 취소한 앞 회차의 늦은 응답이 다시 고른 조회의 잠금을 풀지 않게(리뷰 후속, PR #1874).
      if (seq === epicFetchSeq.current) setLoadingChildren(false);
    }
  }

  // WP-2097 판정 — 상위가 풀리는 변경이면 확인 창, 아니면 즉시 저장.
  function proceedTypeChoice(t: { id: number; name: string }) {
    if (
      parentLink != null &&
      shouldShowParentLinkChange({ oldTypeName: current.name, newTypeName: t.name, hasParent: true })
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
    // 가린 상위는 { typeId } 만 — 서버가 상위를 풀고, 관계·이동 옵션은 보내지 않는다. 창이 가린 모드에서 돌려준 p 는 무시한다(WP-2131).
    if (parentLink?.hidden) {
      update.mutate({ typeId: pendingType.id });
      setPendingType(null);
      return;
    }
    update.mutate({
      typeId: pendingType.id,
      ...(p.moveToEpic && choices?.epic && !choices.moveBlocked ? { parentKey: choices.epic.key } : {}),
      relateToReleasedParent: p.relateToReleasedParent,
    });
    setPendingType(null);
  }

  // 하위 태스크 변환 확인 — 고른 유형과 함께 한 요청으로 보낸다. 상위가 있으면 관련 관계 선택도 함께 싣는다.
  // 창은 저장이 끝나야 닫는다 — 실패하면(토스트는 훅이 띄운다) 고른 유형·체크를 그대로 두고 다시 누를 수 있게. 보내는 동안 「모두 변경」은 잠긴다.
  function onConvertConfirm(c: SubtaskConvertChoice) {
    if (convertPending == null) return;
    update.mutate(
      {
        typeId: convertPending.id,
        convertSubtasksToTypeId: c.convertSubtasksToTypeId,
        // 가린 상위는 관계 옵션을 보내지 않는다(WP-2131 — { typeId } 만과 같은 규칙).
        relateToReleasedParent: visibleParent ? c.relateToReleasedParent : undefined,
      },
      { onSuccess: () => setConvertPending(null) },
    );
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
                      disabled={loadingChildren}
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
      {/* WP-2098 「하위 태스크 N개 유형 변경」 창 — 열릴 때마다 새로 마운트해 선택이 초기화된다. Esc·바깥 클릭도 취소로 본다. */}
      {convertPending != null && (
        <SubtaskConvertDialog
          open
          onOpenChange={(next) => {
            if (!next) setConvertPending(null);
          }}
          subtasks={convertPending.subtasks}
          targetTypes={convertTargetTypes(types.data ?? [])}
          currentParent={
            // 가린 상위(WP-2131)는 그대로 넘겨 키 없는 안내를 보인다 — 서버가 상위를 푼다.
            parentLink?.hidden
              ? parentLink
              : visibleParent
                ? { key: visibleParent.parentKey, title: visibleParent.parentTitle, typeName: visibleParent.parentTypeName }
                : null
          }
          onConfirm={onConvertConfirm}
          onCancel={() => setConvertPending(null)}
          pending={update.isPending}
        />
      )}
      {/* 「상위 연결 변경」 확인 창 — parentLink 가 있고 지금 열려 있을 때만 그린다. 닫히면 unmount, 열릴 때마다
          새로 마운트해 지난 열림의 라디오·체크 선택이 남지 않는다(선택 초기화는 이 조건부 렌더가 만든다). */}
      {parentLink != null && pendingType != null && (
        <ParentLinkChangeDialog
          open
          onOpenChange={(next) => {
            if (!next) setPendingType(null);
          }}
          currentParent={
            parentLink.hidden
              ? null
              : {
                  key: parentLink.parentKey,
                  title: parentLink.parentTitle,
                  typeName: parentLink.parentTypeName,
                }
          }
          epic={choices?.epic ?? null}
          moveBlocked={choices?.moveBlocked === true}
          onConfirm={onDialogConfirm}
          onCancel={() => setPendingType(null)}
          pending={update.isPending}
        />
      )}
    </>
  );
}
