package com.workplace.agentruntime.dto;

import java.util.List;

/**
 * runner 가 받는 AI 의 저장소 토큰 원문 묶음(WP-1268). 활성 토큰만, host 오름차순.
 *
 * @param version desired 의 {@code repos} 버전과 같은 값(등록·교체·폐기마다 바뀐다). 행이 하나도 없으면 null
 * @param tokens 없으면 빈 목록
 */
public record RunnerReposSecretResponse(Long version, List<Token> tokens) {

  /** 토큰 한 개 — kind 는 GITHUB|GITLAB, host 는 소문자 호스트 이름. */
  public record Token(String kind, String host, String token) {

    /** 로그에 원문이 새지 않게 toString 에서 뺀다. */
    @Override
    public String toString() {
      return "Token[kind=" + kind + ", host=" + host + "]";
    }
  }

  /** 로그에 원문이 새지 않게 토큰은 개수만 적는다. */
  @Override
  public String toString() {
    return "RunnerReposSecretResponse[version=" + version + ", tokens=" + tokens.size() + "]";
  }
}
