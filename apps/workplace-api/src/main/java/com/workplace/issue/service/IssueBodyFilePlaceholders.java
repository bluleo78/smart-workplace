package com.workplace.issue.service;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 이슈 본문·댓글의 스테이징 파일 자리표시 파서(WP-1634) — {@code ![설명](file:123)}·{@code [이름](file:123)} 처럼 마크다운
 * 이미지·링크 대상이 정확히 {@code file:<숫자>} 인 곳을 찾는다.
 *
 * <p>왜 따로 두나: MCP(외부 AI)는 바이트를 본문에 넣을 수 없어 upload_file 로 올린 fileId 를 자리표시로 적고, 저장 때 서버가 그 자리를 실제
 * 주소로 바꾼다({@link IssueBodyImageService#resolveStagedPlaceholders}). 코드 블록·인라인 코드 안의 자리표시는 예시로 쓴 글이라
 * 건드리지 않는다.
 *
 * <p>코드 판정 범위(테스트로 고정): 펜스 코드 블록(``` 또는 ~~~, 3개 이상, 앞 공백 3칸까지 — 닫는 펜스는 같은 문자·같거나 긴 길이)과 한 줄 안의 인라인
 * 코드(같은 길이의 백틱 묶음 사이). 들여쓰기 코드 블록·여러 줄에 걸친 인라인 코드는 코드로 보지 않는다 — MCP 가 쓰는 본문에서 드물고, 잘못 보면 자리표시가 남아
 * 화면에 「file:」 링크로 보일 뿐 데이터가 상하지 않는다.
 */
final class IssueBodyFilePlaceholders {

  private IssueBodyFilePlaceholders() {}

  /** 빠른 거르기 표식 — 자리표시가 없는 본문(웹 편집기 저장 등 대부분)은 정규식·코드 판정 없이 돌려보낸다. */
  private static final String MARKER = "](file:";

  /**
   * 자리표시 패턴. group(1)=이미지 표시 "!"(링크 꼴이면 빈 문자열), group(2)=설명, group(3)=fileId. \d{1,19} 는 Long 자릿수 —
   * 그보다 길면 자리표시로 보지 않는다(본문 그대로). 설명에는 줄바꿈·닫는 대괄호를 받지 않는다(중첩 대괄호 미지원).
   */
  private static final Pattern PLACEHOLDER =
      Pattern.compile("(!?)\\[([^\\]\\n]*)\\]\\(file:(\\d{1,19})\\)");

  /** 펜스 코드 블록 여닫는 줄 — 앞 공백 3칸까지 + 같은 문자 3개 이상. */
  private static final Pattern FENCE = Pattern.compile("^ {0,3}(`{3,}|~{3,})");

  /**
   * 찾은 자리표시 한 곳.
   *
   * @param start 본문에서 시작 위치(포함)
   * @param end 끝 위치(제외)
   * @param alt 대괄호 안 설명
   * @param rawId 숫자 문자열 — Long 범위를 넘을 수 있어 해석은 호출자가 한다
   */
  record Placeholder(int start, int end, String alt, String rawId) {}

  /** 본문에서 코드 밖의 자리표시를 앞에서부터 찾는다. 없으면 빈 목록. */
  static List<Placeholder> find(String body) {
    if (body == null || !body.contains(MARKER)) return List.of();
    boolean[] code = codeMask(body);
    List<Placeholder> out = new ArrayList<>();
    Matcher m = PLACEHOLDER.matcher(body);
    while (m.find()) {
      if (code[m.start()]) continue;
      out.add(new Placeholder(m.start(), m.end(), m.group(2), m.group(3)));
    }
    return out;
  }

  /** 본문 각 위치가 코드(펜스 블록·인라인 코드) 안인지 표시한다. */
  private static boolean[] codeMask(String body) {
    boolean[] code = new boolean[body.length()];
    char fenceChar = 0;
    int fenceLen = 0;
    int lineStart = 0;
    while (lineStart < body.length()) {
      int nl = body.indexOf('\n', lineStart);
      int lineEnd = nl < 0 ? body.length() : nl;
      String line = body.substring(lineStart, lineEnd);
      Matcher f = FENCE.matcher(line);
      if (fenceChar != 0) {
        // 펜스 안 — 닫는 펜스 줄까지 모두 코드. 닫는 펜스는 같은 문자·같거나 긴 길이이고 뒤에 공백만 온다.
        markRange(code, lineStart, lineEnd);
        if (f.find()
            && f.group(1).charAt(0) == fenceChar
            && f.group(1).length() >= fenceLen
            && line.substring(f.end()).isBlank()) {
          fenceChar = 0;
        }
      } else if (f.find()) {
        fenceChar = f.group(1).charAt(0);
        fenceLen = f.group(1).length();
        markRange(code, lineStart, lineEnd);
      } else {
        markInlineCode(code, line, lineStart);
      }
      lineStart = lineEnd + 1;
    }
    return code;
  }

  /** 한 줄 안의 인라인 코드 — 백틱 n개 묶음과 다음의 같은 길이 묶음 사이. 짝이 없는 백틱은 글자 그대로다. */
  private static void markInlineCode(boolean[] code, String line, int offset) {
    int i = 0;
    while (i < line.length()) {
      if (line.charAt(i) != '`') {
        i++;
        continue;
      }
      int runEnd = runEnd(line, i);
      int len = runEnd - i;
      int close = findRun(line, runEnd, len);
      if (close < 0) {
        i = runEnd;
        continue;
      }
      markRange(code, offset + i, offset + close + len);
      i = close + len;
    }
  }

  /** from 부터 정확히 len 개의 백틱 묶음이 처음 나오는 위치, 없으면 -1. */
  private static int findRun(String line, int from, int len) {
    int i = from;
    while (i < line.length()) {
      if (line.charAt(i) != '`') {
        i++;
        continue;
      }
      int end = runEnd(line, i);
      if (end - i == len) return i;
      i = end;
    }
    return -1;
  }

  private static int runEnd(String line, int start) {
    int i = start;
    while (i < line.length() && line.charAt(i) == '`') i++;
    return i;
  }

  private static void markRange(boolean[] code, int from, int to) {
    for (int i = from; i < to && i < code.length; i++) code[i] = true;
  }
}
