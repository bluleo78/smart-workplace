// 「상위 연결 변경」 확인 창(WP-2097) — 유형 변경이 기존 상위를 풀기 전에 서버 요청 없이 띄워,
// 사용자에게 「에픽 아래로 이동 / 상위 없이 변경」 중 하나와 옛 상위와의 관련 관계 유지 여부를 고르게 한다.
// 표시 조건·선택지는 부모의 부모가 에픽인지에 따라 호출부가 정한다(순수 함수 issueTypeParentLink).
// 배치는 시안 compare-2097.png 순서 — 지금 상위 → 이동 선택지 → 상위 없이 변경 → 관련 관계 유지 → 단추.

import { useState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type { IssueTypeSummary } from "@/types/issueType";

import { IssueTypeBadge } from "./IssueTypeBadge";

/** 「유형 변경」 단추가 돌려주는 선택 — moveToEpic(에픽 아래 이동)과 옛 상위 관련 관계 유지 여부. */
export interface ParentLinkChangeChoice {
  moveToEpic: boolean;
  relateToReleasedParent: boolean;
}

/**
 * 이름만 아는 유형을 IssueTypeBadge 가 그리는 요약으로 채운다 — 색·아이콘 정보는 창 props 에 없어
 * GRAY·Circle 폴백(IssueTypeBadge 설계)으로 그린다. id 는 배지 testid 가 겹치지 않게 음수로 둔다.
 */
function badgeSummary(typeName: string, id: number): IssueTypeSummary {
  return { id, name: typeName, colorToken: "GRAY", icon: "Circle" };
}

/** (WP-2131) 가린 모드 본문 — 읽을 수 없는 상위라 선택지 없이 「상위 없이 변경」 안내만 보인다. */
function HiddenParentChoice() {
  return (
    <p className="text-sm" data-testid="parent-link-hidden-choice">
      상위 없이 변경(권한 없음)
    </p>
  );
}

/** (WP-2131) 보이는 모드 본문 — 이동·상위 없이 변경 라디오와 관련 관계 유지 체크박스. 상태는 창이 가진다. */
function VisibleParentChoices({
  epic,
  moveToEpic,
  onMoveToEpicChange,
  relate,
  onRelateChange,
}: {
  epic: { key: string; title: string } | null;
  moveToEpic: boolean;
  onMoveToEpicChange: (v: boolean) => void;
  relate: boolean;
  onRelateChange: (v: boolean) => void;
}) {
  return (
    <div className="space-y-3">
      <RadioGroup
        value={moveToEpic ? "move" : "detach"}
        onValueChange={(v) => onMoveToEpicChange(v === "move")}
        aria-label="상위 연결 방식"
        className="gap-2.5"
      >
        {epic != null && (
          <div className="flex items-start gap-2">
            <RadioGroupItem
              value="move"
              id="parent-link-move"
              className="mt-0.5"
            />
            <label
              htmlFor="parent-link-move"
              className="flex flex-1 flex-wrap items-center gap-1.5 text-sm cursor-pointer"
            >
              <span>상위의 에픽 아래로 이동</span>
              <IssueTypeBadge type={badgeSummary("EPIC", -2)} size="sm" />
              <span className="text-muted-foreground break-words">
                {epic.key} · {epic.title}
              </span>
            </label>
          </div>
        )}
        <div className="flex items-start gap-2">
          <RadioGroupItem
            value="detach"
            id="parent-link-detach"
            className="mt-0.5"
          />
          <label
            htmlFor="parent-link-detach"
            className="text-sm cursor-pointer"
          >
            상위 없이 변경
          </label>
        </div>
      </RadioGroup>
      {/* 관련 관계 유지 — 기본 켬. 두 선택지 모두에 적용된다(요청 본문의 relateToReleasedParent). */}
      <div className="flex items-center gap-2">
        <Checkbox
          id="parent-link-relate"
          checked={relate}
          onCheckedChange={(v) => onRelateChange(v === true)}
        />
        <label htmlFor="parent-link-relate" className="text-sm cursor-pointer">
          관련 관계 유지
        </label>
      </div>
    </div>
  );
}

export function ParentLinkChangeDialog({
  open,
  onOpenChange,
  currentParent,
  epic,
  onConfirm,
  onCancel,
  pending = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 지금 상위 — 「지금 상위」 칸에 유형·키·제목을 그대로 보인다. null 이면 읽을 수 없는 상위(가린 모드, WP-2131). */
  currentParent: { key: string; title: string; typeName?: string } | null;
  /** 지금 상위의 위에 있는 에픽 — 있으면 「에픽 아래로 이동」 선택지를 기본으로 그린다. 없으면 「상위 없이 변경」만. */
  epic: { key: string; title: string } | null;
  onConfirm: (p: ParentLinkChangeChoice) => void;
  onCancel: () => void;
  /** 확인 뒤 요청 중 — 켜지는 동안 확인 단추를 끈다(연타 방지). */
  pending?: boolean;
}) {
  // 선택 상태 — 마운트 1회에만 초기화된다. 호출부(IssueTypeSelectPopover)가 열려 있을 때만 이 컴포넌트를 조건부로
  // 그려 열림마다 재마운트하므로, 여기 초기값이 매 열림의 기본값(에픽 있으면 이동·아니면 상위 없이, 관계 유지 켬)이 된다.
  const [moveToEpic, setMoveToEpic] = useState(epic != null);
  const [relate, setRelate] = useState(true);
  // (WP-2131) currentParent == null 이 가린 모드 — 상위를 알 수 없어 이동·관계 선택 없이 「상위 없이 변경」 안내만 그린다.

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent data-testid="parent-link-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>상위 연결 변경</AlertDialogTitle>
          {/* 지금 상위 — 유형 배지·키·제목(완료 기준 1). 설명 안에 인라인으로만 그린다(<p> 안 block 요소 금지). */}
          <AlertDialogDescription>
            {currentParent == null ? (
              <span data-testid="parent-link-hidden-notice">
                지금 상위를 볼 권한이 없습니다(다른 프로젝트의 상위 등). 유형을
                바꾸면 상위 연결이 풀립니다.
              </span>
            ) : (
              <span
                data-testid="parent-link-current"
                className="inline-flex flex-wrap items-center gap-1"
              >
                <span className="font-medium text-foreground">지금 상위</span>
                {/* 유형 이름을 모르면(응답에 유형 없음, WP-2131) 이름 없는 배지 대신 생략하고 키·제목만 보인다. */}
                {currentParent.typeName != null && (
                  <IssueTypeBadge
                    type={badgeSummary(currentParent.typeName, -1)}
                    size="sm"
                  />
                )}
                <span>{currentParent.key}</span>
                <span className="break-words">{currentParent.title}</span>
              </span>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {currentParent == null ? (
          <HiddenParentChoice />
        ) : (
          <VisibleParentChoices
            epic={epic}
            moveToEpic={moveToEpic}
            onMoveToEpicChange={setMoveToEpic}
            relate={relate}
            onRelateChange={setRelate}
          />
        )}
        <AlertDialogFooter>
          {/* Esc 는 AlertDialog 기본 동작으로 닫히고, 닫힘은 호출부의 onOpenChange 가 받아 처리한다. */}
          <AlertDialogCancel variant="ghost" onClick={onCancel}>
            취소
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={pending}
            // 가린 모드도 같은 onConfirm 계약을 쓰되 선택이 없어 모두 false 로 알린다. 요청 본문 { typeId } 만이라는
            // 결정은 IssueTypeSelectPopover.onDialogConfirm 이 가지며 거기서 이 값을 쓰지 않는다(WP-2131).
            onClick={() =>
              onConfirm(
                currentParent == null
                  ? { moveToEpic: false, relateToReleasedParent: false }
                  : { moveToEpic, relateToReleasedParent: relate },
              )
            }
            data-testid="parent-link-confirm"
          >
            유형 변경
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
