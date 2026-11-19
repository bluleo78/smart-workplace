// 사람 카드 데이터 훅(WP-1767) — 카드를 열 때만 프로필·소속 그룹·AI 작업 수를 받는다.
//  - 프로필(직책·이메일·활성·설명): HUMAN·AGENT 공통 membersApi.getMember.
//  - 소속 그룹: HUMAN 만(연락처 상세 API 는 AGENT 에 404).
//  - 작업 수: AGENT 만 — AI별 현황(fetchAiAgents 'ALL')에서 그 AI 의 slotsUsed.
// 어느 요청이 실패해도 그 값만 undefined 가 되고 카드는 PersonRef 만으로 그려진다(재시도 없이 바로 대체).
import { keepPreviousData, useQuery } from '@tanstack/react-query'

import { fetchAiAgents } from '@/api/aiAgents'
import { contactsApi } from '@/api/contacts'
import { membersApi } from '@/api/members'
import { contactKeys } from '@/hooks/queries/contactKeys'
import { AI_AGENTS_REFRESH_MS, aiAgentsKeys } from '@/hooks/queries/useAiAgents'
import { memberKeys } from '@/hooks/queries/useMembers'
import type { MemberSummary } from '@/types/member'

// 프로필·소속 그룹은 자주 바뀌지 않는다 — 긴 코멘트·챗에서 같은 이름을 다시 열 때 다시 받지 않게(무효화는 'members'·연락처 키가 맡는다).
const CARD_STALE_MS = 5 * 60_000

/** 카드가 가리키는 사람 — 호출부가 이미 아는 최소 정보(프로필을 받기 전에도 머리를 그린다). */
export type PersonRef = {
  id: number
  name: string
  /** 모르면 생략 — 노트 편집자·접속자처럼 kind 를 모르는 호출부는 프로필의 kind 로 정한다(WP-1768). */
  kind?: 'HUMAN' | 'AGENT'
  username?: string
  /** 호출부가 알면 넘긴다 — false 면 프로필 응답 전에도 「비활성 멤버」. */
  active?: boolean
}

export interface PersonCardData {
  profile?: MemberSummary
  /** 해석된 kind — person.kind 가 우선, 없으면 프로필의 kind. 프로필 응답 전(또는 실패)에는 undefined. */
  kind?: 'HUMAN' | 'AGENT'
  groups?: string[]
  slotsUsed?: number
  /** 프로필 요청이 아직 처음 응답 전인가 — 비활성·이메일 판정을 미뤄야 하는 동안 true. */
  profileLoading: boolean
}

/** 카드 내용(PersonCardBody)이 마운트될 때 부른다 — Radix 가 닫힌 카드는 마운트하지 않으므로 요청은 카드를 열었을 때만 간다. */
export function usePersonCard(person: PersonRef): PersonCardData {
  const profile = useQuery({
    queryKey: memberKeys.detail(person.id),
    queryFn: () => membersApi.getMember(person.id).then((r) => r.data),
    staleTime: CARD_STALE_MS,
    retry: false,
  })
  // kind 가 정해진 뒤에야 연락처·AI 현황을 요청한다 — 모르는 동안은 프로필만 받는다.
  const kind = person.kind ?? profile.data?.kind
  const contact = useQuery({
    queryKey: contactKeys.member(person.id),
    queryFn: () => contactsApi.getMember(person.id).then((r) => r.data),
    enabled: kind === 'HUMAN',
    staleTime: CARD_STALE_MS,
    retry: false,
  })
  // AI별 현황은 다른 화면(useAiAgents 'ALL')과 같은 키·주기로 같은 캐시를 쓴다 — 이미 받아 둔 게 있으면 바로 보인다.
  // useAiAgents 는 enabled 를 받지 않아(WP-1781) 사람 카드에서는 AI 일 때만 받도록 같은 쿼리를 직접 쓴다.
  const agents = useQuery({
    queryKey: aiAgentsKeys.scope('ALL'),
    queryFn: () => fetchAiAgents('ALL'),
    enabled: kind === 'AGENT',
    placeholderData: keepPreviousData,
    refetchInterval: AI_AGENTS_REFRESH_MS,
  })
  const slotsUsed = agents.data?.agents.find((a) => a.agent.id === person.id)?.slotsUsed
  return {
    profile: profile.data,
    kind,
    groups: contact.data?.groups,
    slotsUsed,
    profileLoading: profile.isLoading,
  }
}
