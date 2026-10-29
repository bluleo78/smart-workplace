// 일정 참석자에 조직·내 그룹을 고르는 시점의 사람으로 풀어 넣기(WP-1059) — 참석 응답이 사람별이라 그룹 자체는 참석자로 두지 않는다(에픽 WP-1054 원칙).
// 넣을 사람 계산은 공용(members/personalGroups 의 planGroupExpansion)이고, 여기는 참석자 한도와 확인 줄 문구만 둔다.
import { groupExpansionMessage,type GroupExpansionPlan } from '../members/personalGroups'

/** 한 번에 넣을 수 있는 참석자 수 — 서버 한도(일정 만들기 attendeeUserIds·초대 userIds 의 @Size(max=500))와 같다. */
export const ATTENDEE_LIMIT = 500

/** 넣으면 한도를 넘는지 — 넘으면 넣지 않는다. */
export function isOverLimit(plan: GroupExpansionPlan): boolean {
  return plan.toAdd.length > plan.capacity
}

/** 확인 줄의 본문 — 「개발팀 구성원 12명을 참석자로 추가합니다」. 넣을 사람이 없으면 그 까닭(이미 모두 있음·추가할 사람 없음). */
export function groupInviteTitle(groupName: string, plan: GroupExpansionPlan): string {
  if (plan.toAdd.length === 0) return groupExpansionMessage(groupName, 0, plan.skipped)
  return `${groupName} 구성원 ${plan.toAdd.length}명을 참석자로 추가합니다`
}

/** 확인 줄의 부연 — 뺀 사람(「이미 있는 1명·나 제외」)과 한도. 넣을 사람이 없으면 비운다. */
export function groupInviteDetail(plan: GroupExpansionPlan): string {
  if (plan.toAdd.length === 0) return ''
  // 만들기에서 이미 고른 사람이 있으면 한도보다 남은 자리가 적다 — 왜 막혔는지 알 수 있게 남은 자리를 함께 알린다.
  // 남은 자리가 없으면(만들기에서 이미 한도만큼 골랐다) 「0명만·-3명만」이 아니라 더 넣을 수 없다고 알린다(WP-1112).
  if (isOverLimit(plan)) {
    if (plan.capacity <= 0) return `참석자는 ${ATTENDEE_LIMIT}명까지라 더 넣을 수 없습니다`
    return plan.capacity < ATTENDEE_LIMIT
      ? `참석자는 ${ATTENDEE_LIMIT}명까지라 ${plan.capacity}명만 더 넣을 수 있습니다`
      : `한 번에 ${ATTENDEE_LIMIT}명까지 넣을 수 있습니다`
  }
  const excluded = [plan.skipped > 0 ? `이미 있는 ${plan.skipped}명` : '', plan.meIncluded ? '나' : ''].filter(Boolean)
  return [excluded.length > 0 ? `${excluded.join('·')} 제외` : '', '넣은 뒤 한 명씩 뺄 수 있습니다'].filter(Boolean).join(' · ')
}
