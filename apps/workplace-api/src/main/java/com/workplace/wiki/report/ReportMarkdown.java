package com.workplace.wiki.report;

import com.workplace.issue.overview.status.StatusBadge;
import com.workplace.issue.report.ProjectReportFacts;
import com.workplace.issue.report.ReportTableRow;
import com.workplace.wiki.service.WikiAiInstruction;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
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
  static final String STATUS_SECTION = "상태와 한 줄";

  /** 리포트 표의 머리 첫 칸 접두이자 넣을 때의 섹션 제목. */
  static final String TABLE_HEAD = "지난 리포트 이후";

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
   * @param aiMarkdown AI 가 쓴 마크다운(null 이면 빈 글)
   * @param facts 계산값(배지·표 행)
   * @param templateHasTable 템플릿에 리포트 표가 있었는가 — 결과에 표가 없을 때 넣을지 정한다(팀이 뺐으면 넣지 않는다)
   * @param issueUrlPrefix 앱 이슈 주소 접두 — {@code {base}/projects/} 또는 {@code
   *     {base}/projects/{KEY}/issues/}. 이 접두 뒤가 {@code KEY/issues/n} 또는 {@code n} 인 링크만 맨 주소로 바꾼다.
   *     비어 있으면 링크를 건드리지 않는다
   */
  public static String finish(
      String aiMarkdown,
      ProjectReportFacts facts,
      boolean templateHasTable,
      String issueUrlPrefix) {
    String stripped = WikiAiInstruction.strip(aiMarkdown == null ? "" : aiMarkdown);
    List<String> lines =
        new ArrayList<>(Arrays.asList(stripped.replace("\r\n", "\n").split("\n", -1)));
    removeLeadingH1(lines);
    fixBadge(lines, facts.badge(), facts.previousBadge());
    fixTable(lines, facts.rows(), templateHasTable);
    bareIssueLinks(lines, issueUrlPrefix);
    return join(lines);
  }

  /** 펜스 밖에 「지난 리포트 이후」 로 시작하는 머리의 표가 있는가 — 템플릿에 표가 있었는지 볼 때 쓴다. */
  public static boolean hasReportTable(String markdown) {
    if (markdown == null) return false;
    List<String> lines = Arrays.asList(markdown.replace("\r\n", "\n").split("\n", -1));
    return findTable(lines, fenced(lines)) >= 0;
  }

  /**
   * 카드용 읽기 — 「상태와 한 줄」 섹션(없으면 문서 전체)의 첫 글 문단에 굵은 배지가 있으면 그 배지와, 같은 문단의 배지 뒤 글(없으면 다음 글 문단)을, 아니면 배지
   * null 과 그 문단을 한 줄로.
   */
  public static CardSummary cardSummary(String markdown) {
    if (markdown == null) return new CardSummary(null, null);
    List<String> lines = Arrays.asList(markdown.replace("\r\n", "\n").split("\n", -1));
    boolean[] fenced = fenced(lines);
    int from = 0;
    int to = lines.size();
    int h = findSection(lines, fenced);
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
    int h = findSection(lines, fenced);
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

  // ───────────── ④ 표 ─────────────

  /**
   * 리포트 표 몸통을 시스템 행만으로 다시 쓴다 — 머리·구분 줄은 그대로, AI 가 뺀 행은 다시 넣고 모르는 행은 버린다. 표가 없고 템플릿에 있었으면 「지난 리포트
   * 이후」 제목과 표를 「상태와 한 줄」 섹션 뒤(섹션이 없으면 첫 문단 뒤)에 넣는다.
   */
  private static void fixTable(
      List<String> lines, List<ReportTableRow> rows, boolean templateHasTable) {
    boolean[] fenced = fenced(lines);
    int t = findTable(lines, fenced);
    if (t >= 0) {
      int bodyStart = t + 2;
      int bodyEnd = bodyStart;
      while (bodyEnd < lines.size()
          && !fenced[bodyEnd]
          && !lines.get(bodyEnd).isBlank()
          && lines.get(bodyEnd).contains("|")) {
        bodyEnd++;
      }
      lines.subList(bodyStart, bodyEnd).clear();
      lines.addAll(bodyStart, bodyRows(rows));
      return;
    }
    if (!templateHasTable) return;

    List<String> block = new ArrayList<>();
    block.add("## " + TABLE_HEAD);
    block.add("");
    block.add("| " + TABLE_HEAD + " | 이번 | 변화 |");
    block.add("|---|---|---|");
    block.addAll(bodyRows(rows));
    block.add("");

    int at;
    int h = findSection(lines, fenced);
    if (h >= 0) {
      at = sectionEnd(lines, fenced, h);
    } else {
      // 섹션이 없으면 첫 문단(보통 맨 앞에 넣은 배지 줄) 뒤.
      at = 0;
      while (at < lines.size() && lines.get(at).isBlank()) at++;
      while (at < lines.size() && !lines.get(at).isBlank()) at++;
    }
    if (at > 0 && !lines.get(at - 1).isBlank()) {
      block.add(0, "");
    }
    lines.addAll(at, block);
  }

  /** 시스템 행 → 표 몸통 줄. 칸 값의 「|」(버전 이름 등)는 칸 구분으로 읽히지 않게 {@code \|} 로 이스케이프한다. */
  private static List<String> bodyRows(List<ReportTableRow> rows) {
    return rows.stream()
        .map(
            r ->
                "| "
                    + cell(r.label())
                    + " | "
                    + cell(r.current())
                    + " | "
                    + cell(r.change())
                    + " |")
        .toList();
  }

  /** 표 칸 값 — null 은 빈 칸, 「|」 는 이스케이프. */
  private static String cell(String v) {
    return v == null ? "" : v.replace("|", "\\|");
  }

  /** 펜스 밖 첫 리포트 표의 머리 줄 위치(없으면 -1) — 머리 첫 칸(굵게·공백 제거)이 「지난 리포트 이후」 로 시작해야 한다. */
  private static int findTable(List<String> lines, boolean[] fenced) {
    for (int i = 0; i + 1 < lines.size(); i++) {
      if (fenced[i] || fenced[i + 1]) continue;
      String head = lines.get(i);
      String delim = lines.get(i + 1);
      if (!head.contains("|") || !delim.contains("|") || !DELIMITER.matcher(delim).matches()) {
        continue;
      }
      List<String> cells = cells(head);
      if (!cells.isEmpty() && unemphasize(cells.get(0)).startsWith(TABLE_HEAD)) {
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

  /** 펜스 밖 첫 「상태와 한 줄」 제목 줄 위치(없으면 -1). */
  private static int findSection(List<String> lines, boolean[] fenced) {
    for (int i = 0; i < lines.size(); i++) {
      if (fenced[i]) continue;
      Matcher m = HEADING.matcher(lines.get(i));
      if (m.matches() && unemphasize(m.group(2)).startsWith(STATUS_SECTION)) return i;
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

  /** 줄을 잇고 앞 빈 줄을 떼며 끝은 줄바꿈 하나로 맞춘다. */
  private static String join(List<String> lines) {
    String s = String.join("\n", lines);
    s = s.replaceFirst("^(?:[ \\t]*\\n)+", "");
    s = s.stripTrailing();
    return s.isEmpty() ? "" : s + "\n";
  }
}
