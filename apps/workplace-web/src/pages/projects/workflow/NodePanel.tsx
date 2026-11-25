import { GitBranch, Play, Square, User } from 'lucide-react'

import { AiIcon } from '@/components/ai/AiIcon'

/**
 * 노드 종류별 아이콘. 장식이라 스크린리더에서는 숨긴다.
 * 노드 편집 패널은 노드 서랍(NodeDrawer, WP-2091)으로 옮겨 이 파일에는 캔버스 카드·서랍 머리가 함께 쓰는 아이콘만 남는다.
 */
export function NodeKindIcon({ type, className }: { type: string; className?: string }) {
  const cls = className ?? 'size-4 shrink-0'
  if (type === 'agent_task') return <AiIcon className={cls} />
  if (type === 'human_task') return <User className={cls} aria-hidden="true" />
  if (type === 'start') return <Play className={cls} aria-hidden="true" />
  if (type === 'end') return <Square className={cls} aria-hidden="true" />
  return <GitBranch className={cls} aria-hidden="true" />
}
