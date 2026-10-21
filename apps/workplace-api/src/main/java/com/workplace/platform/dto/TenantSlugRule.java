package com.workplace.platform.dto;

/**
 * 테넌트 slug 형식 규칙 — 생성(CreateTenantRequest)·수정(UpdateTenantRequest)이 같은 규칙을 쓰도록 한 곳에 둔다(WP-669). 예전엔
 * 수정에만 있어 생성으로 형식이 틀린 slug 가 저장되고, 그 테넌트는 이름만 고쳐도 수정이 거절됐다. 비어 있으면(공백 포함) 서버가 이름에서 자동 생성한다.
 */
public final class TenantSlugRule {

  private TenantSlugRule() {}

  /** ASCII 소문자·숫자·하이픈(slugify 규칙과 동일). 앞뒤 공백·빈 값 허용. */
  public static final String REGEX = "^\\s*([a-z0-9]+(-[a-z0-9]+)*)?\\s*$";

  public static final String MESSAGE = "slug 는 영문 소문자·숫자·하이픈만 사용할 수 있습니다";

  /** tenant.slug VARCHAR(64). */
  public static final int MAX = 64;

  public static final String SIZE_MESSAGE = "slug 는 64자 이하로 입력하세요";
}
