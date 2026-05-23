// 이슈 첨부 목록 — 자신이 부착했거나 프로젝트 OWNER 면 삭제 버튼 노출.

import { useDeleteIssueAttachment } from '../../../hooks/queries/useDeleteIssueAttachment';
import { useIssueAttachments } from '../../../hooks/queries/useIssueAttachments';

import { IssueAttachmentItem } from './IssueAttachmentItem';

export function IssueAttachmentList({
  projectKey,
  number,
  currentUserId,
  isOwner,
}: {
  projectKey: string;
  number: number;
  currentUserId: number | null;
  isOwner: boolean;
}) {
  const q = useIssueAttachments(projectKey, number);
  const del = useDeleteIssueAttachment(projectKey, number);

  if (q.isLoading) {
    return <p className="text-xs text-muted-foreground py-2">로딩 중…</p>;
  }
  const items = q.data ?? [];
  if (items.length === 0) {
    return <p className="text-xs text-muted-foreground py-2">첨부가 없습니다</p>;
  }
  return (
    <ul data-testid="attachment-list">
      {items.map((a) => (
        <IssueAttachmentItem
          key={a.fileId}
          projectKey={projectKey}
          number={number}
          attachment={a}
          canDelete={a.attachedById === currentUserId || isOwner}
          onDelete={(fileId) => {
            // 단순 confirm 으로 삭제 의도 확인 — 실수 방지 목적.
            if (confirm('첨부를 삭제하시겠습니까?')) del.mutate(fileId);
          }}
        />
      ))}
    </ul>
  );
}
