package com.workplace.airun.status;

import com.workplace.airun.status.dto.AiRunDetail;
import com.workplace.airun.status.dto.AiRunFilter;
import com.workplace.airun.status.dto.AiRunPage;
import com.workplace.airun.status.dto.AiStatusOverview;
import com.workplace.global.security.RequireAdmin;
import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 관리자 「AI 현황」 조회 API(WP-1831). 워크스페이스 관리자만 부른다(AI 관리 API 와 같은 @RequireAdmin). 값은 호출자 테넌트의 것만 — RLS
 * 가 가른다. 이 클래스는 서비스만 주입한다(저장소를 직접 쓰면 핸들러마다 트랜잭션이 필요 — RlsTransactionalArchTest).
 */
@RestController
@RequestMapping("/api/v1/admin/ai-status")
@RequiredArgsConstructor
@RequireAdmin
public class AdminAiStatusController {

  private final AiStatusOverviewService overviewService;
  private final AiStatusRunsService runsService;

  /**
   * 개요. period 는 1h·24h(기본)·7d·30d, 그 밖은 400. 기준 시각은 호출 시각이다.
   *
   * <p>빈 문자열도 「그 밖」으로 보아 400 — 기간 코드는 값이 있어야 뜻이 있다. runs 쪽 문자열 파라미터는 빈 값을 「주지 않음」으로 봐 기본값이 적용되는 것과
   * 의도적으로 다르다(아래 runs 참고).
   */
  @GetMapping("/overview")
  public ResponseEntity<AiStatusOverview> overview(
      @RequestParam(value = "period", required = false) String period) {
    return ResponseEntity.ok(overviewService.overview(AiStatusPeriod.parse(period), Instant.now()));
  }

  /**
   * 처리 이력 목록(AI 처리 + 위임 작업). kind 는 반복 파라미터·CSV 둘 다, from·to 는 ISO 시각(기본 최근 30일), size 기본 {@link
   * AiStatusRunsService#DEFAULT_SIZE}(1~100). 검증 실패·깨진 커서는 400.
   *
   * <p>여기의 문자열 파라미터(status·model·q·from·to·cursor)는 빈 문자열도 「값을 안 줌」으로 본다(빈 줄·오타 방지용 여백 제거 후 null →
   * 검증 건너뛰기·기본값 적용). period 와 빈 값 처리가 다른 건 기간 코드는 없는 값이 곧 오류이기 때문(위 overview 참고).
   */
  @GetMapping("/runs")
  public ResponseEntity<AiRunPage> runs(
      @RequestParam(value = "kind", required = false) List<String> kind,
      @RequestParam(value = "status", required = false) String status,
      @RequestParam(value = "actorType", required = false) String actorType,
      @RequestParam(value = "model", required = false) String model,
      @RequestParam(value = "q", required = false) String q,
      @RequestParam(value = "from", required = false) String from,
      @RequestParam(value = "to", required = false) String to,
      @RequestParam(value = "cursor", required = false) String cursor,
      @RequestParam(value = "size", defaultValue = AiStatusRunsService.DEFAULT_SIZE) int size) {
    AiRunFilter filter =
        new AiRunFilter(
            kind, status, actorType, model, q, parseInstant("from", from), parseInstant("to", to));
    return ResponseEntity.ok(runsService.list(filter, cursor, size, Instant.now()));
  }

  /** 처리 이력 한 건 상세(ai_run 의 run_id). 없으면 404. */
  @GetMapping("/runs/{runId}")
  public ResponseEntity<AiRunDetail> runDetail(@PathVariable UUID runId) {
    return ResponseEntity.ok(runsService.detail(runId));
  }

  /** ISO-8601 시각 파라미터를 읽는다. 비어 있으면 null, 형식이 틀리면 한국어 메시지의 400. */
  private static Instant parseInstant(String name, String value) {
    if (value == null || value.isBlank()) {
      return null;
    }
    try {
      return Instant.parse(value.trim());
    } catch (DateTimeParseException e) {
      throw new IllegalArgumentException(name + " 은 ISO-8601 시각(예: 2026-01-01T00:00:00Z)이어야 합니다");
    }
  }
}
