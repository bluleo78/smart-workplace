// 이슈 첨부 목록 — 자신이 부착했거나 프로젝트 OWNER 면 삭제 버튼 노출.
// layout='strip' 이면 flex 가로 래핑 칩 컨테이너로 렌더.
// 무엇을: 기존 세로 목록(list)과 본문 스트립(strip) 두 레이아웃 지원.
// 왜: 본문 이동(#343) 시 IssueAttachmentStrip 에서 strip 모드로 재사용.
// #80: 드라이브 링크도 동일 목록 하단에 병합 렌더.
// WP-277: 첨부·드라이브 링크 이름 클릭은 onPreview(묶음 키)로 부모(IssueAttachmentStrip)에 알린다 —
//         URL ?preview·묶음·뷰어는 부모의 useIssueAttachmentViewer 하나가 업로드·링크 목록 모두를 맡는다.

import { useId, useState } from 'react';

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
import { driveViewerKey, fileViewerKey } from '../../../components/viewer/viewerItems';
import { useDeleteIssueAttachment } from '../../../hooks/queries/useDeleteIssueAttachment';
import { useIssueAttachments } from '../../../hooks/queries/useIssueAttachments';
import { useIssueDriveLinks, useRemoveIssueDriveLink } from '../../../hooks/queries/useIssueDriveLinks';
import type { IssueAttachment } from '../../../types/attachment';
import type { DriveLink } from '../../../types/drive';
import { IssueAttachmentItem } from './IssueAttachmentItem';
import { IssueDriveLinkItem } from './IssueDriveLinkItem';

// strip 접기 기준 — 이 개수를 넘으면(> 12) 앞 12개만 보이고 「n개 더 보기」 로 펼친다(WP-2118).
const STRIP_COLLAPSED_COUNT = 12;

export function IssueAttachmentList({
  projectKey,
  number,
  currentUserId,
  isOwner,
  layout = 'list',
  driveLinksOnly = false,
  onPreview,
}: {
  projectKey: string;
  number: number;
  currentUserId: number | null;
  isOwner: boolean;
  /** 렌더 레이아웃 — 'list': 기존 세로 목록(기본), 'strip': 가로 칩 래핑 */
  layout?: 'list' | 'strip';
  /** true 면 드라이브 링크만 렌더 (업로드 첨부 제외). 스트립에서 분리 렌더 시 사용. */
  driveLinksOnly?: boolean;
  /** 이름 클릭 — 묶음 키(`file:{fileId}`·`drive:{driveFileId}`)로 부모가 통합 뷰어를 연다. */
  onPreview: (key: string) => void;
}) {
  // driveLinksOnly 모드에서는 업로드 첨부 쿼리 비활성화 (불필요 요청 방지 #80 Fix 6).
  const q = useIssueAttachments(projectKey, number, { enabled: !driveLinksOnly });
  const del = useDeleteIssueAttachment(projectKey, number);
  // #80: 드라이브 링크 쿼리 + 제거 mutation.
  const driveQ = useIssueDriveLinks(projectKey, number);
  const removeLink = useRemoveIssueDriveLink(projectKey, number);
  // 첨부 삭제 확인 다이얼로그 — window.confirm 대체 (#148). 대상은 누른 첨부 그대로 들고(WP-1919), 열림은 따로 둔다.
  // 대상을 닫을 때 비우지 않는 까닭: 닫히는 애니메이션 동안이나 목록이 다시 불려 첨부가 빠져도 확인창 글이 다른 파일·빈 이름으로 바뀌지 않게.
  const [deleteTarget, setDeleteTarget] = useState<IssueAttachment | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  // 드라이브 링크 제거 확인 다이얼로그 — 대상은 누른 링크 그대로 들고(WP-1871), 열림은 따로 둔다.
  // 대상을 닫을 때 비우지 않는 까닭: 닫히는 애니메이션 동안이나 목록이 다시 불려 링크가 빠져도 확인창 글이 다른 파일·빈 이름으로 바뀌지 않게.
  const [removeTarget, setRemoveTarget] = useState<DriveLink | null>(null);
  const [removeOpen, setRemoveOpen] = useState(false);
  // strip 칩 접기 상태 — 많을 때 본문을 길게 밀어내지 않도록 기본은 접힘.
  const [expanded, setExpanded] = useState(false);
  const listId = useId();
  // 접기 대상 판정은 훅 뒤 조기 반환보다 먼저 — 단추가 사라지면(12개 이하) 펼침 상태도 접힘으로 되돌린다.
  const stripCollapsible = layout === 'strip' && !driveLinksOnly && (q.data?.length ?? 0) > STRIP_COLLAPSED_COUNT;
  // 렌더 중 이전 값 비교로 상태를 맞춘다(effect 대신) — 13→펼침→11→14 에서 14개가 펼쳐진 채 나오지 않게.
  const [prevCollapsible, setPrevCollapsible] = useState(stripCollapsible);
  if (prevCollapsible !== stripCollapsible) {
    setPrevCollapsible(stripCollapsible);
    if (!stripCollapsible) setExpanded(false);
  }

  // driveLinksOnly 모드: driveQ 만, 업로드 모드: q 만 기다림 (서로 독립, 파트A #80 Fix).
  if (driveLinksOnly ? driveQ.isLoading : q.isLoading) {
    return <p className="text-xs text-muted-foreground py-2">로딩 중…</p>;
  }
  const items = q.data ?? [];
  const links = driveQ.data ?? [];

  // driveLinksOnly 모드: 드라이브 링크만 표시 (업로드 첨부는 별도 strip 에서 렌더).
  const visibleItems = driveLinksOnly ? [] : items;

  if (visibleItems.length === 0 && links.length === 0) {
    // strip 모드 또는 driveLinksOnly 빈 상태: 조용히 null 반환.
    if (layout === 'strip' || driveLinksOnly) return null;
    return <p className="text-xs text-muted-foreground py-2">첨부가 없습니다</p>;
  }

  // strip 모드: flex 가로 래핑 컨테이너
  // 접기 판정은 위 stripCollapsible 하나를 쓴다(driveLinksOnly 면 visibleItems 가 비어 같은 결과).
  const collapsible = stripCollapsible;
  const shownItems = collapsible && !expanded ? visibleItems.slice(0, STRIP_COLLAPSED_COUNT) : visibleItems;
  const listClass = layout === 'strip' ? 'flex flex-wrap gap-2' : undefined;

  return (
    <>
      <ul id={listId} data-testid="attachment-list" className={listClass}>
        {/* 업로드 첨부 먼저 */}
        {shownItems.map((a) => (
          <IssueAttachmentItem
            key={a.fileId}
            projectKey={projectKey}
            number={number}
            attachment={a}
            canDelete={a.attachedById === currentUserId || isOwner}
            layout={layout}
            onPreview={(att) => onPreview(fileViewerKey(att.fileId))}
            onDelete={() => {
              // 삭제 확인은 AlertDialog 에서 처리 — window.confirm 대체 (#148). 이름을 보이려고 첨부 객체를 대상으로 든다.
              setDeleteTarget(a);
              setDeleteOpen(true);
            }}
          />
        ))}
        {/* 드라이브 링크 (list 모드에서만 노출 — strip 은 칩 레이아웃 미지원) */}
        {layout !== 'strip' && links.map((link) => (
          <IssueDriveLinkItem
            key={link.driveFileId}
            projectKey={projectKey}
            number={number}
            link={link}
            canManage={link.createdById === currentUserId || isOwner}
            onPreview={() => onPreview(driveViewerKey(link.driveFileId))}
            onRemove={() => {
              setRemoveTarget(link);
              setRemoveOpen(true);
            }}
          />
        ))}
      </ul>
      {collapsible && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-controls={listId}
          className="text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          {expanded ? '접기' : `${visibleItems.length - STRIP_COLLAPSED_COUNT}개 더 보기`}
        </button>
      )}

      {/* 첨부 삭제 확인 AlertDialog — window.confirm 대체 (#148) */}
      <AlertDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
      >
        <AlertDialogContent data-testid="attachment-delete-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>첨부 삭제</AlertDialogTitle>
            {/* 첨부가 여럿이어도 어느 파일을 지우는지 다시 확인하게 이름을 넣는다(WP-1919). 줄바꿈은 공용 AlertDialogHeader(wrap-anywhere — 머리 안 제목·설명이 물려받음)가 맡는다(WP-1921). */}
            <AlertDialogDescription>
              「{deleteTarget?.originalName}」 첨부를 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => { if (deleteTarget) del.mutate(deleteTarget.fileId); }}
              data-testid="attachment-delete-confirm"
            >
              삭제
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 드라이브 링크 제거 확인 AlertDialog (#80) */}
      <AlertDialog
        open={removeOpen}
        onOpenChange={setRemoveOpen}
      >
        <AlertDialogContent data-testid="drive-link-remove-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>드라이브 링크 제거</AlertDialogTitle>
            {/* 링크가 여럿이어도 어느 파일을 빼는지 다시 확인하게 이름을 넣는다(WP-1871). */}
            <AlertDialogDescription>
              「{removeTarget?.name}」 링크를 이슈에서 제거하시겠습니까? 드라이브 파일 자체는 삭제되지 않습니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => { if (removeTarget) removeLink.mutate(removeTarget.driveFileId); }}
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
