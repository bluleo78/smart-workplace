// 이슈 첨부 목록 — 자신이 부착했거나 프로젝트 OWNER 면 삭제 버튼 노출.
// layout='strip' 이면 flex 가로 래핑 칩 컨테이너로 렌더.
// 무엇을: 기존 세로 목록(list)과 본문 스트립(strip) 두 레이아웃 지원.
// 왜: 본문 이동(#343) 시 IssueAttachmentStrip 에서 strip 모드로 재사용.
// #80: 드라이브 링크도 동일 목록 하단에 병합 렌더.
// WP-277: 첨부·드라이브 링크 이름 클릭 시 통합 뷰어(AttachmentViewer)를 연다 — 열림은 URL ?preview, 뷰어는 driveLinksOnly 가 아닌 인스턴스만 렌더.

import { useMemo, useState } from 'react';

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
import { AttachmentViewer } from '../../../components/viewer/AttachmentViewer';
import { issueAttachmentItem, issueDriveLinkItem, resolveBundle } from '../../../components/viewer/viewerItems';
import { useDeleteIssueAttachment } from '../../../hooks/queries/useDeleteIssueAttachment';
import { useIssueAttachments } from '../../../hooks/queries/useIssueAttachments';
import { useIssueDriveLinks, useRemoveIssueDriveLink } from '../../../hooks/queries/useIssueDriveLinks';
import { useHistoryParam } from '../../../hooks/useHistoryParam';
import { IssueAttachmentItem } from './IssueAttachmentItem';
import { IssueDriveLinkItem } from './IssueDriveLinkItem';

export function IssueAttachmentList({
  projectKey,
  number,
  currentUserId,
  isOwner,
  layout = 'list',
  driveLinksOnly = false,
}: {
  projectKey: string;
  number: number;
  currentUserId: number | null;
  isOwner: boolean;
  /** 렌더 레이아웃 — 'list': 기존 세로 목록(기본), 'strip': 가로 칩 래핑 */
  layout?: 'list' | 'strip';
  /** true 면 드라이브 링크만 렌더 (업로드 첨부 제외). 스트립에서 분리 렌더 시 사용. */
  driveLinksOnly?: boolean;
}) {
  // driveLinksOnly 모드에서는 업로드 첨부 쿼리 비활성화 (불필요 요청 방지 #80 Fix 6).
  const q = useIssueAttachments(projectKey, number, { enabled: !driveLinksOnly });
  const del = useDeleteIssueAttachment(projectKey, number);
  // #80: 드라이브 링크 쿼리 + 제거 mutation.
  const driveQ = useIssueDriveLinks(projectKey, number);
  const removeLink = useRemoveIssueDriveLink(projectKey, number);
  // 삭제 확인 다이얼로그 — window.confirm 대체 (#148).
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);
  // 드라이브 링크 제거 확인 다이얼로그.
  const [pendingRemoveLinkId, setPendingRemoveLinkId] = useState<number | null>(null);
  // WP-277: 묶음 = 이 이슈의 업로드 첨부 + 드라이브 링크(목록 순서 그대로). 열림은 URL ?preview(뒤로가기 = 닫기).
  const previewParam = useHistoryParam('preview');
  const items = q.data;
  const links = driveQ.data;
  const bundleItems = useMemo(
    () => [
      ...(driveLinksOnly ? [] : (items ?? [])).map((a) => issueAttachmentItem(projectKey, number, a)),
      ...(links ?? []).map((l) => issueDriveLinkItem(projectKey, number, l)),
    ],
    [items, links, driveLinksOnly, projectKey, number],
  );
  const bundle = resolveBundle(bundleItems, previewParam.value, null);

  // driveLinksOnly 모드: driveQ 만, 업로드 모드: q 만 기다림 (서로 독립, 파트A #80 Fix).
  if (driveLinksOnly ? driveQ.isLoading : q.isLoading) {
    return <p className="text-xs text-muted-foreground py-2">로딩 중…</p>;
  }
  // driveLinksOnly 모드: 드라이브 링크만 표시 (업로드 첨부는 별도 strip 에서 렌더).
  const visibleItems = driveLinksOnly ? [] : (items ?? []);
  const linkList = links ?? [];

  if (visibleItems.length === 0 && linkList.length === 0) {
    // strip 모드 또는 driveLinksOnly 빈 상태: 조용히 null 반환.
    if (layout === 'strip' || driveLinksOnly) return null;
    return <p className="text-xs text-muted-foreground py-2">첨부가 없습니다</p>;
  }

  // strip 모드: flex 가로 래핑 컨테이너
  const listClass = layout === 'strip' ? 'flex flex-wrap gap-2' : undefined;

  return (
    <>
      <ul data-testid="attachment-list" className={listClass}>
        {/* 업로드 첨부 먼저 */}
        {visibleItems.map((a) => (
          <IssueAttachmentItem
            key={a.fileId}
            projectKey={projectKey}
            number={number}
            attachment={a}
            canDelete={a.attachedById === currentUserId || isOwner}
            layout={layout}
            onPreview={(a) => previewParam.open(`file:${a.fileId}`)}
            onDelete={(fileId) => {
              // 삭제 확인은 AlertDialog 에서 처리 — window.confirm 대체 (#148).
              setPendingDeleteId(fileId);
            }}
          />
        ))}
        {/* 드라이브 링크 (list 모드에서만 노출 — strip 은 칩 레이아웃 미지원) */}
        {layout !== 'strip' && linkList.map((link) => (
          <IssueDriveLinkItem
            key={link.driveFileId}
            projectKey={projectKey}
            number={number}
            link={link}
            canManage={link.createdById === currentUserId || isOwner}
            onPreview={() => previewParam.open(`drive:${link.driveFileId}`)}
            onRemove={(driveFileId) => setPendingRemoveLinkId(driveFileId)}
          />
        ))}
      </ul>

      {/* 통합 뷰어 — strip(본문)과 list 가 한 화면에 함께 마운트되므로 driveLinksOnly 인스턴스는 그리지 않는다(두 번 뜨지 않게).
          그 인스턴스의 묶음에 드라이브 링크도 들어 있어 링크 클릭도 이 뷰어가 받는다. */}
      {!driveLinksOnly && bundle && (
        <AttachmentViewer
          items={bundle.items}
          index={bundle.index}
          onIndexChange={(i) => {
            const target = bundle.items[i];
            if (target) previewParam.open(target.key); // 목록이 줄어 범위를 벗어난 요청은 무시
          }}
          onClose={previewParam.close}
        />
      )}

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

      {/* 드라이브 링크 제거 확인 AlertDialog (#80) */}
      <AlertDialog
        open={pendingRemoveLinkId != null}
        onOpenChange={(open) => { if (!open) setPendingRemoveLinkId(null); }}
      >
        <AlertDialogContent data-testid="drive-link-remove-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>드라이브 링크 제거</AlertDialogTitle>
            <AlertDialogDescription>
              이슈에서 드라이브 파일 링크를 제거하시겠습니까? 드라이브 파일 자체는 삭제되지 않습니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => { if (pendingRemoveLinkId != null) removeLink.mutate(pendingRemoveLinkId); }}
              data-testid="drive-link-remove-confirm"
            >
              제거
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
