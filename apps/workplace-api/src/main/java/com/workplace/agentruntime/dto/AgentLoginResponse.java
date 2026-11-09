package com.workplace.agentruntime.dto;

/**
 * Pod 가 AI 키로 받아 가는 묶인 로그인 계정(WP-1450, {@code GET /agent-runtime/me/login}) — Pod 가 auth.json 을 새
 * 것으로 바꿀 때 쓴다.
 *
 * @param version runner desired 의 loginVersion 과 같은 값(Pod 의 GENIA_LOGIN_VERSION) — 다르면 선택이 바뀐 직후라
 *     Pod 는 이 응답으로 auth.json 을 덮지 않는다(runner 가 곧 Pod 를 교체한다)
 * @param revision 로그인 내용 변경 번호 — 다음 호출의 {@code revision} 으로 보내면 바뀌지 않았을 때 204
 * @param provider {@code genia}·{@code chatgpt}
 * @param payload 서버가 다듬어 저장한 로그인 정보 JSON(auth.json 내용) — 이 응답 본문에만 나가는 원문이다
 */
public record AgentLoginResponse(long version, long revision, String provider, String payload) {

  /** 로그에 원문이 새지 않게 toString 에서 뺀다. */
  @Override
  public String toString() {
    return "AgentLoginResponse[version="
        + version
        + ", revision="
        + revision
        + ", provider="
        + provider
        + "]";
  }
}
