// 채널·DM 의 @멘션 후보 조립 — 채널 멤버 ∪ 워크스페이스 AGENT, 비서 비가용이면 AGENT 제외(WP-412 에서 페이지 밖으로 분리).
import type { MentionCandidate, UserKind } from '@/components/mentions/types'

/**
 * 채널·DM @멘션 후보 = 멤버(채널 멤버/DM 참여자) ∪ 워크스페이스 AGENT(채널의 비멤버 AGENT 초대용, DM 은 undefined).
 * userId 로 dedup — 멤버 정보가 우선한다. RichInput 은 username 으로도 거르는데 멤버 응답엔 username 이 없어 name 으로 대체한다.
 * 비서 비가용(aiAvailable=false)이면 AGENT(=AI) 후보를 뺀다 — 멤버십·DM 자체는 두고 멘션으로 AI 를 트리거하지 않게 하는 게이트.
 */
export function channelMentionCandidates(
  members: { userId: number; name: string; kind: UserKind }[] | undefined,
  agents: MentionCandidate[] | undefined,
  aiAvailable: boolean,
): MentionCandidate[] {
  const byId = new Map<number, MentionCandidate>()
  for (const m of members ?? []) byId.set(m.userId, { userId: m.userId, username: m.name, name: m.name, kind: m.kind })
  for (const a of agents ?? []) if (!byId.has(a.userId)) byId.set(a.userId, a)
  const candidates = [...byId.values()]
  return aiAvailable ? candidates : candidates.filter((m) => m.kind !== 'AGENT')
}
