package com.workplace.agentaccount.dto;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.workplace.auth.dto.ProviderConfig;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Size;

/**
 * AI 계정 수정 요청(WP-1448). label 만 오면 라벨만 바꾸고(원문·secret_version 그대로),
 * 원문(token·providerConfig·loginInfo 중 계정 종류에 맞는 것)이 오면 등록과 같은 검증을 거쳐 원문을 교체한다 — 종류는 바꿀 수 없다(바꾸려면 새
 * 계정을 등록).
 */
public record AgentAccountUpdateRequest(
    @Size(max = 80) String label,
    @Size(min = 32, max = 2048) String token,
    @Valid ProviderConfig providerConfig,
    @Size(max = 16384) String loginInfo) {

  /** 원문이 하나라도 왔는가 — 오면 원문 교체로 본다. JSON 속성이 아니다. */
  @JsonIgnore
  public boolean hasSecret() {
    return token != null || providerConfig != null || loginInfo != null;
  }

  /** 평문이 로그에 새지 않게 라벨과 원문 교체 여부만 싣는다. */
  @Override
  public String toString() {
    return "AgentAccountUpdateRequest[label=" + label + ", secret=" + hasSecret() + "]";
  }
}
