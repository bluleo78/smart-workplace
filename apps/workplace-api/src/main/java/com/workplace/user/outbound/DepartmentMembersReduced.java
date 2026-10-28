package com.workplace.user.outbound;

import java.util.List;

/**
 * 조직도 부서의 (하위 부서 포함) 구성원이 줄었거나 부서가 사라졌다는 도메인 이벤트(WP-1042). user 모듈이 부서에서 사람을 빼거나, 부서를 지우거나, 부서를 다른
 * 상위 부서 아래로 옮길 때 발행한다. 「부서 소속」으로 접근을 판정하는 쪽(부서 단위로 공유한 노트 — wiki, 이후 부서를 멤버로 두는 드라이브·프로젝트·채널)이 이미
 * 열린 화면·연결을 다시 판정하는 신호로 쓴다 — user 가 그 도메인들을 직접 import 하지 않기 위한 public 계약이다. 받는 쪽은 동기
 * {@code @EventListener} 로 받아 변경 전 행으로 영향받는 대상을 찾고(아래 발행 시점), 부서 판정은 공통 규칙({@code
 * global.org.Departments}, WP-1055)으로 다시 한다. 어느 도메인이 이 부서를 대상으로 두었는지는 보지 않고 늘 발행한다.
 *
 * <p>{@code groupIds} 는 <b>구성원이 줄어든 쪽 부서</b>다. 부서 공유는 그 부서와 하위 부서의 구성원에게 열리므로, 사람을 뺀 부서 자신과 그 상위
 * 부서, 지운 부서의 상위·하위 부서, 옮긴 부서의 옛 상위 부서가 담긴다. 발행은 변경 <b>전</b>(같은 트랜잭션)이다 — 부서를 지우면 부서를 대상으로 한 공유 행도
 * CASCADE 로 사라지므로, 받는 쪽이 아직 그 행으로 영향받는 페이지를 찾을 수 있어야 한다. 받는 쪽의 재검증은 커밋 뒤에 돈다.
 *
 * @param tenantId 부서가 있는 워크스페이스
 * @param groupIds 구성원이 줄어든 쪽 조직도 부서 id
 */
public record DepartmentMembersReduced(long tenantId, List<Long> groupIds) {}
