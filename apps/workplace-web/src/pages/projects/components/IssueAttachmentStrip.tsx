// 본문용 가로 첨부 스트립.
// 무엇을: 이슈 설명 바로 아래, 첨부를 유형 아이콘 칩으로 가로 나열 + 드롭존.
// 왜: 사이드바 과밀 해소를 위해 첨부를 본문으로 이동(#343). 항상 보이되 공간 절약.
// #80: 드라이브 링크 통합 렌더 + "드라이브에서 링크" 버튼 추가.
// WP-202: 첨부 추가(파일 업로드·드라이브 링크) 권한 = 본문 편집 권한(canEditContent). 권한 없는 열람자에겐
//         드롭존·링크 버튼 줄을 통째로 숨겨 403 을 미리 막는다.

import { Cloud, Paperclip, Plus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { ATTACHMENT_MAX_PER_ISSUE } from '../../../api/issueAttachments';
import { FolderPickerModal } from '../../../components/drive/FolderPickerModal';
import { MobileActionSheet } from '../../../components/mobile/MobileActionSheet';
import { useDriveSpaces } from '../../../hooks/queries/useDriveSpaces';
import { useAddIssueDriveLink } from '../../../hooks/queries/useIssueDriveLinks';
import { useUploadIssueAttachments } from '../../../hooks/queries/useUploadIssueAttachments';
import { useIsMobile } from '../../../hooks/useIsMobile';
import { IssueAttachmentDropzone } from './IssueAttachmentDropzone';
import { IssueAttachmentList } from './IssueAttachmentList';

export function IssueAttachmentStrip({
  projectKey,
  number,
  attachmentCount,
  currentUserId,
  isOwner,
  canEditContent,
}: {
  projectKey: string;
  number: number;
  attachmentCount: number;
  currentUserId: number | null;
  isOwner: boolean;
  // 첨부 추가(업로드·드라이브 링크) 가능 여부 — 서버 viewerCanEditContent(멤버/ADMIN 또는 OPEN reporter 본인)와 동일 기준.
  canEditContent: boolean;
}) {
  const isMobile = useIsMobile();
  const [pickerOpen, setPickerOpen] = useState(false);
  // 모바일 「＋ 첨부」 액션 시트·숨은 파일 입력(WP-196).
  const [attachSheetOpen, setAttachSheetOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const upload = useUploadIssueAttachments(projectKey, number);
  const addLink = useAddIssueDriveLink(projectKey, number);
  // 사용자 개인 스페이스 ID — 파일 피커 시작 위치.
  const [personalSpaceId, setPersonalSpaceId] = useState<number | null>(null);
  // 스페이스 목록 조회 완료 여부 — null 과 "아직 로딩 중" 구분용 (Fix 5).
  const [spacesResolved, setSpacesResolved] = useState(false);

  // 스페이스 목록에서 PERSONAL 타입 스페이스 조회. queryKey 공유로 useAttachmentDraft 등
  // 동일 이슈 화면에 동시 마운트되는 다른 컴포넌트와 요청이 dedup 된다 (#798).
  // 링크 버튼이 숨겨지는 열람자(편집 권한 없음)는 조회 자체를 생략 — 불필요한 요청·실패 토스트 방지(WP-202).
  const spacesQuery = useDriveSpaces({ enabled: canEditContent });
  useEffect(() => {
    if (!spacesQuery.isSuccess && !spacesQuery.isError) return;
    if (spacesQuery.isError) {
      // 스페이스 조회 실패 시 토스트로 안내하고 버튼은 비활성 유지.
      setSpacesResolved(true);
      toast.error('드라이브 스페이스를 불러오지 못했습니다.');
      return;
    }
    const personal = spacesQuery.data.find((s) => s.type === 'PERSONAL');
    if (personal) setPersonalSpaceId(personal.id);
    setSpacesResolved(true);
  }, [spacesQuery.isSuccess, spacesQuery.isError, spacesQuery.data]);

  // 파일 선택창 열기 — 시트 액션 클릭 핸들러 안에서 동기 호출된다.
  const pickFile = () => fileInputRef.current?.click();

  // 모바일 시트 액션 존재 여부 — 한도(ATTACHMENT_MAX_PER_ISSUE) 도달 시 파일 업로드는 빠지고(데스크톱 드롭존의 '한도 도달' 비활성과 같은 의미),
  // 드라이브 링크는 개인 스페이스가 확인돼야 남는다. 둘 다 없으면 「＋ 첨부」 버튼을 렌더하지 않는다.
  const canPickFile = attachmentCount < ATTACHMENT_MAX_PER_ISSUE;
  const canPickDrive = spacesResolved && personalSpaceId != null;

  return (
    <section aria-label="첨부" data-testid="issue-attachment-strip" className="space-y-2">
      {attachmentCount > 0 && (
        <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <span>첨부</span>
          <span>{attachmentCount}/{ATTACHMENT_MAX_PER_ISSUE}</span>
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
      {canEditContent && isMobile && (canPickFile || canPickDrive) && (
        // 모바일(WP-196): 드롭존·링크 두 버튼 대신 「＋ 첨부」 하나 → 액션 시트(파일 · 드라이브에서 링크).
        // 파일 입력은 시트 밖에 숨겨 두고, 액션 onSelect(시트 닫기와 같은 클릭 핸들러 안 동기 실행)에서 click() —
        // iOS 사용자 제스처가 유지되어 파일 선택창이 막히지 않는다.
        <>
          <button
            type="button"
            data-testid="mobile-attach-add"
            onClick={() => setAttachSheetOpen(true)}
            className="inline-flex h-11 items-center gap-1.5 rounded-md border border-input bg-background px-4 text-sm font-medium active:bg-accent"
          >
            <Plus className="size-4" aria-hidden /> 첨부
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            hidden
            data-testid="mobile-attach-input"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              // 같은 파일을 다시 고를 수 있게 값 리셋.
              e.target.value = '';
              if (files.length > 0) upload.mutate({ files, currentCount: attachmentCount });
            }}
          />
          <MobileActionSheet
            testId="mobile-attach-sheet"
            open={attachSheetOpen}
            onClose={() => setAttachSheetOpen(false)}
            title="첨부"
            actions={[
              ...(canPickFile
                ? [{ key: 'file', label: '파일', icon: <Paperclip />, onSelect: pickFile }]
                : []),
              ...(canPickDrive
                ? [{ key: 'drive', label: '드라이브에서 링크', icon: <Cloud />, onSelect: () => setPickerOpen(true) }]
                : []),
            ]}
          />
        </>
      )}
      {canEditContent && !isMobile && (
        <div className="flex flex-wrap items-center gap-2">
          <IssueAttachmentDropzone
            projectKey={projectKey}
            number={number}
            currentCount={attachmentCount}
            disabled={attachmentCount >= ATTACHMENT_MAX_PER_ISSUE}
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
            // 드롭 영역과 동일 두께(py-4) — shrink-0 으로 버튼 너비 유지, 드롭 영역이 나머지 폭 차지.
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-input bg-background px-3 py-4 text-xs font-medium hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Cloud className="h-3.5 w-3.5" /> 드라이브에서 링크
          </button>
        </div>
      )}

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
