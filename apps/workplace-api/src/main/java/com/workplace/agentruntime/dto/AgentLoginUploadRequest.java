package com.workplace.agentruntime.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * Pod 가 더 새 로그인을 서버에 올리는 요청(WP-1450, {@code PUT /agent-runtime/me/login}).
 *
 * @param version Pod 가 쓰는 login version(GENIA_LOGIN_VERSION) — 서버의 현재 값과 다르면 거절한다(선택이 바뀐 직후의 낡은
 *     Pod)
 * @param payload Pod 의 auth.json 내용(원문)
 */
public record AgentLoginUploadRequest(long version, @NotBlank @Size(max = 200_000) String payload) {

  /** 로그에 원문이 새지 않게 toString 에서 뺀다. */
  @Override
  public String toString() {
    return "AgentLoginUploadRequest[version=" + version + "]";
  }
}
