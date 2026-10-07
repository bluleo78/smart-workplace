// 이슈 첨부 통합 뷰어 상태(WP-277) — 업로드 첨부 + 드라이브 링크를 한 묶음으로 여는 단일 소유자.
// 무엇을: ?preview 히스토리 키·묶음(useViewerBundle)·뷰어/찾을 수 없음 노드를 한 곳에서 만든다.
// 왜: 예전엔 두 IssueAttachmentList 인스턴스(업로드 strip·driveLinksOnly)가 각자 URL·묶음 상태를 들고,
//     뷰어가 로딩·빈 목록·본 목록 분기마다 다른 트리 위치에 그려져 리마운트(확대·패널·포커스 복귀 상태 유실)됐다.
//     스트립이 이 훅을 한 번만 쓰고 뷰어를 고정 위치에 그리면, 목록들은 onPreview(key) 만 부른다.

import type { ReactNode } from 'react';
import { useCallback, useMemo } from 'react';

import { AttachmentViewer } from '../../../components/viewer/AttachmentViewer';
import { useViewerBundle } from '../../../components/viewer/useViewerBundle';
import { issueAttachmentItem, issueDriveLinkItem } from '../../../components/viewer/viewerItems';
import { ViewerNotFound } from '../../../components/viewer/ViewerNotFound';
import { useIssueAttachments } from '../../../hooks/queries/useIssueAttachments';
import { useIssueDriveLinks } from '../../../hooks/queries/useIssueDriveLinks';
import { useHistoryParam } from '../../../hooks/useHistoryParam';
import type { IssueAttachment } from '../../../types/attachment';
import type { DriveLink } from '../../../types/drive';

export function useIssueAttachmentViewer(projectKey: string, number: number): {
  /** 목록 행 클릭 — 묶음 키(`file:`·`drive:`)로 뷰어를 연다. */
  onPreview: (key: string) => void;
  /** 뷰어·찾을 수 없음 안내 — 호출부가 분기와 무관한 고정 위치에 한 번만 그린다. */
  viewerNode: ReactNode;
} {
  // 목록 컴포넌트와 같은 쿼리 키라 요청은 한 번만 나간다(React Query dedup).
  const q = useIssueAttachments(projectKey, number);
  const driveQ = useIssueDriveLinks(projectKey, number);
  // 열림 = URL ?preview(뒤로가기 = 닫기).
  const previewParam = useHistoryParam('preview');
  // 묶음 원본 = 업로드 첨부 + 드라이브 링크(화면 목록 순서 그대로).
  const sources = useMemo<(IssueAttachment | DriveLink)[]>(
    () => [...(q.data ?? []), ...(driveQ.data ?? [])],
    [q.data, driveQ.data],
  );
  const toItem = useCallback(
    (t: IssueAttachment | DriveLink) =>
      'driveFileId' in t ? issueDriveLinkItem(projectKey, number, t) : issueAttachmentItem(projectKey, number, t),
    [projectKey, number],
  );
  // 이 화면이 여는 키(file:·drive:)만 다룬다 — 다른 용도의 ?preview 값을 "찾을 수 없음"으로 안내하지 않게.
  const ownKey = /^(file|drive):\d+$/.test(previewParam.value ?? '') ? previewParam.value : null;
  const viewer = useViewerBundle({
    list: sources,
    toItem,
    currentKey: ownKey,
    // 두 조회가 모두 끝나면(실패 포함) 판정한다 — 하나가 실패해도 딥링크가 뷰어도 안내도 없이 낡은 ?preview 로 남지 않게.
    ready: (q.isSuccess || q.isError) && (driveQ.isSuccess || driveQ.isError),
    openKey: previewParam.open,
  });

  // 원본을 찾으면 viewer.open 으로 스냅숏을 먼저 둔다(목록이 잠시 비어도 바로 보이게), 못 찾으면 키만 연다.
  const onPreview = (key: string) => {
    const t = sources.find((s) => toItem(s).key === key);
    if (t) viewer.open(t);
    else previewParam.open(key);
  };

  const viewerNode = (
    <>
      {viewer.bundle && (
        <AttachmentViewer
          items={viewer.bundle.items}
          index={viewer.bundle.index}
          onIndexChange={viewer.onIndexChange}
          onClose={previewParam.close}
        />
      )}
      {viewer.missing && (
        <ViewerNotFound onClose={previewParam.close} description="삭제되었거나 이 이슈에서 빠진 첨부입니다." />
      )}
    </>
  );
  return { onPreview, viewerNode };
}
