// OAuth 동의 화면 API(WP-1686) — 서버 OAuthAuthorizeController 의 검증·승인 호출. client(baseURL /api/v1) 사용.
import type {
  AuthorizeDecisionRequest,
  AuthorizeRedirectResponse,
  AuthorizeValidateResponse,
} from '../types/oauth'
import { client } from './client'

export const oauthApi = {
  /**
   * 인가 요청 검증. search 는 location.search 를 그대로 붙인다(쿼리를 다시 만들지 않는다) —
   * 서버가 같은 파라미터가 겹쳐 온 것을 알아보고 거절해야 하기 때문이다.
   */
  validate: (search: string) =>
    client.get<AuthorizeValidateResponse>('/oauth/authorize/validate' + search).then((r) => r.data),
  /** 승인·거부. 응답의 redirectUrl 에는 code 가 있으므로 Query 캐시에 넣지 않고 바로 이동한다. */
  decide: (body: AuthorizeDecisionRequest) =>
    client.post<AuthorizeRedirectResponse>('/oauth/authorize', body).then((r) => r.data),
}
