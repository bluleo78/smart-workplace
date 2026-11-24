// 개인 작업 삭제 동작(WP-2036) — 단추 + 확인창 + 삭제 요청을 한 묶음으로 둔다. 데스크톱 상세 머리와 모바일 상세가 같이 쓴다.
// 왜: 개인 작업엔 삭제 경로가 없었다(팀 이슈 상세에만 있음). 확인창·요청 로직을 두 화면에 복제하지 않으려 분리했다.
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { DeleteConfirmDialog } from '@/components/ui/delete-confirm-dialog';
import { isNotFoundError } from '@/lib/api-error';

import { issueKeys, useDeleteIssue } from '../../../hooks/queries/useIssues';

interface Props {
  projectKey: string;
  number: number;
  title: string;
  /** 하위 작업 수 — 1 이상이면 확인창에 함께 삭제된다고 알린다(서버가 cascade). */
  childCount: number;
  /** 상세 응답의 viewerCanDelete — 거짓이면 단추 자체를 그리지 않는다. */
  canDelete: boolean;
  /** desktop: 머리의 글자+아이콘 단추 / mobile: 44px 아이콘 단추. */
  variant: 'desktop' | 'mobile';
  /** 삭제 성공 뒤 — 호출 화면이 상세를 닫는다(?task 지움). 실패하면 호출되지 않는다. */
  onDeleted: () => void;
}

export function PersonalTaskDeleteAction({ projectKey, number, title, childCount, canDelete, variant, onDeleted }: Props) {
  const [open, setOpen] = useState(false);
  // 같은 틱의 연타 방지 — isPending 은 다시 그려져야 갱신돼 두 번째 클릭이 낡은 값을 보므로, ref 로 즉시 막는다.
  const inFlight = useRef(false);
  const qc = useQueryClient();
  const remove = useDeleteIssue(projectKey, number, {
    success: '작업을 삭제했습니다',
    error: '작업을 삭제하지 못했습니다',
  });

  if (!canDelete) return null;

  const confirm = () => {
    if (inFlight.current) return;
    inFlight.current = true;
    remove.mutate(undefined, {
      onSuccess: onDeleted,
      // 실패 토스트는 훅이 띄운다. 상세는 그대로 둔다.
      // 404(이미 다른 곳에서 지워짐)면 상세를 다시 읽어 낡은 제목·삭제 단추 대신 「찾을 수 없음」을 보이게 한다.
      onError: (e) => {
        if (isNotFoundError(e)) qc.invalidateQueries({ queryKey: issueKeys.detail(projectKey, number) });
      },
      // 성공·실패 모두 확인 창을 닫고 연타 막음을 푼다.
      onSettled: () => {
        setOpen(false);
        inFlight.current = false;
      },
    });
  };

  return (
    <>
      {variant === 'desktop' ? (
        <Button
          variant="outline"
          size="sm"
          aria-label="작업 삭제"
          data-testid="personal-task-delete"
          onClick={() => setOpen(true)}
        >
          <Trash2 className="h-4 w-4 mr-1" />
          삭제
        </Button>
      ) : (
        <Button
          variant="ghost"
          size="icon"
          aria-label="작업 삭제"
          data-testid="personal-task-delete"
          className="min-h-11 min-w-11 text-destructive"
          onClick={() => setOpen(true)}
        >
          {remove.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
        </Button>
      )}
      <DeleteConfirmDialog
        entityName="작업"
        itemName={title}
        open={open}
        onOpenChange={setOpen}
        onConfirm={confirm}
        description={`"${title}" 작업을 삭제할까요? 이 작업은 되돌릴 수 없습니다.`}
        impact={childCount >= 1 ? `하위 작업 ${childCount}개도 함께 삭제됩니다.` : undefined}
        pending={remove.isPending}
        confirmTestId="personal-task-delete-confirm"
      />
    </>
  );
}
