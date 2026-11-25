// 「하위 태스크 N개 유형 변경」 확인 창(WP-2098) — 에픽으로 바꾸면 딸린 하위 태스크를 둘 수 없어,
// 서버 요청 전에 대상 목록과 바꿀 유형을 보이고 사용자가 확인하면 같은 요청에 convertSubtasksToTypeId 로 실어 보낸다.
// 현재 상위가 있으면(에픽은 상위를 둘 수 없다) 빠진다는 안내와 관련 관계 유지 선택을 함께 보인다(WP-2097 과 같은 문구).

import { useState } from 'react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { defaultConvertTypeId } from '@/lib/issueTypeSubtaskConvert';
import type { IssueResponse } from '@/types/issue';
import type { IssueTypeResponse } from '@/types/issueType';

import { IssueTypeBadge } from './IssueTypeBadge';

/** 「모두 변경」 단추가 돌려주는 선택. */
export interface SubtaskConvertChoice {
  convertSubtasksToTypeId: number;
  relateToReleasedParent: boolean;
}

export function SubtaskConvertDialog({
  open,
  onOpenChange,
  subtasks,
  targetTypes,
  currentParent,
  onConfirm,
  onCancel,
  pending = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 유형을 바꿀 하위 태스크들 — 키·제목·유형 배지로 한 줄씩 보인다. */
  subtasks: IssueResponse[];
  /** 바꿀 유형 후보(EPIC·SUBTASK 제외) — 호출부가 convertTargetTypes 로 거른다. */
  targetTypes: IssueTypeResponse[];
  /**
   * 지금 상위 — 읽을 수 있으면 에픽이 되며 그 상위에서 빠진다는 안내와 관련 관계 유지 체크를 보인다.
   * { hidden: true } 는 읽을 수 없는 상위(WP-2131) — 키 없이 상위 연결이 풀린다는 안내만(관계 옵션은 보내지 않는다). null 이면 상위 없음.
   * typeName 은 상세 응답에 유형이 없으면 빠진다(WP-2131).
   */
  currentParent: { key: string; title: string; typeName?: string } | { hidden: true } | null;
  onConfirm: (c: SubtaskConvertChoice) => void;
  onCancel: () => void;
  /** 확인 뒤 요청 중 — 켜지는 동안 확인 단추를 끈다(연타 방지). */
  pending?: boolean;
}) {
  // 선택 상태 — 마운트 1회에만 초기화된다. 호출부가 열려 있을 때만 조건부로 그려 열림마다 재마운트한다.
  const [typeId, setTypeId] = useState<number | undefined>(() => defaultConvertTypeId(targetTypes));
  const [relate, setRelate] = useState(true);

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent data-testid="subtask-convert-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>하위 태스크 {subtasks.length}개 유형 변경</AlertDialogTitle>
          <AlertDialogDescription>
            에픽 아래에는 하위 태스크를 둘 수 없어, 딸린 하위 태스크의 유형을 함께 바꿉니다.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-3">
          {/* 대상 목록 — 많아도 창이 넘치지 않게 세로 스크롤. */}
          <ul data-testid="subtask-convert-list" className="max-h-48 space-y-1.5 overflow-y-auto text-sm">
            {subtasks.map((s) => {
              const key = `${s.projectKey}-${s.number}`;
              return (
                <li key={s.id} data-testid={`subtask-convert-item-${key}`} className="flex flex-wrap items-center gap-1.5">
                  <span className="text-muted-foreground">{key}</span>
                  <span className="break-words">{s.title}</span>
                  {s.type && <IssueTypeBadge type={s.type} size="sm" />}
                </li>
              );
            })}
          </ul>
          {/* 바꿀 유형 — 라벨은 줄바꿈하지 않고 칩들만 다음 줄로 감긴다. */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <span className="whitespace-nowrap text-sm font-medium">바꿀 유형</span>
            <RadioGroup
              value={typeId === undefined ? '' : String(typeId)}
              onValueChange={(v) => setTypeId(Number(v))}
              aria-label="바꿀 유형"
              className="flex flex-wrap gap-2"
            >
              {targetTypes.map((t) => (
                <label key={t.id} htmlFor={`subtask-convert-type-${t.id}`} className="flex cursor-pointer items-center gap-1">
                  <RadioGroupItem
                    value={String(t.id)}
                    id={`subtask-convert-type-${t.id}`}
                    data-testid={`subtask-convert-type-${t.id}`}
                  />
                  <IssueTypeBadge type={t} size="sm" />
                </label>
              ))}
            </RadioGroup>
          </div>
          {currentParent != null && 'hidden' in currentParent && (
            <p data-testid="subtask-convert-hidden-parent-notice" className="text-sm text-muted-foreground">
              지금 상위를 볼 권한이 없습니다(다른 프로젝트의 상위 등). 에픽은 상위를 둘 수 없어 상위 연결이 풀립니다.
            </p>
          )}
          {currentParent != null && !('hidden' in currentParent) && (
            <>
              <p data-testid="subtask-convert-parent-notice" className="text-sm text-muted-foreground">
                에픽은 상위를 둘 수 없어 지금 상위 {currentParent.key} 에서 빠집니다
              </p>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="subtask-convert-relate"
                  checked={relate}
                  onCheckedChange={(v) => setRelate(v === true)}
                />
                <label htmlFor="subtask-convert-relate" className="cursor-pointer text-sm">
                  관련 관계 유지
                </label>
              </div>
            </>
          )}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel variant="ghost" onClick={onCancel}>
            취소
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={pending || typeId === undefined}
            onClick={(e) => {
              // 저절로 닫지 않는다 — 부모가 저장이 끝난 뒤 닫아, 실패하면 고른 것을 남긴 채 다시 누를 수 있게 한다.
              e.preventDefault();
              if (typeId !== undefined) onConfirm({ convertSubtasksToTypeId: typeId, relateToReleasedParent: relate });
            }}
            data-testid="subtask-convert-confirm"
          >
            모두 변경
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
