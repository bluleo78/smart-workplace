package com.workplace.auth.dto;

import java.util.Map;

/**
 * 멀티 프로바이더(#opencode) provider config — 등록 요청에서 평문으로 받아 컨트롤러가 JSON 직렬화 후 서비스 계층(
 * AiAgentCredentialService)에 전달한다. 형태 검증(providerId/options.baseURL/options.apiKey/vision)은 서비스
 * 계층에서 수행한다.
 *
 * <p>vision(WP-250) — 모델의 이미지 입력 가능 여부를 관리자가 직접 지정하는 수동 설정. boolean 이면 모든 모델 공통, 객체면 모델 id →
 * boolean (예: {"custom/qwen3.6-35b-vl": true}). 없으면(null) ai-agent 가 /models 메타로 자동 감지한다. 이 레코드가 저장
 * JSON 의 모양을 정하므로 필드가 없으면 ai-agent(opencode-vision.ts manualVision)가 읽을 값이 직렬화에서 버려진다. 타입은
 * boolean/Map 둘 다 받으려 Object — 검증은 서비스가 한다.
 */
public record ProviderConfig(
    String providerId, String npm, Map<String, Object> options, Object vision) {

  /** vision 을 지정하지 않는(자동 감지) 기존 3인자 형태 — 모델 목록 프로브 등 vision 과 무관한 호출부용. */
  public ProviderConfig(String providerId, String npm, Map<String, Object> options) {
    this(providerId, npm, options, null);
  }
}
