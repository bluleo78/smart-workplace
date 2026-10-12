package com.workplace.platform.dto;

/**
 * 운영자 콘솔 — 사용자 자동완성 검색 결과 한 건(WP-337).
 *
 * <p>테넌트 생성 시 소유자 선택 콤보박스가 표시용으로 이름·아이디·이메일을 모두 쓴다. 이메일은 없는 사용자가 있어 nullable 이다.
 */
public record PlatformUserSearchItem(Long id, String name, String username, String email) {}
