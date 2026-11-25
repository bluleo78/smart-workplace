// 이슈 제목·본문 편집 충돌 안내(WP-2095) — 팀 이슈 상세와 개인 작업 상세의 제목·본문 편집기가 함께 쓴다.
// 무엇을: 두 모양. conflict = 내가 저장하려는데 남이 먼저 그 필드를 저장했다(409) — 최신 값 보기·최신으로 다시 쓰기·내 글로 덮어쓰기.
//         stale = 내가 편집하는 사이 남이 그 필드를 저장했다 — 최신 값 보기만(저장하면 conflict 안내가 뜬다).
// 왜: 안내 없이 다시 저장하면 앞선 사람의 저장분이 조용히 사라진다. 덮어쓰기는 확인 창을 거쳐야만 한다.
import { AlertTriangle } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { euroRo } from "@/lib/utils";
import type { FieldConflict } from "@/pages/projects/hooks/useVersionedPatch";

import { ISSUE_EDIT_FIELD_LABEL, type IssueEditField, issueEditFieldObject } from "./issueEditField";

/**
 * 안내 단추의 mousedown 기본 동작(포커스 이동)을 막는다 — 제목 입력칸은 blur 로 저장하므로, 단추를 누르는 순간 입력칸이 blur 되면
 * 단추 동작 전에 의도치 않은 저장이 일어난다. 포커스를 입력칸에 둔 채 click 만 받게 한다(키보드로 단추에 가는 경우는 영향 없음).
 */
const keepEditorFocus = (e: React.MouseEvent) => e.preventDefault();

export interface IssueEditConflictBannerProps {
  field: IssueEditField;
  mode: "conflict" | "stale";
  /** 남이 저장한 최신 값 — 펼치면 읽기 전용으로 보인다. */
  latest: string;
  /** 「최신 {필드}으로 다시 쓰기」 — 없으면 단추를 그리지 않는다. */
  onTakeLatest?: () => void;
  /** 덮어쓰기 확인 뒤 부른다 — 없으면 단추를 그리지 않는다. */
  onOverwrite?: () => void;
}

export function IssueEditConflictBanner({
  field,
  mode,
  latest,
  onTakeLatest,
  onOverwrite,
}: IssueEditConflictBannerProps) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const label = ISSUE_EDIT_FIELD_LABEL[field];
  const object = issueEditFieldObject(field);
  const isConflict = mode === "conflict";

  return (
    <div
      role={isConflict ? "alert" : "status"}
      data-testid={`issue-edit-${isConflict ? "conflict" : "stale"}-${field}`}
      data-issue-edit-notice
      className="space-y-2 rounded-md border border-warning bg-warning-subtle px-3 py-2 text-sm font-normal tracking-normal text-warning-text"
    >
      <p className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <span>
          {isConflict
            ? `다른 사람이 방금 ${object} 먼저 저장했습니다. 내 글은 아직 저장되지 않았습니다.`
            : `그사이 다른 사람이 ${object} 저장했습니다. 저장하면 충돌 안내가 뜹니다.`}
        </span>
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          aria-expanded={open}
          onMouseDown={keepEditorFocus}
          onClick={() => setOpen((v) => !v)}
          data-testid={`issue-edit-conflict-${field}-toggle`}
        >
          {open ? `최신 ${label} 접기` : `최신 ${label} 보기`}
        </Button>
        {isConflict && onTakeLatest && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onMouseDown={keepEditorFocus}
            onClick={onTakeLatest}
            data-testid={`issue-edit-conflict-${field}-take-latest`}
          >
            {`최신 ${label}${euroRo(label)} 다시 쓰기`}
          </Button>
        )}
        {isConflict && onOverwrite && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onMouseDown={keepEditorFocus}
            onClick={() => setConfirming(true)}
            data-testid={`issue-edit-conflict-${field}-overwrite`}
          >
            내 글로 덮어쓰기…
          </Button>
        )}
      </div>
      {open && (
        // 읽기 전용 — 본문은 마크다운을 렌더하지 않고 원문 그대로(줄바꿈 유지), 제목은 한 줄.
        <div
          data-testid={`issue-edit-latest-${field}`}
          className={
            field === "body"
              ? "max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-md border bg-background px-3 py-2 text-foreground"
              : "truncate rounded-md border bg-background px-3 py-1.5 text-foreground"
          }
        >
          {latest}
        </div>
      )}
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{`다른 사람의 ${object} 덮어쓸까요?`}</AlertDialogTitle>
            <AlertDialogDescription>
              방금 저장된 다른 사람의 글이 내 글로 바뀝니다. 바뀐 뒤에는 되돌릴
              수 없습니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>돌아가기</AlertDialogCancel>
            <AlertDialogAction onClick={() => onOverwrite?.()}>
              덮어쓰기
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/**
 * 편집기 입력칸 위 안내 — 409 로 확인된 충돌이 우선, 아니면 편집 중 남이 저장한 사실만 알린다(제목·본문 편집기 공용).
 * 둘 다 없으면 아무것도 그리지 않는다. 단추 콜백이 없으면 해당 단추를 그리지 않는다.
 */
export function IssueEditNotice({
  field,
  conflict,
  changedWhileEditing,
  onTakeLatest,
  onOverwrite,
}: {
  field: IssueEditField;
  conflict?: FieldConflict | null;
  changedWhileEditing?: { latest: string } | null;
  onTakeLatest?: () => void;
  onOverwrite?: () => void;
}) {
  if (conflict) {
    return (
      <IssueEditConflictBanner
        field={field}
        key={`conflict:${conflict.latest}`}
        mode="conflict"
        latest={conflict.latest}
        onTakeLatest={onTakeLatest}
        onOverwrite={onOverwrite}
      />
    );
  }
  if (changedWhileEditing) {
    return (
      <IssueEditConflictBanner
        key={`stale:${changedWhileEditing.latest}`}
        field={field}
        mode="stale"
        latest={changedWhileEditing.latest}
      />
    );
  }
  return null;
}
