package com.workplace.agentaccount.usage;

/** provider 별 사용량 조회기. 평문 비밀을 받아 사용률을 읽어 온다(비밀은 저장·로그하지 않는다). */
public interface UsageProbe {

  /** 이 조회기가 맡는 provider 코드(anthropic·chatgpt). */
  String provider();

  /**
   * 사용량을 조회한다.
   *
   * @param plaintextSecret 복호화한 계정 비밀(Claude 토큰 또는 Codex auth.json 원문)
   * @throws UsageProbeException 조회 실패 — 코드와 짧은 한국어 문구만 담고 비밀은 담지 않는다
   */
  UsageReading read(String plaintextSecret) throws UsageProbeException;
}
