package com.workplace.issue.outbound;

import java.util.Set;

/**
 * 담당 지정(교체·생성)이 사람이 시킨 「시작하라」로 이어질 수 있는 때 같은 트랜잭션에서 내는 동기 이벤트(WP-2120). 워크플로우 모듈의 리스너가 받아 시작 조건이
 * 맞으면 같은 트랜잭션에서 실행을 시작한다.
 *
 * <p>왜 이벤트인가: 실행 서비스(→ 실행 기록기)가 담당 지정 서비스를 쓰므로 담당 지정 서비스가 실행 서비스를 직접 부르면 생성자 순환이 된다. AFTER_COMMIT 이
 * 아닌 동기 {@code @EventListener} 라 「담당만 있고 실행이 없는 순간」이 생기지 않고, 시작이 실패하면 담당 교체까지 함께 되돌아간다.
 *
 * @param issueId 이슈
 * @param projectId 프로젝트
 * @param actorId 담당을 지정한 사람
 * @param added 이번에 새로 담당이 된 사람(비어 있으면 이 이벤트를 내지 않는다)
 */
public record IssueAssigneesReplacedEvent(
    long issueId, long projectId, long actorId, Set<Long> added) {}
