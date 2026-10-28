package com.workplace.member.dto;

import com.fasterxml.jackson.annotation.JsonInclude;

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
 * @param description AI 의 설명(역할) — 무엇을 맡고 어떻게 일하는지. 다른 AI 가 일을 맡길 상대를 고를 때 읽는다(WP-455). 사람·미입력은
 *     null.
 * @param agentRuntime AI 의 실행 방식 INTERNAL(서버에서 실행)/EXTERNAL(외부 에이전트) — 사람은 null.
 * @param department 소속 부서(WP-1048) — 직접 속한 조직도 부서 하나의 이름(정렬 순서가 앞인 것). 없으면 null.
 * @param instructions AI 의 지시(WP-1077) — 그 AI 자신이 이슈를 맡을 때마다 따르는 규칙. AI 가 자기 자신을 단건 조회할 때만 싣고,
 *     목록·남의 조회에는 빠진다(null 이면 JSON 에서 키째 뺀다).
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
    String membershipStatus,
    String description,
    String agentRuntime,
    String department,
    @JsonInclude(JsonInclude.Include.NON_NULL) String instructions) {}
