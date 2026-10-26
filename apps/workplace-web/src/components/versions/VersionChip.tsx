// 버전 칩(WP-888) — 이슈에 붙은 수정 버전·영향 버전 이름. 라벨(색 꼬리표)·구성요소와 구분되게 색 없이 테두리 + ▲ 아이콘으로 그린다.
// 보관된 버전은 점선 테두리 + 흐린 글자 + 「(보관됨)」 툴팁·스크린리더 문구로 — 이미 붙은 값은 보이되 새로 붙일 수 없다는 것을 알린다.
// projectKey 가 있으면 버전 상세로 가는 링크, 없으면 글자만(목록 칸은 행 전체가 이슈 상세로 가는 링크라 안에 링크를 중첩하지 않는다).

import { Triangle } from 'lucide-react';
import { Link } from 'react-router-dom';

import { splitChips } from '../../lib/issueComponents';
import { isArchived, versionTitle } from '../../lib/issueVersions';
import { cn } from '../../lib/utils';
import type { VersionSummary } from '../../types/version';

export function VersionChip({
  version,
  projectKey,
  size = 'md',
}: {
  version: Pick<VersionSummary, 'id' | 'name' | 'status'>;
  /** 있으면 칩이 버전 상세 링크가 된다. */
  projectKey?: string;
  /** sm = 목록 칸·필터 옵션(작게), md = 상세. */
  size?: 'sm' | 'md';
}) {
  const archived = isArchived(version);
  const className = cn(
    'inline-flex max-w-full items-center gap-1 rounded-sm border border-border text-xs',
    size === 'sm' ? 'px-1 py-0' : 'px-1.5 py-0.5',
    // 보관: 실선 대신 점선 + 이름도 흐리게 — 글자색만으로는 구분이 약하다.
    archived ? 'border-dashed border-muted-foreground/50 text-muted-foreground' : 'text-foreground',
    projectKey && 'hover:bg-accent',
  );
  const body = (
    <>
      <Triangle className={cn('shrink-0 text-muted-foreground', size === 'sm' ? 'size-3' : 'size-3.5')} aria-hidden />
      {/* 이름은 8rem 에서 말줄임 — 긴 버전 이름이 칸 폭을 잡아먹지 않게. */}
      <span className="max-w-[8rem] truncate">{version.name}</span>
      {archived && <span className="sr-only">(보관됨)</span>}
    </>
  );
  const title = versionTitle(version);
  return projectKey ? (
    <Link to={`/projects/${projectKey}/versions/${version.id}`} className={className} title={title} data-testid={`version-chip-${version.id}`}>
      {body}
    </Link>
  ) : (
    <span className={className} title={title}>
      {body}
    </span>
  );
}

/**
 * 버전 칩 묶음 — 앞 max 개 + 넘친 수 「+N」(목록 칸은 2개). 없으면 아무것도 그리지 않는다.
 * 다 못 보인 이름은 hover 로 읽게 묶음 title 에 전체 이름을 둔다.
 */
export function VersionChips({
  versions,
  max = 2,
  size = 'sm',
  testId,
  className,
}: {
  versions: Pick<VersionSummary, 'id' | 'name' | 'status'>[];
  max?: number;
  size?: 'sm' | 'md';
  testId?: string;
  className?: string;
}) {
  if (versions.length === 0) return null;
  const { shown, rest } = splitChips(versions, max);
  return (
    <span
      className={cn('inline-flex min-w-0 items-center gap-1', className)}
      title={versions.map(versionTitle).join(', ')}
      data-testid={testId}
    >
      {shown.map((v) => (
        <VersionChip key={v.id} version={v} size={size} />
      ))}
      {rest > 0 && <span className="shrink-0 text-xs text-muted-foreground">+{rest}</span>}
    </span>
  );
}
