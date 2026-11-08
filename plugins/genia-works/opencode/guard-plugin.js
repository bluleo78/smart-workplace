// OpenCode 키 보호 플러그인(WP-1410) — gw-opencode-loop 가 OPENCODE_CONFIG_CONTENT 의 plugin 에 file:// 로 건다.
// 셸 도구 환경에서 토큰 변수를 비우고, 키 저장소·헤더 스크립트에 닿는 도구 호출을 막는다. 판정·훅 본문은 lib.mjs 의 guardHooks 한곳이다.
// OpenCode 는 이 파일이 내보내는 함수를 모두 플러그인으로 부르므로 내보내는 것은 이 하나뿐이다.
import { guardHooks } from './lib.mjs'

export const GeniaWorksGuard = async () => guardHooks()
