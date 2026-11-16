package com.workplace.wiki.report;

import com.workplace.issue.report.ProjectReportEpics.ScheduledEpic;
import com.workplace.issue.report.ReportCadence;
import java.util.List;
import java.util.Optional;
import org.springframework.web.util.HtmlUtils;

/**
 * 리포트 「일정」 도표(WP-1629) — 기한을 정한 완료 에픽(이번 기간 위, 지난 기간 아래)마다 「완료일 − 기한」을 가로축 점으로 그린 html-embed 블록을
 * 만든다. 후처리({@link ReportMarkdown#finish})가 「{{일정 도표}}」 자리 줄을 이 블록으로 바꾼다.
 *
 * <p>노트는 html-embed 를 샌드박스 iframe 에 그리고, 노트 스크립트가 꺼져 있으면 높이 보고 없이 기본 400px 로 둔다 — 그래서 블록은 스크립트 없는
 * 자체 완결 문서(인라인 SVG)이고, 색은 CSS 변수 없이 리터럴, 툴팁은 SVG {@code <title>} 이다. 너비는 viewBox 640 고정 + {@code
 * width="100%"}(최대 640px)이고, 높이는 400px 이하로 맞춘다 — 10행까지는 행 28px, 그 뒤로는 행 높이를 줄이고(하한 18px, 16행), 그래도
 * 넘치면 지난 기간→이번 기간 순으로 오래된 행을 덜어 부제에 「외 N개」를 적는다.
 */
public final class ReportScheduleChart {

  /**
   * 도표 한 행의 재료 — 에픽 집계 밖에서(테스트 등) 행을 직접 만들 때 쓴다. 집계의 완료 에픽은 같은 {@link ScheduledEpic} 이라 옮겨 담지 않는다.
   *
   * @param title 에픽 제목(사람이 쓴 글 — 쓸 때 이스케이프)
   * @param dueDate 기한 M/d, 없으면 null(행에서 빠진다)
   * @param completedDate 완료일 M/d
   * @param lateDays 완료일 − 기한(양수 = 늦음), 기한 없으면 null(행에서 빠진다)
   */
  public record ChartRow(String title, String dueDate, String completedDate, Integer lateDays)
      implements ScheduledEpic {}

  /** 지연 색(주황) — 선·점·「+N일」 라벨. */
  static final String LATE_COLOR = "#c2410c";

  /** 정시·앞당김 색(회색). */
  static final String NORMAL_COLOR = "#6b7280";

  /** 테두리·이번/지난 구분선 색. */
  static final String LINE_COLOR = "#e5e7eb";

  /** 행 제목 최대 글자 수 — 넘으면 (최대 − 1)자 + 말줄임. */
  static final int TITLE_MAX = 18;

  private static final int WIDTH = 640;
  private static final int HEADER = 60;
  private static final int ROW_HEIGHT = 28;
  private static final int AXIS = 36;

  /** SVG 전체 높이 상한 — 노트가 스크립트 없이 iframe 을 400px 로 두므로 넘으면 잘린다(WP-1629). */
  static final int MAX_HEIGHT = 400;

  /** 행 높이 하한 — 이보다 좁아지면 행을 덜어낸다. */
  private static final int MIN_ROW_HEIGHT = 18;

  /** 행 높이가 이보다 좁으면 행 제목 글자를 한 단계 줄인다. */
  private static final int COMFORT_ROW_HEIGHT = 24;

  private static final int TITLE_X = 16;
  private static final int DUE_X = 262;
  private static final int CENTER_X = 430;
  private static final int HALF_WIDTH = 140;

  /** 축 범위의 최소 반폭(일) — 차이가 작아도 「3일 앞당김 / 기한일 / 3일 지연」 눈금을 둔다. */
  private static final int MIN_RANGE = 3;

  private static final String FONT =
      "-apple-system,BlinkMacSystemFont,'Segoe UI','Apple SD Gothic Neo','Noto Sans KR',"
          + "'Malgun Gothic',sans-serif";

  private ReportScheduleChart() {}

  /**
   * 도표 블록({@code ```html-embed} … {@code ```}, 끝 줄바꿈 없음). 기한·늦은 날수가 없는 행은 뺀다. 남는 행이 없으면 빈 값 — 후처리는
   * 자리 줄만 지운다.
   *
   * @param current 이번 기간 행(위, 순서 그대로 — 완료 시각 순)
   * @param previous 지난 기간 행(아래, 순서 그대로)
   * @param cadence 주기 — 부제의 「이번 주/지난주」 낱말
   */
  public static Optional<String> block(
      List<? extends ScheduledEpic> current,
      List<? extends ScheduledEpic> previous,
      ReportCadence cadence) {
    List<ScheduledEpic> now = withDue(current);
    List<ScheduledEpic> before = withDue(previous);
    if (now.isEmpty() && before.isEmpty()) return Optional.empty();

    // 축 반폭 = max(3, 가장 큰 |늦은 날수|) — 가장 먼 점이 축 끝에 닿는다.
    int range = MIN_RANGE;
    for (ScheduledEpic r : now) range = Math.max(range, Math.abs(r.lateDays()));
    for (ScheduledEpic r : before) range = Math.max(range, Math.abs(r.lateDays()));

    // 400px 안에 들도록 행 수를 정한다(WP-1629) — 행이 하한 높이로도 안 들어가면 지난 기간의 오래된 행부터, 그래도 넘치면 이번 기간의 오래된 행을
    // 덜어낸다.
    int capacity = (MAX_HEIGHT - HEADER - AXIS) / MIN_ROW_HEIGHT;
    int dropped = Math.max(0, now.size() + before.size() - capacity);
    if (dropped > 0) {
      int dropBefore = Math.min(dropped, before.size());
      before = before.subList(dropBefore, before.size());
      now = now.subList(dropped - dropBefore, now.size());
    }
    int rows = now.size() + before.size();
    // 행 높이 = 10행까지는 28, 그 뒤로는 남은 높이를 균등 분할(하한 18).
    int rowH = Math.min(ROW_HEIGHT, Math.max(MIN_ROW_HEIGHT, (MAX_HEIGHT - HEADER - AXIS) / rows));
    int rowsTop = HEADER;
    int rowsBottom = HEADER + rows * rowH;
    int height = rowsBottom + AXIS;

    StringBuilder svg = new StringBuilder();
    svg.append("<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 ")
        .append(WIDTH)
        .append(' ')
        .append(height)
        .append("\" width=\"100%\" role=\"img\" aria-label=\"완료일 − 기한\">\n");
    // 카드 배경·테두리.
    svg.append("<rect x=\"0.5\" y=\"0.5\" width=\"")
        .append(WIDTH - 1)
        .append("\" height=\"")
        .append(height - 1)
        .append("\" rx=\"8\" fill=\"#ffffff\" stroke=\"")
        .append(LINE_COLOR)
        .append("\"/>\n");
    // 카드 제목·부제.
    svg.append("<text x=\"")
        .append(TITLE_X)
        .append(
            "\" y=\"26\" font-size=\"13\" font-weight=\"600\" fill=\"#111827\">완료일 − 기한</text>\n");
    svg.append("<text x=\"")
        .append(TITLE_X)
        .append("\" y=\"44\" font-size=\"11\" fill=\"")
        .append(NORMAL_COLOR)
        .append("\">")
        .append(
            subtitle(now.size(), before.size(), cadence)
                + (dropped > 0 ? " · 외 " + dropped + "개" : ""))
        .append("</text>\n");

    // 축 끝 옅은 눈금선과 가운데 기한일 점선 — 행보다 먼저 그려 점·선이 위에 오게.
    int left = CENTER_X - HALF_WIDTH;
    int right = CENTER_X + HALF_WIDTH;
    for (int x : new int[] {left, right}) {
      svg.append(vline(x, rowsTop - 4, rowsBottom + 4, "#f3f4f6", null));
    }
    svg.append(vline(CENTER_X, rowsTop - 4, rowsBottom + 4, "#9ca3af", "3 3"));

    // 이번 기간과 지난 기간 사이 옅은 구분선 — 양쪽 다 있을 때만.
    if (!now.isEmpty() && !before.isEmpty()) {
      int y = rowsTop + now.size() * rowH;
      svg.append("<line x1=\"")
          .append(TITLE_X)
          .append("\" y1=\"")
          .append(y)
          .append("\" x2=\"")
          .append(WIDTH - TITLE_X)
          .append("\" y2=\"")
          .append(y)
          .append("\" stroke=\"")
          .append(LINE_COLOR)
          .append("\"/>\n");
    }

    int i = 0;
    for (ScheduledEpic r : now) svg.append(row(r, rowsTop + (i++) * rowH, range, rowH));
    for (ScheduledEpic r : before) svg.append(row(r, rowsTop + (i++) * rowH, range, rowH));

    // 눈금 라벨 「k일 앞당김 / 기한일 / k일 지연」.
    int labelY = rowsBottom + 22;
    svg.append(axisLabel(left, labelY, range + "일 앞당김"));
    svg.append(axisLabel(CENTER_X, labelY, "기한일"));
    svg.append(axisLabel(right, labelY, range + "일 지연"));
    svg.append("</svg>");

    String html =
        "<!doctype html><html><head><meta charset=\"utf-8\"><style>"
            + "html,body{margin:0;padding:0;background:#ffffff}"
            + "svg{display:block;width:100%;max-width:"
            + WIDTH
            + "px;height:auto;font-family:"
            + FONT
            + "}</style></head><body>\n"
            + svg
            + "\n</body></html>";
    return Optional.of("```html-embed\n" + html + "\n```");
  }

  /** 기한·늦은 날수가 있는 행만 — 기한 없는 에픽은 「완료일 − 기한」을 셀 수 없다. */
  private static List<ScheduledEpic> withDue(List<? extends ScheduledEpic> rows) {
    return rows.stream()
        .<ScheduledEpic>map(r -> r)
        .filter(r -> r.dueDate() != null && r.lateDays() != null)
        .toList();
  }

  /**
   * 부제 — 「기한을 정한 에픽 · 위 n개 이번 주, 아래 m개 지난주」. 한쪽이 0 이면 그쪽 문구와 위/아래 구분을 뺀다(예: 「기한을 정한 에픽 · n개 이번 주」).
   */
  private static String subtitle(int now, int before, ReportCadence cadence) {
    String head = "기한을 정한 에픽 · ";
    if (before == 0) return head + now + "개 " + cadence.currentWord();
    if (now == 0) return head + before + "개 " + cadence.previousWord();
    return head
        + "위 "
        + now
        + "개 "
        + cadence.currentWord()
        + ", 아래 "
        + before
        + "개 "
        + cadence.previousWord();
  }

  /** 한 행 — 툴팁 묶음 안에 보이지 않는 행 영역·제목·기한·선·점·(지연이면) 「+N일」. */
  private static String row(ScheduledEpic r, int top, int range, int rowH) {
    int late = r.lateDays();
    int cy = top + rowH / 2;
    // 행이 좁으면(24 미만) 제목·기한 글자를 한 단계 줄여 겹치지 않게.
    int titleFont = rowH < COMFORT_ROW_HEIGHT ? 11 : 12;
    int smallFont = rowH < COMFORT_ROW_HEIGHT ? 10 : 11;
    int x = (int) Math.round(CENTER_X + (double) late / range * HALF_WIDTH);
    String color = late > 0 ? LATE_COLOR : NORMAL_COLOR;
    StringBuilder g = new StringBuilder("<g>");
    g.append("<title>").append(escape(tooltip(r))).append("</title>");
    // 행 전체를 덮는 투명 영역 — 점이 아니라 행 어디에 올려도 툴팁이 뜨게.
    g.append("<rect x=\"0\" y=\"")
        .append(top)
        .append("\" width=\"")
        .append(WIDTH)
        .append("\" height=\"")
        .append(rowH)
        .append("\" fill=\"transparent\"/>");
    g.append("<text x=\"")
        .append(TITLE_X)
        .append("\" y=\"")
        .append(cy + 4)
        .append("\" font-size=\"")
        .append(titleFont)
        .append("\" fill=\"#111827\">")
        .append(escape(shorten(r.title())))
        .append("</text>");
    g.append("<text x=\"")
        .append(DUE_X)
        .append("\" y=\"")
        .append(cy + 4)
        .append("\" font-size=\"")
        .append(smallFont)
        .append("\" text-anchor=\"end\" fill=\"")
        .append(NORMAL_COLOR)
        .append("\">")
        .append(escape(r.dueDate()))
        .append("</text>");
    if (late != 0) {
      g.append("<line x1=\"")
          .append(CENTER_X)
          .append("\" y1=\"")
          .append(cy)
          .append("\" x2=\"")
          .append(x)
          .append("\" y2=\"")
          .append(cy)
          .append("\" stroke=\"")
          .append(color)
          .append("\" stroke-width=\"2\"/>");
    }
    g.append("<circle cx=\"")
        .append(x)
        .append("\" cy=\"")
        .append(cy)
        .append("\" r=\"4\" fill=\"")
        .append(color)
        .append("\"/>");
    if (late > 0) {
      g.append("<text x=\"")
          .append(x + 8)
          .append("\" y=\"")
          .append(cy + 4)
          .append("\" font-size=\"")
          .append(smallFont)
          .append("\" font-weight=\"600\" fill=\"")
          .append(LATE_COLOR)
          .append("\">+")
          .append(late)
          .append("일</text>");
    }
    return g.append("</g>\n").toString();
  }

  /** 툴팁 — 「{제목} — 기한 {M/d}, 완료 {M/d}, {N일 지연|N일 앞당김|기한일 완료}」(제목은 자르지 않음). */
  private static String tooltip(ScheduledEpic r) {
    int late = r.lateDays();
    String result = late > 0 ? late + "일 지연" : late < 0 ? (-late) + "일 앞당김" : "기한일 완료";
    return nz(r.title()) + " — 기한 " + r.dueDate() + ", 완료 " + nz(r.completedDate()) + ", " + result;
  }

  /** 세로선 하나(dash 가 있으면 점선). */
  private static String vline(int x, int y1, int y2, String color, String dash) {
    return "<line x1=\""
        + x
        + "\" y1=\""
        + y1
        + "\" x2=\""
        + x
        + "\" y2=\""
        + y2
        + "\" stroke=\""
        + color
        + "\""
        + (dash == null ? "" : " stroke-dasharray=\"" + dash + "\"")
        + "/>\n";
  }

  /** 축 아래 가운데 맞춤 눈금 라벨. */
  private static String axisLabel(int x, int y, String text) {
    return "<text x=\""
        + x
        + "\" y=\""
        + y
        + "\" font-size=\"11\" text-anchor=\"middle\" fill=\""
        + NORMAL_COLOR
        + "\">"
        + text
        + "</text>\n";
  }

  /** 제목이 {@link #TITLE_MAX} 자를 넘으면 (최대 − 1)자 + 「…」(코드 포인트 기준 — 이모지가 반쪽 나지 않게). */
  static String shorten(String title) {
    String s = nz(title);
    if (s.codePointCount(0, s.length()) <= TITLE_MAX) return s;
    return s.substring(0, s.offsetByCodePoints(0, TITLE_MAX - 1)) + "…";
  }

  /** HTML 이스케이프({@code & < > " '}) — 사람이 쓴 제목이 SVG·HTML 을 깨거나 요소를 만들지 못하게. */
  static String escape(String s) {
    return HtmlUtils.htmlEscape(nz(s), "UTF-8");
  }

  private static String nz(String s) {
    return s == null ? "" : s;
  }
}
