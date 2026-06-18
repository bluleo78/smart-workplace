// 본문용 가로 첨부 스트립.
// 무엇을: 이슈 설명 바로 아래, 첨부를 유형 아이콘 칩으로 가로 나열 + 드롭존.
// 왜: 사이드바 과밀 해소를 위해 첨부를 본문으로 이동(#343). 항상 보이되 공간 절약.

import { IssueAttachmentDropzone } from './IssueAttachmentDropzone';
import { IssueAttachmentList } from './IssueAttachmentList';

export function IssueAttachmentStrip({
  projectKey,
  number,
  attachmentCount,
  currentUserId,
  isOwner,
}: {
  projectKey: string;
  number: number;
  attachmentCount: number;
  currentUserId: number | null;
  isOwner: boolean;
}) {
  return (
    <section aria-label="첨부" data-testid="issue-attachment-strip" className="space-y-2">
      {attachmentCount > 0 && (
        <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <span>첨부</span>
          <span>{attachmentCount}/10</span>
        </div>
      )}
      <IssueAttachmentList
        projectKey={projectKey}
        number={number}
        currentUserId={currentUserId}
        isOwner={isOwner}
        layout="strip"
      />
      <IssueAttachmentDropzone
        projectKey={projectKey}
        number={number}
        currentCount={attachmentCount}
        disabled={attachmentCount >= 10}
      />
    </section>
  );
}
