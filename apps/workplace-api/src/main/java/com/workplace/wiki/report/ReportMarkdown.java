package com.workplace.wiki.report;

import com.workplace.issue.overview.status.StatusBadge;
import com.workplace.issue.report.ProjectReportEpics;
import com.workplace.issue.report.ProjectReportFacts;
import com.workplace.issue.report.ReportCadence;
import com.workplace.issue.report.ReportIssueDetails;
import com.workplace.issue.report.ReportNumbers;
import com.workplace.wiki.service.WikiAiInstruction;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.function.Predicate;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 리포트 마크다운 후처리(WP-1483) — AI 가 쓴 리포트를 노트에 넣기 전에 시스템 값으로 바로잡는다. 표의 숫자와 배지는 시스템이 보증하고 AI 는 글만 쓴다(설계
 * 「후처리 규칙」).
 *
 * <p>{@link #finish} 순서: ① 지시 상자 제거({@link WikiAiInstruction#strip}) ② 맨 앞 h1 제거(제목은 페이지 제목) ③ 「상태와
 * 한 줄」 배지 줄 바로잡기 ④ 「지난 리포트 이후」 표 몸통을 계산값으로 다시 쓰기(없고 템플릿에 있었으면 넣기) ⑤ 앱 이슈 주소로 된 {@code [글](url)} 링크를
 * 맨 주소로(앱 링크 칩이 되게). 글 속 숫자는 고치지 않는다.
 *
 * <p>개인 보고(WP-1486)와 나눠 쓰려고 공통 단계를 공개 단위로 나눴다 — {@link #clean}(①②⑤) → (프로젝트만) 배지 → {@link
 * #fixTable}(표 모양은 {@link ReportTableSpec}) → {@link #render}. ⑤ 링크는 ③④ 앞에서 돌지만 배지·표 단계가 링크를 만들거나
 * 지우지 않아 결과는 같다.
 *
 * <p>모두 줄 단위로 훑고, 펜스 코드 블록({@code ```}·{@code ~~~}) 안은 건드리지도 인식하지도 않는다 — 펜스 추적은 {@link
 * WikiAiInstruction} 과 같은 규칙(인용·들여쓰기 접두를 뗀 뒤, 같은 글자·같거나 긴 길이·뒤 글자 없는 줄이 닫음). 그래서 AI 가 코드 블록에 적은 예시
 * 표는 리포트 표로 보지 않는다.
 */
public final class ReportMarkdown {

  /**
   * 카드용 한 줄.
   *
   * @param badge 배지 이름(ON_TRACK / WARN / RISK), 배지 줄이 없으면 null
   * @param line 배지 문단의 배지 뒤 글(없으면 다음 첫 글 문단)을 마크다운 없이 한 줄로(200자까지). 글 문단이 없으면 null
   */
  public record CardSummary(String badge, String line) {}

  /** 배지 줄을 둘 섹션 제목. */
  static final String STATUS_SECTION = ReportTableSpec.PROJECT_STATUS_SECTION;

  /** 새 모양(WP-1629)의 진행 상태 줄을 둘 h2 섹션. */
  static final String SUMMARY_SECTION = ReportTableSpec.PROJECT_SUMMARY_SECTION;

  /** 새 모양의 일정 도표를 둘 h2 섹션(자리 줄이 없을 때). */
  static final String SCHEDULE_SECTION = "일정";

  /** 일정 도표 자리 줄 — 글자 그대로(중괄호 2개 + 「일정 도표」). */
  static final String CHART_TOKEN = "{{일정 도표}}";

  /** 지난 리포트가 바로 앞 기간이 아닐 때 진행 상태 줄의 견줌 낱말(「(지난 리포트 주의)」). */
  static final String PREVIOUS_REPORT_WORD = "지난 리포트";

  /** 진행 상태 표지 글자 — 쓰기(줄 찾기)와 읽기(카드 낱말)가 같은 글자를 쓰게 한 곳에 둔다(WP-1629). */
  private static final String STATUS_TEXT = "진행 상태";

  /** 진행 상태 줄 표지. */
  static final String STATUS_LABEL = "**" + STATUS_TEXT + "**";

  /**
   * 진행 상태 줄 찾기(WP-1629) — 굵은 구간이 「진행 상태」 낱말 하나(뒤에 콜론만 허용)여야 줄로 본다 — 「**진행 상태가 늦은 에픽**」 같은 다른 굵은 글은
   * 줄이 아니다. 「**진행 상태**」·「**진행 상태:** 주의」·「**진행 상태: 주의**」·「**진행 상태** : 주의」 변형을 모두 잡는다. 굵지 않은 본문 글(「진행
   * 상태가 …」)은 줄로 보지 않는다.
   */
  private static final Pattern STATUS_LINE =
      Pattern.compile("\\*\\*\\s*" + STATUS_TEXT + "\\s*(?:[:：]|\\*\\*)");

  /** 진행 상태 줄의 낱말 — 「**진행 상태** 주의」·「**진행 상태: 주의**」 모두 읽는다. */
  private static final Pattern STATUS_WORD = Pattern.compile(STATUS_TEXT + "[\\s*:：]*(순조로움|주의|위험)");

  /** 줄 중간에 남은 일정 도표 자리 글자(앞 공백 포함). */
  private static final Pattern STRAY_TOKEN =
      Pattern.compile("[ \\t]*" + Pattern.quote(CHART_TOKEN));

  /** 목록 줄(글머리·번호). */
  private static final Pattern LIST_ITEM = Pattern.compile("^[ \\t]*(?:[-*+]|\\d+[.)])[ \\t]+");

  /** 카드 한 줄 길이 상한. */
  static final int CARD_LINE_MAX = 200;

  /** 배지 → 화면 낱말. */
  private static final Map<StatusBadge, String> KO =
      Map.of(StatusBadge.ON_TRACK, "순조로움", StatusBadge.WARN, "주의", StatusBadge.RISK, "위험");

  private static final String WORD = "(순조로움|주의|위험)";

  /**
   * 굵은 배지가 든 줄: 1=들여쓰기, 2=굵게 앞 글(「상태: 」 등), 3=굵게 안 배지 앞 글(「**상태: 주의**」 의 「상태: 」), 4=배지 낱말, 5=굵게 안
   * 배지 뒤 글, 6=(있으면) 「 · 이전 → 지금」 뒤 나머지. 줄 맨 앞이 아니어도·굵게 안에 접두가 있어도 배지로 본다 — AI 가 「상태: **주의**」 처럼 써도
   * 배지 줄이 둘 생기지 않게(코드 리뷰 #5).
   */
  private static final Pattern BADGE_LINE =
      Pattern.compile(
          "^([ \\t]*)(.*?)\\*\\*([^*\\n]*?)"
              + WORD
              + "([^*\\n]*?)\\*\\*(?:[ \\t]*·[ \\t]*(?:순조로움|주의|위험)[ \\t]*→[ \\t]*(?:순조로움|주의|위험))?(.*)$");

  /** 배지 뒤 나머지 글 앞의 구분 표시(공백·가운뎃점·대시·쌍점 등) — 카드 한 줄에서 뗀다. */
  private static final Pattern LEADING_SEPARATORS = Pattern.compile("^[\\s·—–:|,\\-]+");

  /** 줄 앞 컨테이너 접두(인용 표시 여러 겹 + 들여쓰기) — WikiAiInstruction 과 같다. */
  private static final Pattern PREFIX = Pattern.compile("^((?:[ \\t]*>)*[ \\t]*)");

  /** 펜스 후보 줄(접두를 뗀 뒤): 1=펜스 글자 연속, 2=뒤 글자 — WikiAiInstruction 과 같다. */
  private static final Pattern FENCE_LINE = Pattern.compile("^(`{3,}|~{3,})(.*)$");

  /** ATX 제목: 1=# 연속, 2=제목 글자. */
  private static final Pattern HEADING =
      Pattern.compile("^ {0,3}(#{1,6})[ \\t]+(.*?)(?:[ \\t]+#+)?[ \\t]*$");

  /** 표 구분 줄(|---|:---:| 모양, 「|」 하나 이상 필수 — 「---」 가로줄과 가르기 위해). */
  private static final Pattern DELIMITER =
      Pattern.compile("^[ \\t]*\\|?[ \\t]*:?-+:?[ \\t]*(?:\\|[ \\t]*:?-+:?[ \\t]*)*\\|?[ \\t]*$");

  /** 이름 붙은 링크(이미지 제외): 1=글, 2=주소. */
  private static final Pattern NAMED_LINK =
      Pattern.compile("(?<!!)\\[([^\\]\\n]*)\\]\\(([^)\\s]+)\\)");

  private ReportMarkdown() {}

  // ───────────── 공개 입구 ─────────────

  /**
   * AI 마크다운을 노트에 넣을 모양으로 바로잡는다.
   *
   * <p>순서(WP-1629): clean → 상태 줄({@link #fixStatus}) → 옛 「지난 리포트 이후」 표 → 「참고 지표」 표 → 일정 도표({@link
   * #fixChart}) → render.
   *
   * @param aiMarkdown AI 가 쓴 마크다운(null 이면 빈 글)
   * @param facts 계산값(배지·표 행·에픽 집계)
   * @param templateHasTable 템플릿에 리포트 표가 있었는가 — 결과에 표가 없을 때 넣을지 정한다(팀이 뺐으면 넣지 않는다)
   * @param templateHasMetrics 템플릿에 「참고 지표」 표(머리 첫 칸 「지표」)가 있었는가 — 결과에 없을 때 문서 끝에 넣을지 정한다
   * @param issueUrlPrefix 앱 이슈 주소 접두 — {@code {base}/projects/} 또는 {@code
   *     {base}/projects/{KEY}/issues/}. 이 접두 뒤가 {@code KEY/issues/n} 또는 {@code n} 인 링크만 맨 주소로 바꾼다.
   *     비어 있으면 링크를 건드리지 않는다
   */
  public static String finish(
      String aiMarkdown,
      ProjectReportFacts facts,
      boolean templateHasTable,
      boolean templateHasMetrics,
      String issueUrlPrefix) {
    List<String> lines = clean(aiMarkdown, issueUrlPrefix);
    ReportCadence cadence = facts.period().cadence();
    // 지난 리포트가 바로 앞 기간이 아니면(건너뛴 회차가 낌) 「지난주」가 틀리므로 「지난 리포트」로 견준다(WP-1629 리뷰).
    String previousWord =
        facts.previousFromPreviousPeriod() ? cadence.previousWord() : PREVIOUS_REPORT_WORD;
    fixStatus(lines, facts.badge(), facts.previousBadge(), previousWord);
    // 옛 표 자리는 「상태와 한 줄」 → 없으면 「요약」(AI 가 썼거나 위에서 넣음) 순 후보(ReportTableSpec#project) — 「요약」 제목과 진행 상태
    // 줄 사이에 끼지 않게.
    fixTable(lines, ReportTableSpec.project(facts.rows()), templateHasTable);
    ProjectReportEpics epics = facts.epics();
    // 지표가 비어 있으면(계산값 없음) 표를 비우지 않게 건너뛴다 — 운영 집계는 늘 다섯 줄이다.
    if (epics != null && !epics.metrics().isEmpty()) {
      fixTable(lines, ReportTableSpec.metrics(epics.metrics(), cadence), templateHasMetrics);
    }
    Optional<String> chart =
        epics == null
            ? Optional.empty()
            : ReportScheduleChart.block(epics.completed(), epics.previousCompleted(), cadence);
    fixChart(lines, chart);
    return render(lines);
  }

  /**
   * 공통 정리(WP-1486) — 지시 상자 제거 → 맨 앞 h1 제거 → 앱 이슈 {@code [글](url)} 를 맨 주소로. 다음 단계(배지·표)가 줄을 넣고 빼도록
   * 고칠 수 있는 줄 목록을 돌려준다.
   *
   * @param aiMarkdown AI 가 쓴 마크다운(null 이면 빈 글)
   * @param issueUrlPrefix 앱 이슈 주소 접두({@link #finish} 와 같은 뜻). 비어 있으면 링크를 건드리지 않는다
   */
  public static List<String> clean(String aiMarkdown, String issueUrlPrefix) {
    String stripped = WikiAiInstruction.strip(aiMarkdown == null ? "" : aiMarkdown);
    List<String> lines =
        new ArrayList<>(Arrays.asList(stripped.replace("\r\n", "\n").split("\n", -1)));
    removeLeadingH1(lines);
    bareIssueLinks(lines, issueUrlPrefix);
    return lines;
  }

  /** 펜스 밖에 「지난 리포트 이후」 로 시작하는 머리의 표가 있는가 — 템플릿에 표가 있었는지 볼 때 쓴다. */
  public static boolean hasReportTable(String markdown) {
    return hasTable(markdown, ReportTableSpec.project(List.of()).headFirstCell());
  }

  /** 펜스 밖에 머리 첫 칸이 「지표」인 「참고 지표」 표가 있는가(WP-1629) — 템플릿에 그 표가 있었는지 볼 때 쓴다. */
  public static boolean hasMetricsTable(String markdown) {
    return hasTable(markdown, ReportTableSpec.METRICS_HEAD::equals);
  }

  /**
   * 펜스 밖에 머리 첫 칸(굵게·공백 제거)이 판정을 통과하는 표가 있는가(WP-1486) — 템플릿에 그 표가 있었는지 볼 때 쓴다.
   *
   * @param headFirstCell 머리 첫 칸 판정({@link ReportTableSpec#headFirstCell} 과 같은 것)
   */
  public static boolean hasTable(String markdown, Predicate<String> headFirstCell) {
    if (markdown == null) return false;
    List<String> lines = Arrays.asList(markdown.replace("\r\n", "\n").split("\n", -1));
    return findTable(lines, fenced(lines), headFirstCell) >= 0;
  }

  /**
   * 템플릿에 이 명세의 표가 있는가(WP-1632 리뷰) — {@link #fixTable} 이 표를 찾는 규칙과 같다. 명세에 {@code insertIntoSection}
   * 이 있으면 그 절(「이번 주 한 일」 등) 안의 표만 센다 — 다른 절의 같은 머리 표(사용자 표)를 템플릿 표로 착각해 넣지 않게.
   *
   * @param spec 표 모양(머리 판정·절 제한)
   */
  public static boolean hasTable(String markdown, ReportTableSpec spec) {
    if (markdown == null) return false;
    List<String> lines = Arrays.asList(markdown.replace("\r\n", "\n").split("\n", -1));
    return findTable(lines, fenced(lines), spec) >= 0;
  }

  /**
   * 카드용 읽기 — 「상태와 한 줄」 섹션(없으면 문서 전체)의 첫 글 문단에 굵은 배지가 있으면 그 배지와, 같은 문단의 배지 뒤 글(없으면 다음 글 문단)을, 아니면 배지
   * null 과 그 문단을 한 줄로.
   */
  public static CardSummary cardSummary(String markdown) {
    if (markdown == null) return new CardSummary(null, null);
    List<String> lines = Arrays.asList(markdown.replace("\r\n", "\n").split("\n", -1));
    boolean[] fenced = fenced(lines);
    // 새 모양(WP-1629) — 「요약」 h2 가 있으면 진행 상태 줄 낱말이 배지, 첫 글 문단(판단 문장)이 한 줄.
    int summary = findH2(lines, fenced, SUMMARY_SECTION);
    if (summary >= 0) return summaryCard(lines, fenced, summary);
    int from = 0;
    int to = lines.size();
    int h = findSection(lines, fenced, STATUS_SECTION);
    if (h >= 0) {
      from = h + 1;
      to = sectionEnd(lines, fenced, h);
    }
    List<List<String>> paragraphs = textParagraphs(lines, fenced, from, to);
    if (paragraphs.isEmpty()) return new CardSummary(null, null);
    List<String> first = paragraphs.get(0);
    for (int i = 0; i < first.size(); i++) {
      Matcher m = BADGE_LINE.matcher(first.get(i));
      if (!m.matches()) continue;
      String badge = badgeKey(m.group(4));
      // 배지 문단에 배지 뒤 글(같은 줄 나머지·이어지는 소프트 줄바꿈 줄)이 있으면 그 글이 한 줄이다(코드 리뷰 #6). 없으면 다음 문단.
      List<String> after = new ArrayList<>();
      after.add(LEADING_SEPARATORS.matcher(m.group(6)).replaceFirst(""));
      after.addAll(first.subList(i + 1, first.size()));
      String line = plainLine(after);
      if (line == null && paragraphs.size() > 1) line = plainLine(paragraphs.get(1));
      return new CardSummary(badge, line);
    }
    return new CardSummary(null, plainLine(first));
  }

  /**
   * 「요약」 섹션 카드 읽기(WP-1629) — 배지는 펜스 밖 진행 상태 줄의 낱말(없으면 null → 저장 배지), 한 줄은 목록이 아닌 첫 글 문단(판단 문장). 판단
   * 문장 없이 목록만 있으면 문서 전체의 목록·제목이 아닌 첫 글 문단으로 물러선다 — AI 가 「요약」·「상태와 한 줄」 없이 써서 {@link #fixStatus} 가
   * 「## 요약」 + 진행 상태 줄만 넣은 리포트도 옛 카드처럼 첫 문단을 한 줄로 보이게(리뷰 반영). 진행 상태 줄은 목록 줄이라 한 줄로 되풀이하지 않는다. 그런 문단도
   * 없으면 null.
   */
  private static CardSummary summaryCard(List<String> lines, boolean[] fenced, int h) {
    int end = sectionEnd(lines, fenced, h);
    String badge = null;
    for (int i = h + 1; i < end && badge == null; i++) {
      if (fenced[i]) continue;
      Matcher m = STATUS_WORD.matcher(lines.get(i));
      if (m.find()) badge = badgeKey(m.group(1));
    }
    String line = firstProse(lines, fenced, h + 1, end);
    if (line == null) line = firstProse(lines, fenced, 0, lines.size());
    return new CardSummary(badge, line);
  }

  /** {@code [from, to)} 의 펜스 밖 첫 글 문단 중 목록·진행 상태 줄로 시작하지 않는 것을 한 줄로(없으면 null) — 카드 한 줄 후보. */
  private static String firstProse(List<String> lines, boolean[] fenced, int from, int to) {
    for (List<String> p : textParagraphs(lines, fenced, from, to)) {
      String first = p.get(0);
      if (LIST_ITEM.matcher(first).find() || STATUS_LINE.matcher(first).find()) continue;
      String line = plainLine(p);
      if (line != null) return line;
    }
    return null;
  }

  // ───────────── ② 맨 앞 h1 ─────────────

  /** 첫 글 줄이 h1(「# 」)이면 그 줄과 앞뒤 빈 줄을 지운다 — 제목은 페이지 제목이 맡는다. */
  private static void removeLeadingH1(List<String> lines) {
    int i = 0;
    while (i < lines.size() && lines.get(i).isBlank()) i++;
    if (i >= lines.size()) return;
    Matcher m = HEADING.matcher(lines.get(i));
    if (!m.matches() || m.group(1).length() != 1) return;
    lines.subList(0, i + 1).clear();
    while (!lines.isEmpty() && lines.get(0).isBlank()) lines.remove(0);
  }

  // ───────────── ③ 배지 줄 ─────────────

  /**
   * 「상태와 한 줄」 제목 뒤 첫 문단에 굵은 배지 낱말(「상태: **주의**」·「**상태: 주의**」 같은 접두 포함)이 든 줄이 있으면 그 줄의 배지 부분(앞 접두·이전
   * → 지금 화살표 포함)을 시스템 배지 줄로 바꾸고 뒤 글은 남긴다. 없으면 제목 바로 뒤에, 섹션 자체가 없으면 맨 앞에 넣는다.
   */
  private static void fixBadge(List<String> lines, StatusBadge now, StatusBadge previous) {
    String badgeLine = "**" + KO.get(now) + "**";
    if (previous != null && previous != now) {
      badgeLine += " · " + KO.get(previous) + " → " + KO.get(now);
    }
    boolean[] fenced = fenced(lines);
    int h = findSection(lines, fenced, STATUS_SECTION);
    if (h < 0) {
      lines.add(0, badgeLine);
      lines.add(1, "");
      return;
    }
    int end = sectionEnd(lines, fenced, h);
    int j = h + 1;
    while (j < end && lines.get(j).isBlank()) j++;
    // 첫 문단의 어느 줄이든 굵은 배지가 있으면 그 줄을 시스템 배지 줄로 바꾼다(앞 접두는 버리고 뒤 글은 남김) — 둘째 배지 줄을 넣지 않는다.
    for (int k = j; k < end && !fenced[k] && !lines.get(k).isBlank(); k++) {
      Matcher m = BADGE_LINE.matcher(lines.get(k));
      if (m.matches()) {
        lines.set(k, m.group(1) + badgeLine + m.group(6));
        return;
      }
    }
    lines.add(h + 1, "");
    lines.add(h + 2, badgeLine);
    // 뒤에 바로 글이 붙으면 빈 줄로 띄워 배지 줄이 따로 한 문단이 되게.
    if (h + 3 < lines.size() && !lines.get(h + 3).isBlank()) {
      lines.add(h + 3, "");
    }
  }

  // ───────────── 새 모양 진행 상태 줄(WP-1629) ─────────────

  /**
   * 진행 상태 줄을 시스템 값으로(결정 18). 펜스 밖 「요약」 h2 가 있으면 그 섹션에서 {@code **진행 상태**} 가 든 첫 줄을 {@code - **진행
   * 상태** {지금} ({견줌 낱말} {지난})} 로 바꾸고 같은 섹션의 나머지 진행 상태 줄은 지운다(한 번만 보이게). 없으면 섹션의 첫 목록 줄 앞에, 목록이 없으면 첫
   * 문단 뒤에 넣는다. 「요약」이 없고 옛 「상태와 한 줄」이 있으면 옛 배지 규칙({@link #fixBadge}) 그대로. 둘 다 없으면 맨 앞에 「## 요약」 + 진행
   * 상태 줄을 넣는다 — 옛 「맨 앞 굵은 배지」 대신(「주의」가 본문 배지와 두 번 나오지 않게), 섹션 밖 다른 굵은 글은 건드리지 않는다.
   *
   * @param previousWord 지난 배지 앞 견줌 낱말 — 지난 리포트가 바로 앞 기간이면 주기 낱말(지난주·지난 기간·지난달), 아니면 {@link
   *     #PREVIOUS_REPORT_WORD}
   */
  static void fixStatus(
      List<String> lines, StatusBadge now, StatusBadge previous, String previousWord) {
    String statusLine = "- " + STATUS_LABEL + " " + KO.get(now);
    if (previous != null) {
      statusLine += " (" + previousWord + " " + KO.get(previous) + ")";
    }
    boolean[] fenced = fenced(lines);
    int h = findH2(lines, fenced, SUMMARY_SECTION);
    if (h < 0) {
      if (findSection(lines, fenced, STATUS_SECTION) >= 0) {
        fixBadge(lines, now, previous);
        return;
      }
      lines.addAll(0, List.of("## " + SUMMARY_SECTION, "", statusLine, ""));
      return;
    }
    int end = sectionEnd(lines, fenced, h);
    // 뒤에서부터 훑어 앞의 것을 남긴다 — 뒤 줄을 지워도 앞 위치는 그대로다.
    int found = -1;
    for (int i = end - 1; i > h; i--) {
      // 콜론 위치가 다른 변형도 같은 줄로 찾아 한 줄로 고친다 — 못 찾으면 AI 줄이 남아 시스템 값과 모순된 줄이 둘이 된다(WP-1629).
      if (fenced[i] || !STATUS_LINE.matcher(lines.get(i)).find()) continue;
      if (found >= 0) lines.remove(found);
      found = i;
    }
    if (found >= 0) {
      lines.set(found, statusLine);
      return;
    }
    for (int i = h + 1; i < end; i++) {
      if (!fenced[i] && LIST_ITEM.matcher(lines.get(i)).find()) {
        lines.add(i, statusLine);
        return;
      }
    }
    // 목록이 없으면 첫 문단 뒤(문단도 없으면 제목 바로 뒤)에 빈 줄로 띄워 넣는다.
    int at = afterFirstParagraph(lines, fenced, h, end);
    lines.add(at, "");
    lines.add(at + 1, statusLine);
    if (at + 2 < lines.size() && !lines.get(at + 2).isBlank()) {
      lines.add(at + 2, "");
    }
  }

  // ───────────── 일정 도표(WP-1629) ─────────────

  /**
   * 「{{일정 도표}}」 자리 줄을 도표 블록으로(결정 18). 펜스 밖에서 줄 전체(앞뒤 공백 제외)가 토큰인 첫 줄을 블록으로 바꾸고 나머지 토큰 줄은 지운다 — AI 가
   * 토큰을 두 번 써도 도표는 하나. 토큰 줄이 없으면 「일정」 h2 섹션의 첫 문단 뒤에 넣고, 그 섹션도 없으면 넣지 않는다. 도표를 만들 수 없으면(기한 정한 완료 에픽
   * 없음) 토큰 줄만 지운다. 펜스 안 토큰은 예시 글이라 건드리지 않는다.
   */
  static void fixChart(List<String> lines, Optional<String> chart) {
    boolean[] fenced = fenced(lines);
    List<Integer> tokens = new ArrayList<>();
    for (int i = 0; i < lines.size(); i++) {
      if (!fenced[i] && lines.get(i).strip().equals(CHART_TOKEN)) tokens.add(i);
    }
    // 첫 토큰 뒤의 것부터, 뒤에서 앞으로 지운다(앞 위치가 밀리지 않게).
    for (int k = tokens.size() - 1; k >= 1; k--) removeLine(lines, tokens.get(k));
    boolean changed = tokens.size() > 1;
    if (!tokens.isEmpty()) {
      int t = tokens.get(0);
      if (chart.isEmpty()) {
        removeLine(lines, t);
      } else {
        lines.remove(t);
        insertBlock(lines, t, chart.get());
      }
      changed = true;
    }
    // 줄 중간에만 남은 토큰은 글자만 지운다 — 자리 줄이 없었다면 아래 기본 위치에 넣는다.
    if (removeStrayTokens(lines, changed ? fenced(lines) : fenced)) changed = true;
    if (!tokens.isEmpty() || chart.isEmpty()) return;
    // 줄이 바뀌었을 때만 펜스 표시를 다시 계산한다.
    if (changed) fenced = fenced(lines);
    int h = findH2(lines, fenced, SCHEDULE_SECTION);
    if (h < 0) return;
    insertBlock(
        lines, afterFirstParagraph(lines, fenced, h, sectionEnd(lines, fenced, h)), chart.get());
  }

  /**
   * 줄 중간·목록 항목 안에 남은 「{{일정 도표}}」 글자를 펜스 밖 줄에서 지운다(WP-1629) — 자리 표시가 한 줄을 혼자 차지하지 않으면 도표가 이미 한 번 들어간
   * 뒤에도 글자가 보이기 때문. 지운 뒤 줄이 비거나 목록 표지({@code -}, {@code *})만 남으면 그 줄을 뺀다.
   *
   * @param fenced 지금 줄 목록에 맞는 펜스 표시
   * @return 줄을 하나라도 바꿨는가
   */
  private static boolean removeStrayTokens(List<String> lines, boolean[] fenced) {
    boolean changed = false;
    for (int i = lines.size() - 1; i >= 0; i--) {
      if (fenced[i] || !lines.get(i).contains(CHART_TOKEN)) continue;
      // 토큰 앞의 공백까지 함께 지워 문장에 빈 틈이 남지 않게.
      String cleaned = STRAY_TOKEN.matcher(lines.get(i)).replaceAll("");
      String rest = cleaned.strip();
      if (rest.isEmpty() || rest.equals("-") || rest.equals("*")) {
        removeLine(lines, i);
      } else {
        lines.set(i, cleaned.stripTrailing());
      }
      changed = true;
    }
    return changed;
  }

  /** 제목 줄 {@code h} 섹션의 첫 문단(펜스 밖 연속한 글 줄) 바로 뒤 위치 — 문단이 없으면 제목 바로 뒤. */
  private static int afterFirstParagraph(List<String> lines, boolean[] fenced, int h, int end) {
    int j = h + 1;
    while (j < end && lines.get(j).isBlank()) j++;
    if (j >= end) return h + 1;
    while (j < end && !fenced[j] && !lines.get(j).isBlank()) j++;
    return j;
  }

  /** 블록(여러 줄 글)을 {@code at} 에 넣는다 — 앞뒤에 글이 붙어 있으면 빈 줄로 띄워 따로 한 블록이 되게. */
  private static void insertBlock(List<String> lines, int at, String block) {
    List<String> add = new ArrayList<>(Arrays.asList(block.split("\n", -1)));
    if (at < lines.size() && !lines.get(at).isBlank()) add.add("");
    if (at > 0 && !lines.get(at - 1).isBlank()) add.add(0, "");
    lines.addAll(at, add);
  }

  /** 줄 하나를 지운다 — 그 결과 빈 줄이 둘 이어지면 하나를 지워 문단 간격을 그대로 둔다. */
  private static void removeLine(List<String> lines, int i) {
    lines.remove(i);
    if (i > 0 && i < lines.size() && lines.get(i - 1).isBlank() && lines.get(i).isBlank()) {
      lines.remove(i);
    }
  }

  // ───────────── ④ 표 ─────────────

  /**
   * 리포트 표를 시스템 값으로 다시 쓴다(WP-1486 에서 표 모양을 {@link ReportTableSpec} 으로 뺐다). 머리 첫 칸이 {@code spec} 판정을
   * 통과하는 펜스 밖 첫 표를 찾아 — {@code headCells} 가 null 이면 머리·구분 줄은 그대로 두고, 아니면 머리·구분 줄도 시스템 값으로 바꾼 뒤 —
   * 몸통을 시스템 행만으로 다시 쓴다(AI 가 뺀 행은 다시 넣고 모르는 행은 버린다). 표가 없고 템플릿에 있었으면 {@code insertSectionTitle} 제목과
   * 표를 {@code insertAfterSections} 중 처음 찾은 섹션 뒤(하나도 없으면 첫 문단 뒤)에 넣는다 — 팀이 템플릿에서 표를 뺐으면 넣지 않는다.
   *
   * <p>{@code keepAi} 가 있으면(WP-1632 개인 프로젝트 표) 지우기 전에 AI 행을 첫 칸으로 기억해 두었다가, 시스템 행마다 맞는 AI 행의 지정 칸
   * 글을 옮긴다 — 건수는 늘 시스템 값, 모르는 AI 행은 버리고, 빠진 프로젝트는 「—」. {@code insertIntoSection} 이 있고 맞는 절이 있으면 표가
   * 없을 때 그 절 제목 바로 뒤에 h2 없이 넣는다.
   *
   * @param lines 고칠 줄 목록({@link #clean} 결과)
   * @param spec 표 모양
   * @param templateHasTable 템플릿에 이 표가 있었는가
   */
  public static void fixTable(List<String> lines, ReportTableSpec spec, boolean templateHasTable) {
    boolean[] fenced = fenced(lines);
    int t = findTable(lines, fenced, spec);
    if (t >= 0) {
      if (spec.headCells() != null) {
        lines.set(t, row(spec.headCells()));
        lines.set(t + 1, delimiter(spec.headCells().size()));
      }
      int bodyStart = t + 2;
      int bodyEnd = bodyStart;
      while (bodyEnd < lines.size()
          && !fenced[bodyEnd]
          && !lines.get(bodyEnd).isBlank()
          && lines.get(bodyEnd).contains("|")) {
        bodyEnd++;
      }
      List<List<String>> body =
          spec.keepAi() == null
              ? spec.body()
              : keepAiCells(spec, lines.subList(bodyStart, bodyEnd));
      lines.subList(bodyStart, bodyEnd).clear();
      lines.addAll(bodyStart, bodyRows(body));
      return;
    }
    if (!templateHasTable) return;

    // 절 처음에 넣는 표(WP-1632 「이번 주 한 일」) — 맞는 절이 있으면 제목 줄 바로 뒤(판단 문장 앞)에 머리·몸통만 넣는다.
    if (spec.insertIntoSection() != null) {
      int s = findSection(lines, fenced, spec.insertIntoSection());
      if (s >= 0) {
        insertBlock(lines, s + 1, String.join("\n", tableBlock(spec.headCells(), spec.body())));
        return;
      }
    }

    // 넣는 표의 머리 — 시스템 머리 칸 → 없으면(프로젝트) 「제목 | 이번 | 변화」 세 칸.
    List<String> head =
        spec.headCells() != null
            ? spec.headCells()
            : List.of(spec.insertSectionTitle(), "이번", "변화");
    List<String> block = new ArrayList<>();
    block.add("## " + spec.insertSectionTitle());
    block.add("");
    block.addAll(tableBlock(head, spec.body()));

    // 문서 끝에 넣는 표(참고 지표, WP-1629) — 끝 빈 줄을 걷고 빈 줄 하나로 띄워 붙인다.
    if (spec.insertAtEnd()) {
      while (!lines.isEmpty() && lines.get(lines.size() - 1).isBlank()) {
        lines.remove(lines.size() - 1);
      }
      if (!lines.isEmpty()) block.add(0, "");
      lines.addAll(block);
      return;
    }
    block.add("");

    int at;
    // 후보를 앞에서부터 찾는다 — 옛 템플릿 순서의 섹션이 있으면 그 자리를 지키고, 없으면 다음 후보(새 순서)로.
    int h = -1;
    for (String title : spec.insertAfterSections()) {
      h = findSection(lines, fenced, title);
      if (h >= 0) break;
    }
    if (h >= 0) {
      at = sectionEnd(lines, fenced, h);
    } else {
      // 섹션이 없으면 첫 문단(프로젝트는 보통 맨 앞에 넣은 배지 줄) 뒤.
      at = 0;
      while (at < lines.size() && lines.get(at).isBlank()) at++;
      while (at < lines.size() && !lines.get(at).isBlank()) at++;
    }
    if (at > 0 && !lines.get(at - 1).isBlank()) {
      block.add(0, "");
    }
    lines.addAll(at, block);
  }

  /**
   * AI 칸 살리기(WP-1632) — 옛 몸통 줄(AI 행)을 첫 칸 맞춤 열쇠({@link #matchKey})로 읽고, 시스템 행마다 맞는 AI 행의 지정 칸 글을 한
   * 줄로·상한까지 옮긴다. 맞는 AI 행이 없거나 칸이 비면 「—」. 건수 등 나머지 칸은 시스템 값 그대로다.
   *
   * <p>맞춤은 이름 순위별로 돈다(WP-1632 리뷰) — 모든 시스템 행을 첫 순위 이름(프로젝트 키)으로 먼저 맞춘 뒤, 남은 행을 다음 순위(이름)로 맞춘다. AI 행
   * 하나는 한 시스템 행에만 쓰고(위에서부터 순서대로 소비), 그래서 이름이 같은 두 프로젝트가 같은 AI 요약을 나눠 갖지 않고 서로 다른 AI 행을 받는다.
   */
  private static List<List<String>> keepAiCells(ReportTableSpec spec, List<String> aiRows) {
    List<List<String>> ai = new ArrayList<>();
    List<String> aiKeys = new ArrayList<>();
    for (String r : aiRows) {
      List<String> cs = cells(r);
      if (cs.isEmpty()) continue;
      ai.add(cs);
      aiKeys.add(matchKey(cs.get(0)));
    }
    boolean[] used = new boolean[ai.size()];
    ReportTableSpec.KeepAiColumns keep = spec.keepAi();
    int n = spec.body().size();
    List<List<String>> matched = new ArrayList<>(Collections.nCopies(n, null));
    int ranks = keep.rowKeys().stream().mapToInt(List::size).max().orElse(0);
    for (int rank = 0; rank < ranks; rank++) {
      for (int i = 0; i < n; i++) {
        if (matched.get(i) != null) continue;
        List<String> names = keep.rowKeys().get(i);
        if (rank >= names.size() || names.get(rank) == null || names.get(rank).isBlank()) continue;
        int a = take(aiKeys, used, matchKey(names.get(rank)));
        if (a >= 0) matched.set(i, ai.get(a));
      }
    }
    List<List<String>> out = new ArrayList<>(n);
    for (int i = 0; i < n; i++) {
      List<String> sys = new ArrayList<>(spec.body().get(i));
      List<String> row = matched.get(i);
      for (int c : keep.columns()) {
        if (c >= sys.size()) continue;
        String v = row != null && c < row.size() ? keptText(row.get(c), keep.maxLength()) : null;
        sys.set(c, v == null ? ReportNumbers.DASH : v);
      }
      out.add(List.copyOf(sys));
    }
    return out;
  }

  /** 아직 쓰지 않은 AI 행 중 열쇠가 같은 첫 행을 쓴 것으로 표시하고 그 번호를 돌려준다(없으면 -1). */
  private static int take(List<String> aiKeys, boolean[] used, String want) {
    for (int a = 0; a < aiKeys.size(); a++) {
      if (!used[a] && aiKeys.get(a).equals(want)) {
        used[a] = true;
        return a;
      }
    }
    return -1;
  }

  /** AI 칸 글 — 이스케이프를 풀고(다시 쓸 때 {@link #cell} 이 이스케이프한다) 한 줄로·상한까지. 비면 null. */
  private static String keptText(String raw, int max) {
    String v = ReportIssueDetails.oneLine(raw.replace("\\|", "|"));
    if (v == null || v.isEmpty()) return null;
    return ReportIssueDetails.cut(v, max);
  }

  /**
   * 행 맞춤 열쇠 — 링크는 글만 남기고 {@code *}·{@code _}·{@code `} 표시를 모두 지운 뒤 공백을 접어 소문자로. AI 가 이름을 꾸며 써도 맞추려는
   * 것이고, 시스템 이름에도 같은 규칙을 걸어 양쪽이 똑같이 바뀐다.
   */
  private static String matchKey(String s) {
    String v = MD_LINK.matcher(s.replace("\\|", "|")).replaceAll("$1");
    v = EMPHASIS_MARKS.matcher(v).replaceAll("").strip();
    return SPACES.matcher(v).replaceAll(" ").toLowerCase(Locale.ROOT);
  }

  /** 맞춤 열쇠용 링크(이미지 포함) {@code [글](주소)}: 1=글. */
  private static final Pattern MD_LINK = Pattern.compile("!?\\[([^\\]\\n]*)\\]\\([^)\\n]*\\)");

  /** 맞춤 열쇠에서 지우는 강조·코드 표시 글자. */
  private static final Pattern EMPHASIS_MARKS = Pattern.compile("[*_`]");

  /** 맞춤 열쇠에서 하나로 접는 공백 연속. */
  private static final Pattern SPACES = Pattern.compile("\\s+");

  /** 머리 줄·구분 줄·몸통 줄로 된 표 블록. */
  private static List<String> tableBlock(List<String> head, List<List<String>> body) {
    List<String> block = new ArrayList<>();
    block.add(row(head));
    block.add(delimiter(head.size()));
    block.addAll(bodyRows(body));
    return block;
  }

  /** 시스템 행 → 표 몸통 줄. */
  private static List<String> bodyRows(List<List<String>> rows) {
    return rows.stream().map(ReportMarkdown::row).toList();
  }

  /** 칸 값 → 표 한 줄 {@code | a | b |}. 칸 값의 「|」(버전 이름 등)는 칸 구분으로 읽히지 않게 {@code \|} 로 이스케이프한다. */
  private static String row(List<String> cells) {
    StringBuilder sb = new StringBuilder("|");
    for (String c : cells) sb.append(' ').append(cell(c)).append(" |");
    return sb.toString();
  }

  /** 칸 수만큼의 구분 줄 {@code |---|---|}. */
  private static String delimiter(int columns) {
    return "|" + "---|".repeat(columns);
  }

  /** 표 칸 값 — null 은 빈 칸, 「|」 는 이스케이프. */
  private static String cell(String v) {
    return v == null ? "" : v.replace("|", "\\|");
  }

  /**
   * 명세의 표 머리 줄 위치(없으면 -1). {@code insertIntoSection} 이 있으면(WP-1632 프로젝트 표) 제목이 그 판정을 통과하는 절들 안에서만
   * 찾는다 — 다른 절의 「프로젝트」 머리 표(사용자 표, AI 가 엉뚱한 절에 쓴 표)는 건드리지 않는다. 맞는 절이 없으면 표도 없다(-1) — 그러면 {@link
   * #fixTable} 이 넣기 경로로 간다. 절 범위는 제목 다음 줄부터 같거나 높은 단계의 다음 제목 앞까지(하위 ### 는 안에 든다).
   */
  private static int findTable(List<String> lines, boolean[] fenced, ReportTableSpec spec) {
    if (spec.insertIntoSection() == null) {
      return findTable(lines, fenced, spec.headFirstCell(), 0, lines.size());
    }
    Predicate<String> section = spec.insertIntoSection();
    for (int h = findSection(lines, fenced, section, 0);
        h >= 0;
        h = findSection(lines, fenced, section, h + 1)) {
      int t = findTable(lines, fenced, spec.headFirstCell(), h + 1, sectionEnd(lines, fenced, h));
      if (t >= 0) return t;
    }
    return -1;
  }

  /** 펜스 밖 첫 리포트 표의 머리 줄 위치(없으면 -1) — 머리 첫 칸(굵게·공백 제거)이 판정을 통과해야 한다. */
  private static int findTable(
      List<String> lines, boolean[] fenced, Predicate<String> headFirstCell) {
    return findTable(lines, fenced, headFirstCell, 0, lines.size());
  }

  /** [from, to) 안에서 머리·구분 줄이 모두 든 펜스 밖 첫 표의 머리 줄 위치(없으면 -1). */
  private static int findTable(
      List<String> lines, boolean[] fenced, Predicate<String> headFirstCell, int from, int to) {
    for (int i = from; i + 1 < to; i++) {
      if (fenced[i] || fenced[i + 1]) continue;
      String head = lines.get(i);
      String delim = lines.get(i + 1);
      if (!head.contains("|") || !delim.contains("|") || !DELIMITER.matcher(delim).matches()) {
        continue;
      }
      List<String> cells = cells(head);
      if (!cells.isEmpty() && headFirstCell.test(unemphasize(cells.get(0)))) {
        return i;
      }
    }
    return -1;
  }

  /** 표 한 줄의 칸 — 이스케이프된 {@code \|} 는 칸 구분이 아니다. 양 끝 「|」 바깥 빈 칸은 뺀다. */
  static List<String> cells(String row) {
    List<String> out = new ArrayList<>();
    StringBuilder cur = new StringBuilder();
    for (int i = 0; i < row.length(); i++) {
      char c = row.charAt(i);
      if (c == '\\' && i + 1 < row.length() && row.charAt(i + 1) == '|') {
        cur.append("\\|");
        i++;
      } else if (c == '|') {
        out.add(cur.toString());
        cur.setLength(0);
      } else {
        cur.append(c);
      }
    }
    out.add(cur.toString());
    if (row.strip().startsWith("|") && !out.isEmpty()) out.remove(0);
    if (row.strip().endsWith("|") && !row.strip().endsWith("\\|") && !out.isEmpty()) {
      out.remove(out.size() - 1);
    }
    return out;
  }

  // ───────────── ⑤ 링크 ─────────────

  /**
   * 펜스 밖 {@code [글](앱 이슈 주소)} 를 맨 주소로 — 글이 붙은 링크는 앱 링크 칩이 되지 않는다. 다른 링크·이미지는 그대로. 바꾼 주소 바로 뒤에
   * 글자(「에서」 등)가 붙어 있으면 한 칸 띄운다 — 붙어 있으면 자동 링크가 그 글자까지 주소로 삼켜 칩이 깨진다. 공백·ASCII 문장부호가 뒤따르면 그대로.
   */
  private static void bareIssueLinks(List<String> lines, String issueUrlPrefix) {
    if (issueUrlPrefix == null || issueUrlPrefix.isBlank()) return;
    Pattern issueUrl =
        Pattern.compile(Pattern.quote(issueUrlPrefix) + "(?:[A-Za-z][A-Za-z0-9_-]*/issues/)?\\d+");
    boolean[] fenced = fenced(lines);
    for (int i = 0; i < lines.size(); i++) {
      if (fenced[i] || !lines.get(i).contains("](")) continue;
      Matcher m = NAMED_LINK.matcher(lines.get(i));
      StringBuilder sb = new StringBuilder();
      while (m.find()) {
        String url = m.group(2);
        String replacement = m.group();
        if (issueUrl.matcher(url).matches()) {
          String line = lines.get(i);
          int next = m.end();
          boolean glued =
              next < line.length()
                  && !Character.isWhitespace(line.charAt(next))
                  && !isAsciiPunct(line.charAt(next));
          replacement = glued ? url + " " : url;
        }
        m.appendReplacement(sb, Matcher.quoteReplacement(replacement));
      }
      m.appendTail(sb);
      lines.set(i, sb.toString());
    }
  }

  /** ASCII 문장부호인가 — 주소 뒤에 와도 자동 링크가 주소로 삼키지 않는(또는 끝에서 떼는) 글자. */
  private static boolean isAsciiPunct(char c) {
    return c < 128 && !Character.isLetterOrDigit(c) && !Character.isWhitespace(c);
  }

  // ───────────── 공통 ─────────────

  /** 줄마다 펜스 줄 또는 펜스 안인가(WikiAiInstruction 과 같은 추적 규칙). 닫힘 없는 펜스는 끝까지 펜스 안. */
  static boolean[] fenced(List<String> lines) {
    boolean[] out = new boolean[lines.size()];
    char fenceChar = 0;
    int fenceLen = 0;
    for (int i = 0; i < lines.size(); i++) {
      String line = lines.get(i);
      Matcher prefix = PREFIX.matcher(line);
      prefix.find();
      String rest = line.substring(prefix.end());
      Matcher fence = FENCE_LINE.matcher(rest);
      if (fenceChar != 0) {
        out[i] = true;
        if (fence.matches()
            && fence.group(1).charAt(0) == fenceChar
            && fence.group(1).length() >= fenceLen
            && fence.group(2).isBlank()) {
          fenceChar = 0;
        }
      } else if (fence.matches()) {
        out[i] = true;
        fenceChar = fence.group(1).charAt(0);
        fenceLen = fence.group(1).length();
      }
    }
    return out;
  }

  /** 펜스 밖 첫 「{title}」 으로 시작하는 제목 줄 위치(없으면 -1). */
  private static int findSection(List<String> lines, boolean[] fenced, String title) {
    return findSection(lines, fenced, t -> t.startsWith(title));
  }

  /** 펜스 밖 첫 제목 줄 중 제목 글(굵게 뗀)이 판정을 통과하는 것의 위치(없으면 -1, WP-1632). */
  private static int findSection(List<String> lines, boolean[] fenced, Predicate<String> title) {
    return findSection(lines, fenced, title, 0);
  }

  /** {@code from} 줄부터 찾는 {@link #findSection(List, boolean[], Predicate)}. */
  private static int findSection(
      List<String> lines, boolean[] fenced, Predicate<String> title, int from) {
    for (int i = from; i < lines.size(); i++) {
      if (fenced[i]) continue;
      Matcher m = HEADING.matcher(lines.get(i));
      if (m.matches() && title.test(unemphasize(m.group(2)))) return i;
    }
    return -1;
  }

  /** 펜스 밖 첫 「{title}」 으로 시작하는 h2 제목 줄 위치(없으면 -1) — 새 모양의 「요약」·「일정」 절(WP-1629). */
  private static int findH2(List<String> lines, boolean[] fenced, String title) {
    for (int i = 0; i < lines.size(); i++) {
      if (fenced[i]) continue;
      Matcher m = HEADING.matcher(lines.get(i));
      if (m.matches() && m.group(1).length() == 2 && unemphasize(m.group(2)).startsWith(title)) {
        return i;
      }
    }
    return -1;
  }

  /** 제목 줄 {@code h} 의 섹션 끝 — 펜스 밖에서 같거나 높은 단계의 다음 제목 줄, 없으면 문서 끝. */
  private static int sectionEnd(List<String> lines, boolean[] fenced, int h) {
    Matcher hm = HEADING.matcher(lines.get(h));
    int level = hm.matches() ? hm.group(1).length() : 6;
    for (int i = h + 1; i < lines.size(); i++) {
      if (fenced[i]) continue;
      Matcher m = HEADING.matcher(lines.get(i));
      if (m.matches() && m.group(1).length() <= level) return i;
    }
    return lines.size();
  }

  /** 굵게·기울임 표시와 앞뒤 공백을 뗀다(머리 칸·제목 비교용). */
  private static String unemphasize(String s) {
    return s.replace("**", "").replace("__", "").strip();
  }

  /** [from, to) 범위의 글 문단 — 연속한 글 줄 묶음. 펜스·빈 줄·제목·표(「|」 시작)·HTML(「<」 시작)·가로줄은 글 줄이 아니며 문단을 끊는다. */
  private static List<List<String>> textParagraphs(
      List<String> lines, boolean[] fenced, int from, int to) {
    List<List<String>> out = new ArrayList<>();
    List<String> cur = null;
    for (int i = from; i < to; i++) {
      String s = lines.get(i);
      String t = s.strip();
      boolean text =
          !fenced[i]
              && !t.isEmpty()
              && !HEADING.matcher(s).matches()
              && !t.startsWith("|")
              && !t.startsWith("<")
              && !t.matches("([-*_])(?:[ \\t]*\\1){2,}");
      if (text) {
        if (cur == null) {
          cur = new ArrayList<>();
          out.add(cur);
        }
        cur.add(s);
      } else {
        cur = null;
      }
    }
    return out;
  }

  /** 문단을 마크다운 없는 한 줄로 — 이미지 제거, 링크는 글만, 굵게·취소선·코드 표시·목록/인용 표시 제거, 공백 접기, 200자 자르기. */
  private static String plainLine(List<String> paragraph) {
    List<String> parts = new ArrayList<>();
    for (String l : paragraph) {
      parts.add(l.replaceFirst("^[ \\t]*(?:>[ \\t]*)*(?:(?:[-*+]|\\d+[.)])[ \\t]+)?", ""));
    }
    String s = String.join(" ", parts);
    s = s.replaceAll("!\\[[^\\]]*\\]\\([^)]*\\)", "");
    s = s.replaceAll("\\[([^\\]]*)\\]\\([^)]*\\)", "$1");
    s = s.replace("**", "").replace("__", "").replace("~~", "").replace("`", "");
    s = s.replaceAll("\\s+", " ").strip();
    if (s.codePointCount(0, s.length()) > CARD_LINE_MAX) {
      s = s.substring(0, s.offsetByCodePoints(0, CARD_LINE_MAX - 1)) + "…";
    }
    return s.isEmpty() ? null : s;
  }

  /** 화면 낱말 → 배지 이름. */
  private static String badgeKey(String word) {
    for (var e : KO.entrySet()) {
      if (e.getValue().equals(word)) return e.getKey().name();
    }
    return null;
  }

  /** 줄을 잇고 앞 빈 줄을 떼며 끝은 줄바꿈 하나로 맞춘다 — 후처리의 마지막 단계(WP-1486 에서 공개). */
  public static String render(List<String> lines) {
    String s = String.join("\n", lines);
    s = s.replaceFirst("^(?:[ \\t]*\\n)+", "");
    s = s.stripTrailing();
    return s.isEmpty() ? "" : s + "\n";
  }
}
