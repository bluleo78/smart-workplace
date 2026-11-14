// 새 에이전트 폼 스키마 — NewAgentDialog 의 순수 규칙(WP-1559).
// 브라우저 required 말풍선 대신 칸 아래에 한국어 오류를 보이기 위해 zod 로 검증한다.
import { z } from 'zod'

// 아이디·이름·이메일 모두 trim 후 검사 — 공백만 넣은 값이 서버로 가는 것을 클라이언트에서 먼저 막고,
// 통과한 값은 앞뒤 공백이 잘려 그대로 요청 본문이 된다.
export const newAgentSchema = z.object({
  username: z.string().trim().min(1, '아이디를 입력하세요').max(50, '아이디는 50자 이하여야 합니다'),
  // 저장 한도(user.name 50자)와 같게 — 51자부터 서버가 거절한다(WP-670).
  name: z.string().trim().min(1, '이름을 입력하세요').max(50, '이름은 50자 이하여야 합니다'),
  // 빈 값과 형식 오류를 다른 문구로 — min 으로 빈 값을 먼저 거르고 pipe 로 형식을 검사한다(member.ts username 과 같은 방식).
  email: z.string().trim().min(1, '이메일을 입력하세요').pipe(z.email('유효한 이메일을 입력하세요')),
})

export type NewAgentFormData = z.infer<typeof newAgentSchema>
