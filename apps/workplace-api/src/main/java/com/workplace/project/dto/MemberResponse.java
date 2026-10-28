package com.workplace.project.dto;

import java.time.Instant;

/**
 * 프로젝트 멤버 응답 DTO. username/name/kind/active 는 user 테이블 JOIN 결과.
 *
 * <p>멤버 목록(GET /projects/{key}/members)은 <b>실효 멤버</b>다(WP-1057) — 직접 멤버 행과, 멤버로 둔 조직도 부서·하위 부서의 활성
 * 사람 구성원. 담당자·멘션·필터 후보가 모두 이 목록을 쓰므로 부서로 들어온 사람도 직접 멤버처럼 고를 수 있다. 멤버 관리 화면은 {@code direct} 로 직접 멤버
 * 행만 골라 보이고, 부서는 부서 행(member-groups)으로 따로 보인다.
 *
 * @param role 실효 역할 — 직접 행 역할(OWNER·MEMBER), 부서로만 들어왔으면 MEMBER
 * @param createdAt 직접 행이면 추가 시각, 부서로만 들어왔으면 그 부서 행이 추가된 시각(가장 이른 것)
 * @param direct 직접 멤버 행이 있는가 — false 면 조직도 부서로만 들어온 사람(직접 제거·역할 변경 대상이 아니다)
 */
public record MemberResponse(
    Long userId,
    String username,
    String name,
    String kind,
    String role,
    Instant createdAt,
    boolean active,
    boolean direct) {}
