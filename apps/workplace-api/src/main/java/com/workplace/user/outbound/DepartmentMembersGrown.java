package com.workplace.user.outbound;

import java.util.List;

/**
 * 조직도 부서의 (하위 부서 포함) 구성원이 늘었다는 도메인 이벤트(WP-1102) — {@link DepartmentMembersReduced} 의 반대쪽이다. user
 * 모듈이 부서에 사람을 넣거나, 부서를 다른 상위 부서 아래로 옮기거나, 부서에 속한 구성원의 정지를 풀 때 발행한다. user 가 받는 도메인들을 직접 import 하지 않기
 * 위한 public 계약이다.
 *
 * <p>받는 쪽은 두 갈래다. 부서를 멤버로 둔 공간(노트 스페이스·드라이브 팀 공간)은 접근 판정을 조회할 때마다 다시 보므로 이미 맞고, 새로 들어온 사람의 화면에도 공간이
 * 보이도록 변경 알림만 낸다. 부서 구성원을 사람 행으로 펼쳐 두는 채널({@code channel_member}, WP-1058)은 이 이벤트로 새로 들어올 사람을 넣는다.
 *
 * <p>{@code groupIds} 는 <b>구성원이 늘어난 쪽 부서</b>다 — 사람을 넣은 부서 자신과 그 상위 부서, 옮긴 부서의 새 상위 부서들(옛 상위와 공통인
 * 상위는 빼고), 정지가 풀린 사람이 직접 속한 부서와 그 상위 부서. 발행은 변경 <b>뒤</b>(같은 트랜잭션)다 — 받는 쪽이 동기
 * {@code @EventListener} 로 받아 바뀐 소속으로 바로 판정할 수 있고, 공간 알림의 수신자는 커밋 직전에 실효 멤버로 다시 조회되므로 새로 들어온 사람도
 * 받는다. 조직도 부서(SHARED)만 담는다.
 *
 * @param tenantId 부서가 있는 워크스페이스
 * @param groupIds 구성원이 늘어난 쪽 조직도 부서 id
 * @param userIds 늘어난 사람 id(부서에 넣은 사람·정지가 풀린 사람) — 채널이 그 사람만 다시 판정하게. 부서 이동처럼 특정하지 않으면 null(그 부서 트리
 *     구성원 전원을 본다)
 */
public record DepartmentMembersGrown(long tenantId, List<Long> groupIds, List<Long> userIds) {}
