package com.workplace.home.dto;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.validation.constraints.NotBlank;

/**
 * 대시보드 위젯 한 개의 설정. 배열의 순서가 곧 표시 순서다.
 *
 * @param id 인스턴스 식별자. 시스템 위젯(싱글턴)은 보통 type 과 동일, 카탈로그 위젯(다중 인스턴스)은 UUID.
 * @param type 위젯 타입 키 (KNOWN_WIDGETS 화이트리스트로 검증)
 * @param count 위젯이 보여줄 항목 수. 시스템 위젯만 사용(허용값 3/5/10, 0/미지정은 기본 5로 보정). 카탈로그 위젯은 무시되어 0 으로 저장.
 * @param hidden 그리드에서 숨김 여부. 숨겨도 순서·설정 보존을 위해 영속된다(클라이언트가 렌더만 생략)
 * @param params 카탈로그 위젯의 필터 설정(opaque JSON 객체). 백엔드는 object 여부만 검증, 내용은 프론트/조회 API 가 책임진다. 시스템 위젯은
 *     항상 null 로 저장.
 * @param label 사용자 지정 표시 이름(선택). 미지정 시 프론트가 기본 제목 + 필터 요약을 사용.
 * @param chromeless 테두리·제목 헤더 없이 본문만 표시할지 여부(선택, 기본 false). 위젯 종류 무관 공통 표시 옵션 — 백엔드는 통과값
 *     검증(boolean) 외 별도 로직 없음.
 */
public record DashboardWidgetConfig(
    String id,
    @NotBlank String type,
    int count,
    boolean hidden,
    JsonNode params,
    String label,
    boolean chromeless) {

  /** 시스템 위젯(싱글턴) 편의 생성자 — id=type, params/label 없음, chromeless=false. 기존 5종 호출부 하위호환. */
  public DashboardWidgetConfig(String type, int count, boolean hidden) {
    this(type, type, count, hidden, null, null, false);
  }
}
