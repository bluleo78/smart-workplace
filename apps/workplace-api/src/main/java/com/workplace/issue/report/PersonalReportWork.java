package com.workplace.issue.report;

import java.util.Comparator;
import java.util.List;

/**
 * 개인 주간·월간 보고의 끝낸 일 집계(WP-1632) — 이번 기간 내가 끝낸 이슈를 프로젝트 → 에픽으로 묶은 것. 건수는 시스템이 세고 AI 는 세지 않는다: 프로젝트
 * {@code done} 의 합은 끝냄 건수({@link PersonalReportFacts#completed})와 같은 집합(지표 모듈 closedIssues)에서 나온다.
 *
 * <p>정렬: 프로젝트는 끝낸 일 많은 순 → 이름, 에픽은 {@link #EPIC_ORDER}(끝낸 일 많은 순 → 프로젝트 키 → 번호 숫자 순), 「에픽 없음」 은 맨
 * 뒤. 제목은 최근 끝낸 것부터 에픽당 {@link ProjectReportEpics#TITLE_LIMIT} 건까지, 그리고 AI 입력 전체로 {@link
 * #TITLE_BUDGET} 건 안에서({@link #titleLimit}) — 넘치면 「외 N건」.
 *
 * @param projects 프로젝트별 끝낸 일(이슈의 프로젝트 기준 — 에픽이 다른 프로젝트에 있어도 이슈 프로젝트에 묶는다)
 */
public record PersonalReportWork(List<ProjectWork> projects) {

  /** 에픽이 없거나 읽을 수 없는 에픽 아래 끝낸 일의 묶음 이름. */
  public static final String NO_EPIC = "에픽 없음";

  /** AI 입력에 싣는 끝낸 이슈 제목의 전체 상한(WP-1632 리뷰) — 1000건 넘는 달에도 프롬프트 크기·생성 시간이 묶이게. 건수(done)는 줄이지 않는다. */
  public static final int TITLE_BUDGET = 600;

  /** 예산이 모자라도 에픽마다 남기는 제목 수 — 에픽이 무슨 일이었는지 AI 가 읽을 실마리. 에픽이 아주 많으면 이 바닥 때문에 예산을 넘을 수 있다. */
  public static final int MIN_TITLES_PER_EPIC = 3;

  /** 에픽 정렬 — 「에픽 없음」 맨 뒤, 끝낸 일 많은 순, 같으면 프로젝트 키 → 번호 숫자 순(글자 순이면 WP-10 이 WP-9 앞에 온다). */
  public static final Comparator<EpicWork> EPIC_ORDER =
      Comparator.comparing((EpicWork w) -> w.key() == null)
          .thenComparing(EpicWork::done, Comparator.reverseOrder())
          .thenComparing(w -> keyProject(w.key()), Comparator.nullsLast(Comparator.naturalOrder()))
          .thenComparing(w -> keyNumber(w.key()), Comparator.nullsLast(Comparator.naturalOrder()));

  /** 에픽 키의 프로젝트 부분(마지막 「-」 앞), 키가 없으면 null. */
  private static String keyProject(String key) {
    if (key == null) return null;
    int dash = key.lastIndexOf('-');
    return dash < 0 ? key : key.substring(0, dash);
  }

  /** 에픽 키의 번호(마지막 「-」 뒤 숫자), 키가 없거나 숫자가 아니면 null. */
  private static Long keyNumber(String key) {
    if (key == null) return null;
    int dash = key.lastIndexOf('-');
    try {
      return Long.parseLong(key.substring(dash + 1));
    } catch (NumberFormatException e) {
      return null;
    }
  }

  /**
   * 에픽당 제목 상한 — 모든 에픽의 min(제목 수, L) 합이 {@link #TITLE_BUDGET} 안인 가장 큰 L(바닥 {@link
   * #MIN_TITLES_PER_EPIC}, 천장 TITLE_LIMIT). 에픽마다 같은 상한이라 작은 에픽이 덜 쓴 몫은 큰 에픽이 쓴다. 이분 탐색.
   *
   * @param sizes 에픽마다 상한 전 끝낸 이슈 수
   */
  static int titleLimit(List<Integer> sizes) {
    int lo = MIN_TITLES_PER_EPIC;
    int hi = ProjectReportEpics.TITLE_LIMIT;
    if (shown(sizes, hi) <= TITLE_BUDGET) return hi;
    // 불변식: shown(lo) <= 예산이거나 lo 가 바닥, shown(hi) > 예산.
    while (lo + 1 < hi) {
      int mid = (lo + hi) >>> 1;
      if (shown(sizes, mid) <= TITLE_BUDGET) lo = mid;
      else hi = mid;
    }
    return lo;
  }

  /** 에픽당 상한 limit 일 때 싣는 제목 수 합. */
  private static long shown(List<Integer> sizes, int limit) {
    return sizes.stream().mapToLong(n -> Math.min(n, limit)).sum();
  }

  /** 끝낸 일 합(프로젝트 done 의 합) — 끝냄 건수와 같아야 한다. */
  public int total() {
    return projects.stream().mapToInt(ProjectWork::done).sum();
  }

  /**
   * 한 프로젝트의 끝낸 일.
   *
   * @param projectKey 프로젝트 키
   * @param projectName 프로젝트 이름
   * @param done 끝낸 이슈 수
   * @param foundByAiTester 그중 「AI 탐색」 라벨(AI 테스터가 찾은 결함) 수
   * @param epics 에픽별 끝낸 일(「에픽 없음」 맨 뒤)
   */
  public record ProjectWork(
      String projectKey, String projectName, int done, int foundByAiTester, List<EpicWork> epics) {}

  /**
   * 한 에픽(또는 「에픽 없음」) 아래 끝낸 일.
   *
   * @param key 에픽 키(에픽 프로젝트 키 기준), 「에픽 없음」 이면 null
   * @param url 에픽 주소, 「에픽 없음」 이면 null
   * @param title 에픽 제목, 「에픽 없음」 이면 {@link #NO_EPIC}
   * @param ongoing 「상시」 라벨 에픽 — 결함 수정처럼 끝없이 이어지는 일의 묶음
   * @param epicDone 이번 기간 내가 에픽 자체를 끝냄
   * @param done 끝낸 이슈 수(에픽 자체를 끝냈으면 그것도 센다)
   * @param foundByAiTester 그중 「AI 탐색」 라벨 수
   * @param doneTitles 끝낸 이슈 제목(최근 끝낸 순, 에픽 상한·전체 예산 뒤 「외 N건」)
   */
  public record EpicWork(
      String key,
      String url,
      String title,
      boolean ongoing,
      boolean epicDone,
      int done,
      int foundByAiTester,
      List<String> doneTitles) {}
}
