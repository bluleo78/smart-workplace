package com.workplace.user.outbound;

import java.util.List;

/**
 * 조직도 부서의 (하위 부서 포함) 구성원이 늘었다는 도메인 이벤트(WP-1102) — {@link DepartmentMembersReduced} 의 반대쪽이다. user
 * 모듈이 부서에 사람을 넣거나, 부서를 다른 상위 부서 아래로 옮길 때 발행한다. 부서를 멤버로 둔 공간(노트 스페이스·드라이브 팀 공간)이 새로 들어온 사람의 화면에도 공간이
 * 보이도록 변경 알림을 내는 신호로 쓴다 — 접근 판정은 조회할 때마다 다시 보므로 이미 맞고, 이 이벤트는 열린 화면을 새로 고치게 할 뿐이다. user 가 그 도메인들을
 * 직접 import 하지 않기 위한 public 계약이다.
 *
 * <p>{@code groupIds} 는 <b>구성원이 늘어난 쪽 부서</b>다 — 사람을 넣은 부서 자신과 그 상위 부서, 옮긴 부서의 새 상위 부서들. 발행은 변경
 * <b>뒤</b>(같은 트랜잭션)다 — 받는 쪽의 알림 수신자는 커밋 직전에 실효 멤버로 다시 조회되므로 새로 들어온 사람도 받는다.
 *
 * @param tenantId 부서가 있는 워크스페이스
 * @param groupIds 구성원이 늘어난 쪽 조직도 부서 id
 */
public record DepartmentMembersGrown(long tenantId, List<Long> groupIds) {}
