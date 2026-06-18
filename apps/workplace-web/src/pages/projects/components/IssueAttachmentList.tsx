// 이슈 첨부 목록 — 자신이 부착했거나 프로젝트 OWNER 면 삭제 버튼 노출.
// layout='strip' 이면 flex 가로 래핑 칩 컨테이너로 렌더.
// 무엇을: 기존 세로 목록(list)과 본문 스트립(strip) 두 레이아웃 지원.
// 왜: 본문 이동(#343) 시 IssueAttachmentStrip 에서 strip 모드로 재사용.

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
} from '../../../components/ui/alert-dialog';
import { useDeleteIssueAttachment } from '../../../hooks/queries/useDeleteIssueAttachment';
import { useIssueAttachments } from '../../../hooks/queries/useIssueAttachments';
import { IssueAttachmentItem } from './IssueAttachmentItem';

export function IssueAttachmentList({
  projectKey,
  number,
  currentUserId,
  isOwner,
  layout = 'list',
}: {
  projectKey: string;
  number: number;
  currentUserId: number | null;
  isOwner: boolean;
  /** 렌더 레이아웃 — 'list': 기존 세로 목록(기본), 'strip': 가로 칩 래핑 */
  layout?: 'list' | 'strip';
}) {
  const q = useIssueAttachments(projectKey, number);
  const del = useDeleteIssueAttachment(projectKey, number);
  // 삭제 확인 다이얼로그 — window.confirm 대체 (#148).
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);

  if (q.isLoading) {
    return <p className="text-xs text-muted-foreground py-2">로딩 중…</p>;
  }
  const items = q.data ?? [];
  if (items.length === 0) {
    return <p className="text-xs text-muted-foreground py-2">첨부가 없습니다</p>;
  }

  // strip 모드: flex 가로 래핑 컨테이너
  const listClass = layout === 'strip' ? 'flex flex-wrap gap-2' : undefined;

  return (
    <>
      <ul data-testid="attachment-list" className={listClass}>
        {items.map((a) => (
          <IssueAttachmentItem
            key={a.fileId}
            projectKey={projectKey}
            number={number}
            attachment={a}
            canDelete={a.attachedById === currentUserId || isOwner}
            layout={layout}
            onDelete={(fileId) => {
              // 삭제 확인은 AlertDialog 에서 처리 — window.confirm 대체 (#148).
              setPendingDeleteId(fileId);
            }}
          />
        ))}
      </ul>

      {/* 첨부 삭제 확인 AlertDialog — window.confirm 대체 (#148) */}
      <AlertDialog
        open={pendingDeleteId != null}
        onOpenChange={(open) => { if (!open) setPendingDeleteId(null); }}
      >
        <AlertDialogContent data-testid="attachment-delete-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>첨부 삭제</AlertDialogTitle>
            <AlertDialogDescription>
              첨부를 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => { if (pendingDeleteId != null) del.mutate(pendingDeleteId); }}
              data-testid="attachment-delete-confirm"
            >
              삭제
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
