package com.workplace.auth.service;

import com.workplace.auth.exception.InvalidProviderCredentialException;

/**
 * Anthropic 워크스페이스 ID 검증(WP-1496) — 개인 비서·관리자 연결·AI 계정 등록이 같은 규칙을 쓰게 한 곳에 둔다.
 *
 * <p>워크스페이스 ID 는 모든 Claude 토큰에 선택이다 — 키 접두(sk-ant-usr·api·oat)로 필수 여부를 정하지 않는다. 주면 키 종류와 상관없이 저장하고,
 * 필요한데 빠졌는지는 등록 확인({@link AnthropicCredentialVerifier})이 Anthropic 응답으로 가린다.
 *
 * <p>워크스페이스 ID 는 HTTP 헤더 값으로 나가므로 보이는 ASCII(0x21~0x7E, 공백 제외) 1~128자만 받는다 — 줄바꿈·제어 문자로 다른 헤더를 끼워 넣지
 * 못하게, 비 ASCII(전각 문자·U+200D 등)로 헤더가 깨지지 않게. ai-agent·웹과 같은 규칙이다.
 */
public final class AnthropicKeys {

  /** 워크스페이스 ID 최대 길이 — 컬럼 폭(V279 VARCHAR(128))과 같다. */
  public static final int WORKSPACE_ID_MAX = 128;

  private AnthropicKeys() {}

  /**
   * 저장할 워크스페이스 ID — 앞뒤 공백을 떼어 비었으면 null(지정 안 함), 아니면 형식을 검증한 값.
   *
   * @throws InvalidProviderCredentialException 128자를 넘거나 보이는 ASCII 가 아닌 문자(공백·제어·비 ASCII)가 섞임(400)
   */
  public static String normalizeWorkspaceId(String workspaceId) {
    String ws = workspaceId == null ? "" : workspaceId.strip();
    if (ws.isEmpty()) return null;
    if (ws.length() > WORKSPACE_ID_MAX || ws.chars().anyMatch(c -> c < 0x21 || c > 0x7E)) {
      throw new InvalidProviderCredentialException(
          "Anthropic 워크스페이스 ID 는 공백 없이 영문·숫자·기호로 " + WORKSPACE_ID_MAX + "자 이내로 넣어 주세요");
    }
    return ws;
  }
}
