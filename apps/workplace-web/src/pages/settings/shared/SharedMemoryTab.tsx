// WP-386 설정 › AI 비서 › 메모리 「공용 메모리」 탭 — 데스크톱은 두 칸(왼쪽 공간 목록 13rem · 오른쪽 목록), 모바일은 위쪽 선택 상자 + 목록.
// 두 칸 여부는 뷰포트가 아니라 탭 자신의 폭(@container 640px)으로 정한다 — 설정 주석 섹션(WP-397)의 입력 열 안에 있어 노트북 폭에서도 좁아질 수 있다.
// CSS 로만 갈라 측정·리렌더가 없고, 경계를 넘어도 래퍼가 같아 목록(검색어·추가 폼)이 다시 마운트되지 않는다.
// 고른 공간은 쿼리(?space=PROJECT:12)에 둔다 — 없거나 읽을 수 없는 값이면 첫 프로젝트·노트 스페이스(없으면 조직)를 고른다(쿼리는 바꾸지 않는다).
// 권한은 서버 값(canAdd·canManage·canEdit)만 따른다.
import { useSearchParams } from 'react-router-dom';

import { Skeleton } from '@/components/ui/skeleton';
import { useSharedMemorySpaces } from '@/hooks/queries/useSharedAiMemories';
import { MEMORY_TAB_PARAM, parseSpaceParam, refOf, sameSpace, SPACE_PARAM, spaceParam } from '@/lib/sharedAiMemory';
import { SharedMemoryHistoryButton } from '@/pages/settings/shared/SharedMemoryHistory';
import { SharedMemoryList } from '@/pages/settings/shared/SharedMemoryList';
import { SharedSpacePicker } from '@/pages/settings/shared/SharedSpacePicker';
import type { SharedSpaceRef } from '@/types/sharedAiMemory';

export function SharedMemoryTab() {
  const spaces = useSharedMemorySpaces();
  const [params, setParams] = useSearchParams();
  const list = spaces.data?.items ?? [];
  const asked = parseSpaceParam(params.get(SPACE_PARAM));
  const space = list.find((s) => sameSpace(refOf(s), asked)) ?? list.find((s) => s.type !== 'ORG') ?? list[0];
  const select = (ref: SharedSpaceRef) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        n.set(MEMORY_TAB_PARAM, 'shared');
        n.set(SPACE_PARAM, spaceParam(ref));
        return n;
      },
      { replace: true },
    );

  if (spaces.isPending) return <Skeleton data-testid="shared-memory-tab" className="h-24 w-full" />;
  if (spaces.isError) {
    return (
      <p data-testid="shared-memory-tab" className="text-sm text-destructive">
        공용 메모리를 불러오지 못했어요.
      </p>
    );
  }
  if (!space) {
    return (
      <p data-testid="shared-memory-tab" className="text-sm text-muted-foreground">
        아직 볼 수 있는 공용 메모리 공간이 없어요.
      </p>
    );
  }
  const picker = <SharedSpacePicker spaces={list} selected={refOf(space)} onSelect={select} />;
  // key — 공간을 바꾸면 검색어·추가 폼을 비운다.
  const body = <SharedMemoryList key={spaceParam(refOf(space))} space={space} headerAction={<SharedMemoryHistoryButton space={space} />} />;
  return (
    // 640px — 공간 목록(13rem)·간격을 빼고 목록이 400px 남짓은 되어야 검색칸·버튼·행 동작이 한 줄에 든다(SharedSpacePicker·SharedMemoryList 도 같은 경계).
    <div data-testid="shared-memory-tab" className="@container">
      <div className="space-y-4 @min-[640px]:grid @min-[640px]:grid-cols-[13rem_minmax(0,1fr)] @min-[640px]:gap-5 @min-[640px]:space-y-0">
        <div className="@min-[640px]:border-r @min-[640px]:pr-3">{picker}</div>
        {body}
      </div>
    </div>
  );
}
