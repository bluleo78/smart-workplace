// 이슈 「관계」 그룹의 외부 링크 한 줄(WP-887) — 다른 시스템(Jira 등)에 남는 이슈로 가는 링크.
// 구성: 말(이 이슈 쪽) / 키(선택) + 제목(새 탭 링크) + ↗ 두 줄 + 수정·제거.
// 서버는 그 주소를 가져오지 않는다 — 제목은 사람이 적은 그대로. 새 탭은 opener 를 끊는다(noopener noreferrer).
// 조작은 IssueLinkRow 와 같은 규칙: 마우스는 hover·포커스 때 아이콘, 터치는 ⋯ 하나(WP-237).

import { ArrowUpRight, Pencil, Unlink, X } from 'lucide-react';

import { TouchRowActionsMenu } from '@/components/mobile/TouchRowActionsMenu';
import { Button } from '@/components/ui/button';
import { useIsCoarsePointer } from '@/hooks/useIsCoarsePointer';

import type { IssueExternalLinkView } from '../../types/issue';

export function IssueExternalLinkRow({
  link,
  onEdit,
  onRemove,
}: {
  link: IssueExternalLinkView;
  /** 없으면 수정 조작을 그리지 않는다(워크플로 편집 권한 없음). */
  onEdit?: () => void;
  /** 없으면 제거 조작을 그리지 않는다(워크플로 편집 권한 없음). */
  onRemove?: () => void;
}) {
  const isCoarse = useIsCoarsePointer();
  // 외부 차단은 블로커 계산에 들어가지 않으니 「(선행 필요)」를 붙이지 않고 서버 말 그대로(차단 중·차단됨).
  const label = link.label;
  const name = link.key ? `${link.key} ${link.title}` : link.title;
  const hasActions = onEdit != null || onRemove != null;

  return (
    // 두 줄 — 레일(280px)이 좁아 말·키·제목을 한 줄에 두면 제목이 거의 안 보인다. 위: 말(유형마다 다름), 아래: 키·제목·↗.
    <li
      className="group flex items-center gap-2 rounded px-1 -mx-1 py-1 text-sm hover:bg-accent/50"
      data-testid={`issue-external-link-row-${link.id}`}
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs text-muted-foreground">{label}</p>
        <a
          href={link.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex min-w-0 items-center gap-1.5 hover:underline"
          title={`${name}\n${link.url}`}
          data-testid={`issue-external-link-open-${link.id}`}
        >
          {link.key && <span className="shrink-0 font-mono text-xs text-muted-foreground">{link.key}</span>}
          <span className="truncate">{link.title}</span>
          <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-label="새 탭에서 열기" />
        </a>
      </div>
      {hasActions && (isCoarse ? (
        // 터치: ⋯ 하나에 수정·제거를 모은다 — 44px 영역이 행 높이를 키우지 않게 음수 세로 마진.
        <TouchRowActionsMenu
          title={name}
          ariaLabel={`${name} 더보기`}
          testId={`issue-external-link-more-${link.id}`}
          sheetTestId="issue-external-link-sheet"
          itemTestId={(key) => `issue-external-link-menu-${key}-${link.id}`}
          triggerClassName="-my-2.5"
          actions={[
            ...(onEdit ? [{ key: 'edit', label: '외부 링크 수정', icon: <Pencil />, onSelect: onEdit }] : []),
            ...(onRemove
              ? [{ key: 'remove', label: '외부 링크 제거', icon: <Unlink />, destructive: true, onSelect: onRemove }]
              : []),
          ]}
        />
      ) : (
        // 마우스: hover·키보드 포커스 때만 보인다(투명도로만 숨겨 Tab 순서에 남는다 — WP-468).
        <span className="flex shrink-0 items-center">
          {onEdit && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onEdit}
              aria-label="외부 링크 수정"
              className="size-6 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
              data-testid={`issue-external-link-edit-${link.id}`}
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          )}
          {onRemove && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onRemove}
              aria-label="외부 링크 제거"
              className="size-6 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
              data-testid={`issue-external-link-remove-${link.id}`}
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </span>
      ))}
    </li>
  );
}
