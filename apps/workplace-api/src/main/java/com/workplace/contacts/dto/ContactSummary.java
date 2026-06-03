package com.workplace.contacts.dto;

/**
 * 통합 연락처 목록의 한 행. 멤버(MEMBER)와 외부(EXTERNAL)를 공통 필드로 표현한다. email/title/organization 은 소스에 따라 null
 * 가능(멤버는 organization 없음).
 */
public record ContactSummary(
    String type, long id, String name, String email, String title, String organization) {}
