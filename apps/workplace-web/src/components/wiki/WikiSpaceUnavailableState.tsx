import { FolderX } from 'lucide-react'

import { ResourceErrorState } from '@/components/layout/ResourceErrorState'

/** 볼 수 없거나 없는 노트 공간 안내(WP-559) — 데스크톱 본문·모바일 공간 목록이 같이 쓴다. */
export function WikiSpaceUnavailableState({ onBack }: { onBack: () => void }) {
  return (
    <div data-testid="wiki-space-unavailable" className="flex flex-1 flex-col">
      <ResourceErrorState
        icon={FolderX}
        title="노트 공간을 찾을 수 없습니다"
        description="요청한 노트 공간이 존재하지 않거나 접근 권한이 없습니다."
        actionLabel="노트 목록으로"
        onAction={onBack}
      />
    </div>
  )
}
