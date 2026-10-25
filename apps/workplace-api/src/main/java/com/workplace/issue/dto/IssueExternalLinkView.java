package com.workplace.issue.dto;

/**
 * 이슈 상세의 외부 링크 한 줄(WP-887) — 다른 시스템(Jira 등)에 남는 이슈를 관계 유형·키·제목·주소로 붙인 것. 외부 링크 API 가 채운다(그 전엔 빈
 * 목록).
 *
 * @param typeCode 기본 유형 코드(사용자 정의 유형이면 null)
 * @param label 이 이슈 쪽 말
 * @param side 이 이슈가 A 쪽이면 {@code source}, B 쪽이면 {@code target} — 방향 없는 유형은 늘 {@code source}
 * @param key 상대 시스템의 키(선택)
 */
public record IssueExternalLinkView(
    long id,
    long typeId,
    String typeCode,
    String label,
    String side,
    String url,
    String key,
    String title) {}
