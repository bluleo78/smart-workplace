package com.workplace.airun.status;

import com.workplace.airun.status.AiStatusQueryRepository.RunDetailRow;
import com.workplace.airun.status.AiStatusQueryRepository.RunRow;
import com.workplace.airun.status.dto.AiRunDetail;
import com.workplace.airun.status.dto.AiRunFilter;
import com.workplace.airun.status.dto.AiRunListItem;
import com.workplace.airun.status.dto.AiRunListItem.Actor;
import com.workplace.airun.status.dto.AiRunListItem.Target;
import com.workplace.airun.status.dto.AiRunPage;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/**
 * AI 현황 처리 이력 목록·상세(WP-1831 설계 4-6·4-7). 입력을 검증하고(잘못되면 IllegalArgumentException → 400), 기본 기간을 채우고,
 * 한 건 더 읽어 다음 페이지 커서를 만든다.
 */
@Service
@RequiredArgsConstructor
public class AiStatusRunsService {

  /** 목록 기본 기간(최근 30일)과 페이지 크기 한도. */
  private static final Duration DEFAULT_RANGE = Duration.ofDays(30);

  /**
   * 목록 기본 페이지 크기 — 컨트롤러의 {@code @RequestParam(defaultValue)} 가 그대로 참조한다. 애노테이션 인자는 컴파일 상수 문자열이어야 해서
   * int 가 아니라 문자열로 둔다(Spring 이 size 로 바인딩할 때 파싱한다).
   */
  public static final String DEFAULT_SIZE = "50";

  private static final int MAX_SIZE = 100;

  /**
   * 처리 이력 status 필터 허용값 — 위임 작업은 시작 전(real_start 없음) 행을 RUNNING 과 따로 세므로 PENDING 을 함께 받는다(WP-1831
   * 리뷰). ai_run 에는 PENDING 행이 없어 그 필터는 위임 작업 시작 전 행만 나온다.
   */
  private static final Set<String> STATUSES =
      Set.of("RUNNING", "PENDING", "SUCCEEDED", "FAILED", "SKIPPED");

  private static final Set<String> ACTOR_TYPES = Set.of("AUTO", "USER", "AGENT");

  private final AiStatusQueryRepository repo;

  /** 처리 이력 한 페이지. now 는 기본 기간(to)의 기준이다. */
  @Transactional(readOnly = true)
  public AiRunPage list(AiRunFilter in, String cursor, int size, Instant now) {
    if (size < 1 || size > MAX_SIZE) {
      throw new IllegalArgumentException("size 는 1~" + MAX_SIZE + " 사이여야 합니다");
    }
    AiRunFilter f = normalize(in, now);
    // 깨진 커서는 InvalidCursorException(400).
    AiRunCursor after = cursor == null || cursor.isBlank() ? null : AiRunCursor.decode(cursor);
    // 한 건 더 읽어 다음 페이지 유무를 안다.
    List<RunRow> rows = repo.listRuns(f, after, size + 1);
    boolean more = rows.size() > size;
    List<RunRow> page = more ? rows.subList(0, size) : rows;
    List<AiRunListItem> items = new ArrayList<>(page.size());
    for (RunRow r : page) {
      items.add(toItem(r));
    }
    String next = null;
    if (more) {
      RunRow last = page.get(page.size() - 1);
      next = new AiRunCursor(last.startedAt(), last.source(), last.sortId()).encode();
    }
    return new AiRunPage(items, next);
  }

  /** run_id 로 ai_run 상세. 없으면 404(위임 작업은 목록 항목이 전부라 상세가 없다). */
  @Transactional(readOnly = true)
  public AiRunDetail detail(UUID runId) {
    RunDetailRow d =
        repo.findRun(runId)
            .orElseThrow(
                () -> new ResponseStatusException(HttpStatus.NOT_FOUND, "처리 기록을 찾을 수 없습니다"));
    return new AiRunDetail(
        toItem(d.row()),
        runId,
        d.cacheReadTokens(),
        d.cacheWriteTokens(),
        d.credentialLabel(),
        d.attempt(),
        d.sourceAt(),
        d.errorDetail());
  }

  /** 검증하고 비어 있는 값·기본 기간을 정리한다. kind 는 반복 파라미터 안의 CSV 도 펼친다. */
  private static AiRunFilter normalize(AiRunFilter in, Instant now) {
    String status = blankToNull(in.status());
    if (status != null && !STATUSES.contains(status)) {
      throw new IllegalArgumentException(
          "status 는 RUNNING·PENDING·SUCCEEDED·FAILED·SKIPPED 중 하나여야 합니다");
    }
    String actorType = blankToNull(in.actorType());
    if (actorType != null && !ACTOR_TYPES.contains(actorType)) {
      throw new IllegalArgumentException("actorType 은 AUTO·USER·AGENT 중 하나여야 합니다");
    }
    Instant to = in.to() == null ? now : in.to();
    Instant from = in.from() == null ? now.minus(DEFAULT_RANGE) : in.from();
    if (from.isAfter(to)) {
      throw new IllegalArgumentException("from 은 to 보다 늦을 수 없습니다");
    }
    List<String> kinds = new ArrayList<>();
    if (in.kinds() != null) {
      for (String raw : in.kinds()) {
        if (raw == null) {
          continue;
        }
        for (String k : raw.split(",")) {
          if (!k.isBlank()) {
            kinds.add(k.trim());
          }
        }
      }
    }
    return new AiRunFilter(
        kinds, status, actorType, blankToNull(in.model()), blankToNull(in.q()), from, to);
  }

  private static String blankToNull(String s) {
    if (s == null) {
      return null;
    }
    String t = s.trim();
    return t.isEmpty() ? null : t;
  }

  /** 읽은 행을 응답 항목으로 — id 는 AI 처리면 run_id, 위임 작업이면 작업 id. */
  private static AiRunListItem toItem(RunRow r) {
    String id = (r.source() == 'R' ? "R-" : "W-") + r.ref();
    return new AiRunListItem(
        id,
        r.kind(),
        new Target(r.targetType(), r.targetId(), r.targetLabel()),
        new Actor(r.actorType(), r.actorId(), r.actorName()),
        r.status(),
        r.startedAt(),
        r.endedAt(),
        r.waitMs(),
        r.durationMs(),
        r.inputTokens(),
        r.outputTokens(),
        r.model(),
        r.errorReason());
  }
}
