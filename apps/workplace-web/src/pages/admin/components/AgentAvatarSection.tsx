// AI 아바타 바꾸기(WP-1222) — 관리자가 에이전트 상세에서 AI 의 프로필 이미지를 바꾸거나 기본(이니셜)으로 되돌린다.
// 내 아바타(설정 › 프로필)와 같은 AvatarEditor·자르기 창을 쓰고, 부르는 API 만 관리자용(`/admin/agents/{id}/avatar`)이다.
// 개인 비서(PERSONAL)는 주인 전용이라(WP-1163) 이 섹션을 띄우지 않는다 — 판정은 부모(canAdminConfigure)가 한다.
import { deleteAgentAvatar, uploadAgentAvatar } from '@/api/agents'
import { AvatarEditor } from '@/components/users/AvatarEditor'
import { useAvatarUrl } from '@/hooks/avatar-map-context'
import { useAfterAvatarChange } from '@/hooks/queries/useAvatars'
import type { AgentResponse } from '@/types/agent'

export function AgentAvatarSection({ agent }: { agent: AgentResponse }) {
  // AgentResponse 에는 아바타 주소가 없다 — 앱 공통 아바타 표(GET /users/avatars)에서 찾는다.
  const avatarUrl = useAvatarUrl(agent.id)
  // 바꾼 뒤 아바타 표를 다시 받는다 — 목록·상세·채팅의 이 AI 모습이 함께 바뀐다(실패는 삼킨다).
  const refresh = useAfterAvatarChange()

  return (
    <div className="space-y-2" data-testid="agent-avatar-section">
      <h3 className="text-sm font-medium">아바타</h3>
      <AvatarEditor
        testId="agent-avatar"
        userId={agent.id}
        name={agent.name}
        avatarUrl={avatarUrl}
        upload={async (file, crop) => {
          await uploadAgentAvatar(agent.id, file, crop)
          await refresh()
        }}
        reset={async () => {
          await deleteAgentAvatar(agent.id)
          await refresh()
        }}
      />
    </div>
  )
}
