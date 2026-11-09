package com.workplace.agentaccount.dto;

import com.workplace.auth.dto.ProviderConfig;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Size;

/**
 * AI 계정 등록 요청(WP-1448). provider 를 비우면 anthropic. anthropic 은 token, opencode 는 providerConfig,
 * genia·chatgpt 는 loginInfo(그 프로그램의 auth.json 내용)를 쓰며 종류별 검증은 서비스(AgentAccountService)가 한다. label 을
 * 비우면 「<종류 이름> 계정」.
 */
public record AgentAccountRequest(
    String provider,
    @Size(min = 32, max = 2048) String token,
    @Valid ProviderConfig providerConfig,
    @Size(max = 80) String label,
    @Size(max = 16384) String loginInfo) {

  /** 평문(token·providerConfig·loginInfo)이 로그에 새지 않게 종류·라벨만 싣는다. */
  @Override
  public String toString() {
    return "AgentAccountRequest[provider=" + provider + ", label=" + label + "]";
  }
}
