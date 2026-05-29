// 채팅 본문의 <@id> 토큰을 thread 멤버로 매핑해 mentions 배열을 만든다 (백엔드 hydrator 의 클라이언트 사본).
// optimistic 메시지가 서버 응답 전에도 멘션 칩 이름을 바르게 표시하도록 한다 (#43).
// E2E 의 백엔드 hydrator 모사도 이 함수를 공유해 동작 일치를 보장한다.

import type { ChatMemberResponse, ChatMentionResponse } from '../types/chat';

export function hydrateMentions(
  body: string,
  members: ChatMemberResponse[],
): ChatMentionResponse[] {
  const byId = new Map(members.map((m) => [m.userId, m]));
  // 등장 순서를 보존하면서 중복 id 를 제거.
  const ids = new Set<number>();
  const re = /<@(\d+)>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) ids.add(Number(m[1]));
  return [...ids]
    .map((id) => byId.get(id))
    .filter((mem): mem is ChatMemberResponse => mem !== undefined)
    .map((mem) => ({ id: mem.userId, username: mem.username, name: mem.name, kind: mem.kind }));
}
