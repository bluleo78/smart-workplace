package com.workplace.agentruntime.dto;

import java.time.OffsetDateTime;
import java.util.List;

/**
 * runner 가 받아 가는 「이 위치에 떠 있어야 할 AI」 목록(WP-1249). runner 는 목록에 없는 자기 라벨 리소스를 지운다 — 끄기·위치 이동·삭제가 모두
 * 같은 규칙이다.
 *
 * @param pollIntervalSeconds 변경 스트림을 놓쳐도 맞춰지도록 runner 가 다시 조회할 주기(초)
 * @param mcpUrl AI 가 붙을 MCP 주소
 * @param apiUrl AI 가 부를 REST 주소({@code /api/v1} 까지)
 */
public record RunnerDesiredResponse(
    long locationId,
    String locationName,
    OffsetDateTime generatedAt,
    int pollIntervalSeconds,
    String mcpUrl,
    String apiUrl,
    List<RunnerDesiredAgent> agents) {}
