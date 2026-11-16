package com.workplace.issue.report;

import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;

/**
 * 프로젝트 리포트의 에픽 집계(WP-1629) — 이슈 60건 대신 기간의 이슈 전부를 에픽 단위로 묶은 계산값. AI 는 이 묶음으로 「주요 성과·일정·진행 중인 에픽·결정
 * 요청」 글을 쓰고, 후처리는 완료 에픽의 기한·완료일로 일정 도표를, {@link #metrics} 로 「참고 지표」 표를 만든다.
 *
 * <p>날짜는 모두 서울 날짜 「M/d」 글자(없으면 null), 상태 낱말은 화면과 같은 「순조로움/주의/위험」이다. 제목 목록은 에픽당 {@link #TITLE_LIMIT}
 * 건까지 싣고 넘치면 마지막에 「외 N건」 한 줄을 붙인다(생성 비용 안전 상한).
 *
 * @param completed 이번 기간 완료한 에픽(상시 제외, 완료 시각 순)
 * @param previousCompleted 지난 기간 완료한 에픽(같은 규칙)
 * @param inProgress 진행 중인 에픽 — 이번 기간에 움직였거나 기한이 있는 열린 에픽(키 순)
 * @param upcomingWithDue 앞으로 기한을 정한 열린 에픽(기한 순)
 * @param ongoing 상시 에픽의 이번 기간 처리량
 * @param noEpicDone 보고하는 에픽 밖에서 이번 기간 완료한 이슈 수(에픽 없음 + 이미 닫힌·취소된 에픽 아래)
 * @param noEpicDoneTitles 그 제목(최신 완료순, 상한 {@link #TITLE_LIMIT})
 * @param decisionCandidates 결정 요청 후보(NO_NEXT_EPIC → EPIC_OVERDUE_PROJECTED → BLOCKED_ON_HUMAN)
 * @param metrics 「참고 지표」 다섯 줄(고정 순서)
 * @param projectOwner 프로젝트 소유자 이름 — 결정 요청의 「누가」 기본값
 */
public record ProjectReportEpics(
    List<CompletedEpic> completed,
    List<PastEpic> previousCompleted,
    List<InProgressEpic> inProgress,
    List<UpcomingEpic> upcomingWithDue,
    List<OngoingEpic> ongoing,
    int noEpicDone,
    List<String> noEpicDoneTitles,
    List<DecisionCandidate> decisionCandidates,
    List<ReportMetric> metrics,
    String projectOwner) {

  /** 상시 에픽 라벨 — 끝나지 않는 운영·결함 묶음. 완료·진행 중·도표·지표에서 빠지고 처리량으로만 나온다. */
  public static final String ONGOING_LABEL = "상시";

  /** AI 테스터가 찾은 이슈의 라벨 — 상시 에픽 처리량에서 따로 센다. */
  public static final String AI_TESTER_LABEL = "AI 탐색";

  /** 에픽당 제목 목록 안전 상한 — 넘치면 마지막에 「외 N건」. */
  public static final int TITLE_LIMIT = 100;

  /** 결정 후보 — 앞으로 기한을 정한 에픽이 없음. */
  public static final String NO_NEXT_EPIC = "NO_NEXT_EPIC";

  /** 결정 후보 — 남은 하위가 모두 사람 담당·할 일 상태. */
  public static final String BLOCKED_ON_HUMAN = "BLOCKED_ON_HUMAN";

  /** 결정 후보 — 예상 완료일이 기한을 넘김, 또는 기한이 지났는데 예상 완료일을 낼 수 없는 「위험」 에픽. */
  public static final String EPIC_OVERDUE_PROJECTED = "EPIC_OVERDUE_PROJECTED";

  /** 결정 후보 owner 기본값 · 소유자 이름을 모를 때의 이름. */
  public static final String OWNER_FALLBACK = "프로젝트 소유자";

  /** 진행 상태 낱말(화면과 같은 글자). */
  public static final String ON_TRACK = "순조로움";

  public static final String WARN = "주의";
  public static final String RISK = "위험";

  /** 담당 표기 — AI 가 하나라도 있을 때 / 담당이 없을 때 / 사람 이름 뒤 꼬리. */
  public static final String ASSIGNEE_AI = "AI";

  public static final String ASSIGNEE_NONE = "없음";
  public static final String HUMAN_SUFFIX = "(사람)";

  /**
   * 기한·완료일이 있는 완료 에픽의 공통 모양 — 일정 도표({@code ReportScheduleChart})가 이번·지난 기간 에픽을 옮겨 담지 않고 그대로 그리게
   * 한다(WP-1629 리뷰). 레코드 칸 이름이 곧 이 메서드들이다.
   */
  public interface ScheduledEpic {
    /** 에픽 제목. */
    String title();

    /** 기한 M/d, 없으면 null. */
    String dueDate();

    /** 완료일 M/d. */
    String completedDate();

    /** 완료일 − 기한(양수 = 늦음), 기한 없으면 null. */
    Integer lateDays();
  }

  /**
   * 이번 기간 완료한 에픽.
   *
   * @param dueDate 기한 M/d, 없으면 null
   * @param completedDate 완료일(닫힌 시각의 서울 날짜) M/d
   * @param lateDays 완료일 − 기한(양수 = 늦음), 기한 없으면 null
   * @param children 에픽에 속한 하위 전체 수(삭제 제외)
   * @param summary 본문 앞 700자(공백 접기), 본문이 없으면 null
   * @param doneChildren 에픽에 속한 DONE 하위 제목 전부(기간 무관, 최신 완료순, 상한)
   */
  public record CompletedEpic(
      String key,
      String url,
      String title,
      String dueDate,
      String completedDate,
      Integer lateDays,
      int children,
      String summary,
      List<String> doneChildren)
      implements ScheduledEpic {}

  /** 지난 기간 완료한 에픽 — 일정 도표 아래쪽·기한 내 완료 지난 값에 쓴다. */
  public record PastEpic(
      String key, String title, String dueDate, String completedDate, Integer lateDays)
      implements ScheduledEpic {}

  /**
   * 진행 중인 에픽.
   *
   * @param done 하위 중 끝난(DONE·CANCELED) 수 — 에픽 진행률 규칙(WP-243)
   * @param total 하위 전체 수
   * @param doneThisPeriod 이번 기간 DONE 된 하위 수
   * @param status 순조로움/주의/위험({@link #epicStatus})
   * @param projectedDate 예상 완료일 M/d, 예상할 수 없으면 null
   * @param doneChildren 이번 기간 완료한 하위 제목(상한)
   * @param remaining 남은(열린) 하위(키 순, 상한 {@link #TITLE_LIMIT})
   */
  public record InProgressEpic(
      String key,
      String url,
      String title,
      int done,
      int total,
      int doneThisPeriod,
      String status,
      String dueDate,
      String projectedDate,
      String summary,
      List<String> doneChildren,
      List<RemainingChild> remaining) {}

  /**
   * 진행 중 에픽의 남은 하위.
   *
   * @param status 프로젝트 상태 이름
   * @param assignee 담당 표기({@link #assigneeLabel})
   * @param lastComment 사람만 담당·할 일 상태이거나 기한 초과일 때만 마지막 댓글(200자), 그 밖 null
   */
  public record RemainingChild(
      String key, String title, String status, String assignee, String lastComment) {}

  /** 앞으로 기한을 정한 에픽. */
  public record UpcomingEpic(String key, String title, String dueDate) {}

  /**
   * 상시 에픽 처리량.
   *
   * @param doneThisPeriod 이번 기간 DONE 된 하위 수
   * @param foundByAiTester 그중 「AI 탐색」 라벨 수
   * @param doneTitles 그 제목(「AI 탐색」이면 끝에 「 [AI 탐색]」, 상한)
   */
  public record OngoingEpic(
      String title, int doneThisPeriod, int foundByAiTester, List<String> doneTitles) {}

  /**
   * 결정 요청 후보.
   *
   * @param kind {@link #NO_NEXT_EPIC} / {@link #BLOCKED_ON_HUMAN} / {@link #EPIC_OVERDUE_PROJECTED}
   * @param epic 관련 에픽 키, 없으면 null
   * @param detail 사실 문장
   * @param owner 결정할 사람
   */
  public record DecisionCandidate(String kind, String epic, String detail, String owner) {}

  /** 「참고 지표」 한 줄 — 이번·지난 값 글자(비교할 값이 없으면 「—」). */
  public record ReportMetric(String label, String current, String previous) {}

  /** 빈 집계 — 에픽·이슈가 하나도 없을 때의 모양(테스트·기본값). */
  public static ProjectReportEpics empty() {
    return new ProjectReportEpics(
        List.of(),
        List.of(),
        List.of(),
        List.of(),
        List.of(),
        0,
        List.of(),
        List.of(),
        List.of(),
        OWNER_FALLBACK);
  }

  // ───────────────────────── 순수 규칙 ─────────────────────────

  /** 날짜 「M/d」, null 이면 null. */
  public static String md(LocalDate d) {
    return d == null ? null : d.getMonthValue() + "/" + d.getDayOfMonth();
  }

  /** 늦은 날수 = 완료(또는 예상)일 − 기한. 둘 중 하나라도 없으면 null. */
  public static Integer lateDays(LocalDate due, LocalDate actual) {
    if (due == null || actual == null) return null;
    return (int) ChronoUnit.DAYS.between(due, actual);
  }

  /** 제목 목록을 {@link #TITLE_LIMIT} 건까지 자르고 넘친 수를 「외 N건」 한 줄로 붙인다 — 하위가 수백 건인 에픽에서도 입력이 한없이 커지지 않게. */
  public static List<String> capTitles(List<String> titles) {
    if (titles.size() <= TITLE_LIMIT) return List.copyOf(titles);
    List<String> out = new ArrayList<>(titles.subList(0, TITLE_LIMIT));
    out.add("외 " + (titles.size() - TITLE_LIMIT) + "건");
    return List.copyOf(out);
  }

  /**
   * 담당 표기 — AI 가 하나라도 있으면 「AI」, 사람만 있으면 「이름(사람)」을 「, 」로 이음, 없으면 「없음」. AI 와 사람을 함께 맡은 일은 AI 가 움직이므로
   * 사람 대기로 보지 않는다.
   *
   * @param humanNames 사람 담당 이름(이름순)
   * @param hasAgent AI 담당이 있는가
   */
  public static String assigneeLabel(List<String> humanNames, boolean hasAgent) {
    if (hasAgent) return ASSIGNEE_AI;
    if (humanNames.isEmpty()) return ASSIGNEE_NONE;
    return String.join(", ", humanNames.stream().map(n -> n + HUMAN_SUFFIX).toList());
  }

  /**
   * 진행 중 에픽 상태(결정 7) — 기한·예상 둘 다 있으면 예상 − 기한이 3일 넘게 늦으면 위험, 늦으면 주의, 아니면 순조로움. 예상만 있으면 순조로움. 예상이 없고
   * 남은 일이 있으면 기한이 오늘보다 앞이면 위험, 아니면 주의(속도가 없어 끝을 볼 수 없다). 남은 일이 없으면 순조로움.
   */
  public static String epicStatus(
      LocalDate due, LocalDate projected, boolean hasRemaining, LocalDate today) {
    if (projected != null) {
      Integer late = lateDays(due, projected);
      if (late == null) return ON_TRACK;
      if (late > 3) return RISK;
      if (late > 0) return WARN;
      return ON_TRACK;
    }
    if (!hasRemaining) return ON_TRACK;
    return due != null && due.isBefore(today) ? RISK : WARN;
  }
}
