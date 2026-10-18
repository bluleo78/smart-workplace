package com.workplace.user.dto;

import com.fasterxml.jackson.annotation.JsonFormat;
import java.time.Instant;
import java.time.LocalDateTime;

/**
 * 에이전트 관리 목록 항목. UserResponse 에 유형(type)과 소유자(ownerName)를 더한다.
 *
 * <p>type: PERSONAL=개인 비서(소유자 있음) · WORKSPACE=공통 비서(테넌트 지정) · REGULAR=일반(관리자 생성 워크스페이스 에이전트).
 * ownerName 은 PERSONAL 일 때 소유자(사람) 이름, 그 외 null.
 *
 * <p>WP-371: runtime 은 실행 방식(INTERNAL|EXTERNAL), lastKeyUsedAt 은 폐기되지 않은 API 키의 last_used_at 최댓값(키가
 * 없거나 한 번도 안 쓰였으면 null) — 외부 에이전트가 실제로 접속 중인지 가늠하는 용도.
 *
 * <p>WP-455: description 은 설명(역할) — 다른 AI 가 일을 맡길 상대를 고를 때 읽는다. 비어 있으면 null.
 */
public record AgentResponse(
    Long id,
    String username,
    String email,
    String name,
    boolean isActive,
    @JsonFormat(pattern = "yyyy-MM-dd'T'HH:mm:ss") LocalDateTime createdAt,
    String type,
    String ownerName,
    String runtime,
    Instant lastKeyUsedAt,
    String description) {

  public static final String TYPE_PERSONAL = "PERSONAL";
  public static final String TYPE_WORKSPACE = "WORKSPACE";
  public static final String TYPE_REGULAR = "REGULAR";
}
