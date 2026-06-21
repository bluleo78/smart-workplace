// 본문용 가로 첨부 스트립.
// 무엇을: 이슈 설명 바로 아래, 첨부를 유형 아이콘 칩으로 가로 나열 + 드롭존.
// 왜: 사이드바 과밀 해소를 위해 첨부를 본문으로 이동(#343). 항상 보이되 공간 절약.
// #80: 드라이브 링크 통합 렌더 + "드라이브에서 링크" 버튼 추가.

import { Cloud } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { driveApi } from '../../../api/drive';
import { FolderPickerModal } from '../../../components/drive/FolderPickerModal';
import { useAddIssueDriveLink } from '../../../hooks/queries/useIssueDriveLinks';
import type { DriveSpace } from '../../../types/drive';
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
  const [pickerOpen, setPickerOpen] = useState(false);
  const addLink = useAddIssueDriveLink(projectKey, number);
  // 사용자 개인 스페이스 ID — 파일 피커 시작 위치.
  const [personalSpaceId, setPersonalSpaceId] = useState<number | null>(null);
  // 스페이스 목록 조회 완료 여부 — null 과 "아직 로딩 중" 구분용 (Fix 5).
  const [spacesResolved, setSpacesResolved] = useState(false);

  // 컴포넌트 마운트 시 스페이스 목록에서 PERSONAL 타입 스페이스 조회.
  useEffect(() => {
    void driveApi
      .listSpaces()
      .then(({ data }) => {
        const personal = (data as DriveSpace[]).find((s) => s.type === 'PERSONAL');
        if (personal) setPersonalSpaceId(personal.id);
        setSpacesResolved(true);
      })
      .catch(() => {
        // 스페이스 조회 실패 시 토스트로 안내하고 버튼은 비활성 유지.
        setSpacesResolved(true);
        toast.error('드라이브 스페이스를 불러오지 못했습니다.');
      });
  }, []);

  return (
    <section aria-label="첨부" data-testid="issue-attachment-strip" className="space-y-2">
      {attachmentCount > 0 && (
        <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <span>첨부</span>
          <span>{attachmentCount}/10</span>
        </div>
      )}
      {/* 업로드 첨부 칩 목록 (strip 레이아웃) */}
      <IssueAttachmentList
        projectKey={projectKey}
        number={number}
        currentUserId={currentUserId}
        isOwner={isOwner}
        layout="strip"
      />
      <div className="flex flex-wrap items-center gap-2">
        <IssueAttachmentDropzone
          projectKey={projectKey}
          number={number}
          currentCount={attachmentCount}
          disabled={attachmentCount >= 10}
        />
        {/* 드라이브에서 파일 링크 추가 버튼 (#80) */}
        {/* spacesResolved=false이면 로딩 중, true+personalSpaceId=null이면 스페이스 없음 */}
        <button
          type="button"
          data-testid="issue-drive-link-add-btn"
          disabled={!spacesResolved || personalSpaceId == null}
          title={
            spacesResolved && personalSpaceId == null
              ? '드라이브를 사용할 수 없습니다'
              : undefined
          }
          onClick={() => setPickerOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-xs font-medium hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Cloud className="h-3.5 w-3.5" /> 드라이브에서 링크
        </button>
      </div>

      {/* 드라이브 링크 세로 목록 (list 레이아웃으로 배지+위치 서브텍스트 표시) */}
      <IssueAttachmentList
        projectKey={projectKey}
        number={number}
        currentUserId={currentUserId}
        isOwner={isOwner}
        layout="list"
        driveLinksOnly
      />

      {/* 파일 피커 모달 — 개인 스페이스에서 시작 */}
      {pickerOpen && personalSpaceId != null && (
        <FolderPickerModal
          spaceId={personalSpaceId}
          title="링크할 파일 선택"
          mode="file"
          onPickFile={(driveFileId) => {
            addLink.mutate(driveFileId);
            setPickerOpen(false);
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </section>
  );
}
