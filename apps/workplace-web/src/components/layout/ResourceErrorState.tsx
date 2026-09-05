import type { LucideIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';

interface ResourceErrorStateProps {
  /** 문맥에 맞는 아이콘 (예: 프로젝트 = FolderX, 이슈 = FileQuestion) */
  icon: LucideIcon;
  title: string;
  description: string;
  actionLabel: string;
  onAction: () => void;
}

// 존재하지 않거나 접근 권한이 없는 리소스(프로젝트/이슈) 진입 시 표시하는 에러 상태.
// 전역 404 페이지(NotFoundPage)와 동일하게 아이콘+제목+설명+액션 버튼 구조를 갖추되,
// 라우트 전용이 아닌 컨텍스트(프로젝트/이슈 상세)에서 재사용할 수 있도록 액션을 파라미터화한다.
export function ResourceErrorState({
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
}: ResourceErrorStateProps) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center min-h-[60vh]">
      <Icon className="h-12 w-12 text-muted-foreground" />
      <div className="space-y-2">
        <p className="text-lg font-semibold">{title}</p>
        <p className="text-sm text-muted-foreground max-w-md">{description}</p>
      </div>
      <Button variant="outline" onClick={onAction}>
        {actionLabel}
      </Button>
    </div>
  );
}
