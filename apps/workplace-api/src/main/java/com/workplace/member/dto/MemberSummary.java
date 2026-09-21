package com.workplace.member.dto;

/**
 * 구성원 디렉터리 항목 (#833).
 *
 * <p>"구성원"은 현재 테넌트에 멤버십(membership)을 가진 사람이다. 계정(user)과 구분한다 — 계정은 여러 테넌트에 속할 수 있고, 계정 관리
 * (생성·역할변경·비활성화)는 ADMIN 전용 {@code /api/v1/users} 의 몫이다.
 *
 * <p>{@code userId} 는 전역 user.id 이며, 프로젝트 멤버 추가·이슈 담당자 지정 등 사람을 가리켜야 하는 모든 곳에서 쓰는 값이다. 외부 연락처의
 * 식별자(contact_entry.id)와는 다른 네임스페이스다.
 *
 * @param membershipRole 멤버십 역할 OWNER/ADMIN/MEMBER — RBAC 역할(ADMIN/USER/AGENT)과 다른 축이다.
 */
public record MemberSummary(
    long userId,
    String username,
    String name,
    String email,
    String title,
    String kind,
    boolean active,
    String membershipRole,
    String membershipStatus) {}
