package com.workplace.issue.profile;

import com.workplace.global.util.CapabilityTokens;
import com.workplace.issue.metrics.ClosedIssueFact;
import com.workplace.issue.outbound.dto.WorkProfileAiResult.Classified;
import com.workplace.issue.profile.WorkProfileInputRepository.IssueBrief;
import java.util.Comparator;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * 업무 프로파일 순수 계산 모음(WP-1485) — AI 분류를 세고, 역량 태그를 정리하고, 입력 지문을 만들고, 마감 결과 문구를 정한다.
 *
 * <p>숫자는 AI 가 아니라 여기서 센다 — AI 가 낸 분류만 믿고 건수·순위는 API 가 정해야 화면 숫자가 흔들리지 않는다. Spring 없이 시험할 수 있게 정적
 * 메서드로만 둔다.
 */
public final class WorkProfileCalc {

  /** 이슈 분류용 고정 일 종류 9개 — 「·」 는 이름의 일부. ai-agent 의 WORK_PROFILE_TASKS 와 같은 목록이다. */
  public static final List<String> TASKS =
      List.of("결함 수정", "기능 개발", "설계·기획", "릴리스·배포", "매뉴얼·문서", "테스트", "운영·지원", "개선·정리", "기타");

  /** 목록 밖 일 종류를 접는 이름. */
  static final String ETC = "기타";

  /** 일 종류·영역 각각 화면에 보이는 상위 개수. */
  public static final int TOP_N = 6;

  /** 역량 태그 최대 개수. */
  public static final int SKILLS_MAX = 5;

  /** 건수 내림차순, 같으면 이름 오름차순 — 같은 입력이면 항상 같은 순서가 되게. */
  private static final Comparator<Count> BY_COUNT_DESC =
      Comparator.comparingInt(Count::count).reversed().thenComparing(Count::name);

  private WorkProfileCalc() {}

  /** 이름별 건수 — 업무 종류·영역 묶음에 쓴다. */
  public record Count(String name, int count) {}

  /** 일 종류·영역별 건수(각각 상위 {@link #TOP_N}). */
  public record Tally(List<Count> tasks, List<Count> areas) {}

  /**
   * AI 분류를 일 종류·영역별로 센다. 보낸 적 없는 키(AI 가 지어낸 키)는 버리고, 같은 키가 여러 번 오면 첫 번째만 센다. 목록 밖 일 종류는 기타로 접고, 빈
   * 영역은 영역 세기에서만 뺀다.
   *
   * @param items AI 분류
   * @param knownKeys 요청에 실은 이슈 키
   */
  public static Tally tally(List<Classified> items, Set<String> knownKeys) {
    Map<String, Integer> tasks = new LinkedHashMap<>();
    Map<String, Integer> areas = new LinkedHashMap<>();
    Set<String> seen = new HashSet<>();
    if (items != null) {
      for (Classified c : items) {
        if (c == null || c.key() == null || !knownKeys.contains(c.key()) || !seen.add(c.key())) {
          continue;
        }
        String task = c.task() == null ? "" : c.task().trim();
        tasks.merge(TASKS.contains(task) ? task : ETC, 1, Integer::sum);
        String area = c.area() == null ? "" : c.area().trim();
        if (!area.isEmpty()) areas.merge(area, 1, Integer::sum);
      }
    }
    return new Tally(top(tasks), top(areas));
  }

  /** 건수 맵 → 정렬된 상위 {@link #TOP_N}. */
  private static List<Count> top(Map<String, Integer> counts) {
    return counts.entrySet().stream()
        .map(e -> new Count(e.getKey(), e.getValue()))
        .sorted(BY_COUNT_DESC)
        .limit(TOP_N)
        .toList();
  }

  /** 역량 태그 정리 — 앞뒤 공백을 지우고, 빈 값·중복을 빼고, 앞에서부터 {@link #SKILLS_MAX} 개. */
  public static List<String> skills(List<String> raw) {
    if (raw == null) return List.of();
    Set<String> out = new LinkedHashSet<>();
    for (String s : raw) {
      if (s == null || s.isBlank()) continue;
      out.add(s.trim());
      if (out.size() == SKILLS_MAX) break;
    }
    return List.copyOf(out);
  }

  /**
   * 분석 입력 지문 — 대상 이슈의 (id, 수정 시각) 묶음의 SHA-256. 순서와 무관하고, 이슈가 고쳐지거나(수정 시각) 빠지거나 더해지면 달라진다. 지문이 같으면
   * AI 를 다시 부르지 않는다(비용 절약). 입력은 id 오름차순 「id:수정시각(Instant)\n」 줄의 연결 — 저장된 지문과 맞아야 하므로 형식을 바꾸지 않는다.
   */
  public static String fingerprint(List<IssueBrief> briefs) {
    String input =
        briefs.stream()
            .sorted(Comparator.comparingLong(IssueBrief::issueId))
            .map(
                b ->
                    b.issueId()
                        + ":"
                        + (b.updatedAt() == null ? "" : b.updatedAt().toInstant().toString())
                        + "\n")
            .collect(Collectors.joining());
    return CapabilityTokens.sha256Hex(input);
  }

  /** 마감 결과 문구 — 프롬프트에 그대로 실린다. */
  public static String dueResult(ClosedIssueFact f) {
    return switch (f.outcome()) {
      case ON_TIME -> "제때";
      case OVERDUE -> "늦음 " + f.lateDays() + "일";
      case NO_DUE -> "마감 없음";
    };
  }
}
