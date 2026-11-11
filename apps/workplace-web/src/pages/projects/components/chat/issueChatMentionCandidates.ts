// 이슈챗 @ 멘션 후보 합치기(WP-1492) — 스레드 참여자 + 그 프로젝트의 AI 구성원.
// 서버는 멘션된 AGENT 를 스레드 멤버로 자동 추가하고 깨우므로(ChatMessageService.doCreate), 아직 대화에 없는 프로젝트 AI 도
// 고를 수 있어야 한다. 사람은 지금처럼 참여자만 — 비참여 사람을 멘션해도 서버가 스레드에 들이지 않아 알림·응답이 없다.

import type { MentionCandidate } from '@/components/mentions/types';
import type { ChatMemberResponse } from '@/types/chat';
import type { MemberResponse } from '@/types/project';

/** 개인 비서 AI username 접두어 — 서버 `AgentUsernames.PERSONAL_ASSISTANT_PREFIX` 와 같은 값(결정적 username `__assistant_u{주인 id}`). */
const PERSONAL_ASSISTANT_PREFIX = '__assistant_u';

/**
 * 남의 개인 비서인지(WP-638) — 서버 `AgentUsernames.isOthersPersonalAssistant` 와 같은 판정.
 * 개인 비서는 주인의 AI 자격으로 도는 주인 전용 AI 라, 남이 멘션해도 서버가 스레드에 들이지 않는다 — 후보에 보이면 불러도 답이 없다.
 */
export function isOthersPersonalAssistant(username: string, viewerId: number): boolean {
  return username.startsWith(PERSONAL_ASSISTANT_PREFIX) && username !== `${PERSONAL_ASSISTANT_PREFIX}${viewerId}`;
}

/**
 * 이슈챗 멘션 후보 — 스레드 참여자를 먼저 두고, 프로젝트 멤버 중 AI(kind=AGENT)를 뒤에 붙인다(사용자 id 로 중복 제거).
 * 불러도 답할 수 없는 AI — 남의 개인 비서(서버가 깨우지 않음, ChatAgentWake)와 비활성 AI(프로젝트 멤버 행의 active=false) — 는
 * 참여자든 프로젝트 쪽이든 같은 규칙으로 뺀다. 사람 참여자는 서버가 준 그대로 둔다.
 * 직접 친 `@이름` 변환·낙관적 표시의 멘션 칩도 이 목록을 써야 고른 AI 와 결과가 어긋나지 않는다.
 */
export function issueChatMentionCandidates(
  threadMembers: ChatMemberResponse[],
  projectMembers: MemberResponse[] | undefined,
  viewerId: number,
): MentionCandidate[] {
  // 참여자 응답엔 active 가 없어 프로젝트 멤버 행으로 비활성 AI 를 안다.
  const inactive = new Set((projectMembers ?? []).filter((m) => m.active === false).map((m) => m.userId));
  /** 후보로 둘 수 있는지 — AI 만 거른다. */
  const usable = (m: { userId: number; username: string; kind: string }) =>
    m.kind !== 'AGENT' || (!inactive.has(m.userId) && !isOthersPersonalAssistant(m.username, viewerId));

  const out: MentionCandidate[] = threadMembers
    .filter(usable)
    .map(({ userId, username, name, kind }) => ({ userId, username, name, kind }));
  const seen = new Set(out.map((m) => m.userId));
  for (const m of projectMembers ?? []) {
    if (m.kind !== 'AGENT' || seen.has(m.userId) || !usable(m)) continue;
    seen.add(m.userId);
    out.push({ userId: m.userId, username: m.username, name: m.name, kind: m.kind });
  }
  return out;
}
