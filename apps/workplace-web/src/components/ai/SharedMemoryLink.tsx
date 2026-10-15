// WP-386 프로젝트 설정의 「AI 메모리」 섹션 — 한 줄 링크 「공용 AI 메모리 n개 · 관리」 → 설정 › AI 비서 › 메모리 공용 탭(그 공간 선택).
// 공간 목록(내가 읽을 수 있는 공간)에 그 프로젝트가 있을 때만 섹션째 보인다 — 개인 프로젝트·못 읽는 프로젝트·불러오기 실패면 숨긴다.
// 불러오는 동안은 섹션 자리를 미리 잡는다 — 응답 뒤에 섹션이 끼어들면 아래 섹션(멤버 등)이 밀려 누르려던 버튼이 움직인다.
import { Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';

import { SettingsSection } from '@/components/layout/SettingsSection';
import { Skeleton } from '@/components/ui/skeleton';
import { useSharedMemorySpaces } from '@/hooks/queries/useSharedAiMemories';
import { sharedMemoryHref } from '@/lib/sharedAiMemory';

export function SharedMemoryLink({ projectId }: { projectId: number }) {
  const spaces = useSharedMemorySpaces();
  const space = spaces.data?.items.find((s) => s.type === 'PROJECT' && s.id === projectId);
  if (!spaces.isPending && !space) return null;
  return (
    <SettingsSection title="AI 메모리" description="이 프로젝트에서 일하는 AI가 함께 읽는 팀 규칙이에요.">
      {!space ? (
        <Skeleton data-testid="shared-memory-link-pending" className="h-5 w-48" />
      ) : (
        <Link
          to={sharedMemoryHref({ type: 'PROJECT', id: projectId })}
          data-testid="shared-memory-link"
          className="group inline-flex items-center gap-1.5 rounded-sm text-sm text-muted-foreground hover:text-foreground pointer-coarse:min-h-11"
        >
          <Sparkles aria-hidden className="size-3.5 shrink-0 text-ai-accent" />
          <span>공용 AI 메모리 {space.count}개</span>
          <span aria-hidden>·</span>
          <span className="font-medium text-primary underline-offset-2 group-hover:underline">관리</span>
        </Link>
      )}
    </SettingsSection>
  );
}
