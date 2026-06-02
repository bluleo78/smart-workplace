// components/mentions 공용 타입 — chat / messaging 어느 도메인에도 의존하지 않는 최소 형태.
// 도메인별 DTO(ChatMemberResponse / MentionResponse 등)는 구조적으로 이 타입에 호환되므로
// 호출처는 자기 타입을 그대로 넘겨도 타입 체크가 통과한다.

// 멘션 대상 사용자 종류 (사람 / AI 에이전트).
export type UserKind = 'HUMAN' | 'AGENT';

// @ suggestion 후보 (RichInput / MentionList 가 소비).
// username/name 으로 필터, name 표시, kind 로 AGENT 뱃지 표기.
export interface MentionCandidate {
  userId: number;
  username: string;
  name: string;
  kind: UserKind;
}

// 본문 <@id> 토큰 복원/세그먼트 분리에 쓰는 멘션 사용자 정보
// (mentionSerialize / parseMessageSegments 가 소비).
export interface MentionUser {
  id: number;
  name: string;
  kind: UserKind;
}
