package com.workplace.version.dto;

import java.time.LocalDate;

/**
 * 버전 출시 요청(WP-888). 둘 다 선택이다.
 *
 * <ul>
 *   <li>releaseDate — 없으면 기존 출시 예정일, 그것도 없으면 오늘(Asia/Seoul)
 *   <li>moveUnresolvedTo — 있으면 이 버전을 수정 버전으로 가진 끝나지 않은(완료·취소 아님) 이슈를 그 버전으로 옮긴다. 같은 프로젝트의 미출시·보관 아님
 *       버전이어야 하고 자기 자신은 안 된다
 * </ul>
 */
public record ReleaseVersionRequest(LocalDate releaseDate, Long moveUnresolvedTo) {}
