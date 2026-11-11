package com.workplace.wiki.service;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 노트 마크다운에서 「AI 지시 상자」({@code <div class="wp-ai-instruction">…</div>} 형태의 HTML 상자)를 지운다(WP-1482).
 * 지시 상자는 노트 작성자가 AI 에게 남기는 안내라 결과물에 실리면 안 된다 — 리포트 생성기(WP-1483)가 템플릿 결과에서 지시를 지울 때 쓴다.
 *
 * <p>줄 단위로 한 번 훑는다(입력 길이에 선형). 규칙:
 *
 * <ul>
 *   <li>컨테이너 접두: 모든 줄 앞의 인용 표시({@code >} 여러 겹)와 들여쓰기를 뗀 뒤를 본문으로 본다. 목록 항목 안(들여쓰기)·인용 안의 상자도 인식하며,
 *       지울 때는 그 줄을 접두째 통째로 지운다.
 *   <li>펜스 코드 블록({@code ```}·{@code ~~~}) 안은 그대로 둔다 — 코드로 적어 둔 예시 글자를 지우지 않는다. 지우는 중에도 펜스를 따라가며, 펜스
 *       안의 {@code <div>}·{@code </div>} 줄은 깊이에 세지 않는다.
 *   <li>시작: 펜스 밖에서 줄이 허용 태그(웹 {@code WIKI_HTML_BOX_TAGS} 와 같은 목록)의 여는 태그 하나뿐이고 class 토큰에 {@code
 *       wp-ai-instruction} 이 있는 줄. 속성 순서는 상관없고 작은따옴표·따옴표 안의 {@code >} 도 인식한다. 여는 태그 뒤에 같은 이름의 닫는
 *       태그가 줄 끝에 붙은 한 줄 상자({@code <div class="wp-ai-instruction">지시</div>})는 그 한 줄만 지운다.
 *   <li>끝: 같은 이름의 여는 줄은 깊이 +1, 줄 끝(뒤 공백 허용)이 {@code </tag>} 인 줄(글자 뒤에 붙은 {@code 지시</div>} 포함)은 -1 —
 *       0 이 되는 줄까지 지운다. 다른 이름의 태그는 세지 않는다. 닫는 태그가 정말 없으면 끝까지 지운다(편집기도 닫힘 없는 상자를 끝까지 상자 안으로 읽기 때문).
 *   <li>빈 줄 접기는 지운 자리 이음매에서만 한다: 지운 블록 바로 앞뒤의 빈 줄이 합쳐 둘 이상이면 하나로, 문서 맨 앞이면 없앤다. 다른 곳(펜스 안 포함)의 빈 줄은
 *       그대로 둔다. 지운 게 없으면 입력 그대로(같은 문자열).
 * </ul>
 */
public final class WikiAiInstruction {

  /** 지시 상자를 식별하는 class 토큰. */
  private static final String CLASS_TOKEN = "wp-ai-instruction";

  /** 허용 태그 — packages/wiki-editor-schema/src/htmlSanitize.ts 의 WIKI_HTML_BOX_TAGS 와 같아야 한다. */
  static final String TAGS = "div|section|article|header|footer|aside|main|nav|figure|figcaption";

  /** 줄 앞 컨테이너 접두(인용 표시 여러 겹 + 들여쓰기). 1=접두. */
  private static final Pattern PREFIX = Pattern.compile("^((?:[ \\t]*>)*[ \\t]*)");

  /** 따옴표를 아는 속성 목록을 가진 여는 태그로 시작하는 줄: 1=태그 이름, 2=속성 문자열, 3=태그 뒤 나머지. */
  private static final Pattern OPEN_ANY =
      Pattern.compile(
          "^<("
              + TAGS
              + ")((?:\\s++[^\\s=>/]++(?:\\s*=\\s*(?:\"[^\"]*\"|'[^']*'|[^\\s\"'>]++))?)*+)\\s*>(.*)$",
          Pattern.CASE_INSENSITIVE);

  /** class 값 안의 지시 토큰(앞뒤가 공백이거나 값 끝). */
  private static final Pattern INSTRUCTION_TOKEN =
      Pattern.compile("(?:^|\\s)" + CLASS_TOKEN + "(?:\\s|$)");

  /** 줄 끝(뒤 공백 허용)에 붙은 닫는 태그: 1=태그 이름. */
  private static final Pattern CLOSE_AT_END =
      Pattern.compile("</(" + TAGS + ")\\s*>\\s*$", Pattern.CASE_INSENSITIVE);

  /** 속성 문자열 안의 class 값: 1=큰따옴표 값, 2=작은따옴표 값. */
  private static final Pattern CLASS_ATTR =
      Pattern.compile(
          "(?:^|\\s)class\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)')", Pattern.CASE_INSENSITIVE);

  /** 펜스 시작·끝 후보 줄(접두를 뗀 뒤): 1=펜스 글자 연속, 2=뒤 글자. */
  private static final Pattern FENCE_LINE = Pattern.compile("^(`{3,}|~{3,})(.*)$");

  private WikiAiInstruction() {}

  /** 지시 상자를 지운 마크다운. null 이면 null, 지울 상자가 없으면 입력 그대로. */
  public static String strip(String markdown) {
    if (markdown == null || !markdown.contains(CLASS_TOKEN)) {
      return markdown;
    }
    String[] lines = markdown.split("\n", -1);
    List<String> kept = new ArrayList<>(lines.length);
    boolean removed = false;
    char fenceChar = 0;
    int fenceLen = 0;
    String boxTag = null; // 지우는 중인 상자의 태그 이름(소문자), 아니면 null
    int depth = 0;
    int seam = -1; // 지운 이음매에서 모으는 빈 줄 수(앞 + 뒤). -1 이면 이음매 아님

    for (String line : lines) {
      Matcher prefix = PREFIX.matcher(line);
      prefix.find();
      String rest = line.substring(prefix.end());

      // 펜스 추적 — 상자 안·밖 모두 같은 규칙(펜스 안 글자는 태그로 세지 않는다)
      Matcher fence = FENCE_LINE.matcher(rest);
      boolean fenceCandidate = rest.startsWith("`") || rest.startsWith("~");
      boolean htmlCandidate = rest.startsWith("<");
      boolean inFence = fenceChar != 0;
      boolean fenceLineNow = false;
      if (inFence) {
        // 같은 글자·같거나 긴 길이·뒤에 글자 없는 줄이 닫는 펜스
        if (fenceCandidate
            && fence.matches()
            && fence.group(1).charAt(0) == fenceChar
            && fence.group(1).length() >= fenceLen
            && fence.group(2).isBlank()) {
          fenceChar = 0;
        }
        fenceLineNow = true;
      } else if (fenceCandidate && fence.matches()) {
        fenceChar = fence.group(1).charAt(0);
        fenceLen = fence.group(1).length();
        fenceLineNow = true;
      }

      if (boxTag != null) {
        // 지우는 중: 펜스 줄·펜스 안 줄은 깊이에 세지 않고 지운다
        if (!fenceLineNow) {
          Matcher open = OPEN_ANY.matcher(rest);
          if (htmlCandidate && open.matches() && open.group(1).equalsIgnoreCase(boxTag)) {
            if (!closesSameTagAtEnd(open.group(3), boxTag)) {
              depth++;
            }
          } else if (closesSameTagAtEnd(rest, boxTag)) {
            depth--;
          }
          if (depth == 0) {
            boxTag = null;
          }
        }
        continue;
      }

      if (!fenceLineNow) {
        Matcher open = OPEN_ANY.matcher(rest);
        if (htmlCandidate && open.matches() && hasInstructionClass(open.group(2))) {
          String tag = open.group(1).toLowerCase();
          boolean oneLine = closesSameTagAtEnd(open.group(3), tag);
          if (oneLine || open.group(3).isBlank()) {
            // 이음매 시작: 바로 앞 빈 줄을 거두어 이음매 빈 줄 수에 합친다(이미 이음매면 이어 모은다)
            if (seam < 0) {
              seam = 0;
              while (!kept.isEmpty() && kept.get(kept.size() - 1).isBlank()) {
                kept.remove(kept.size() - 1);
                seam++;
              }
            }
            removed = true;
            if (!oneLine) {
              boxTag = tag;
              depth = 1;
            }
            continue;
          }
        }
      }

      if (seam >= 0) {
        if (line.isBlank()) {
          seam++;
          continue;
        }
        flushSeam(kept, seam);
        seam = -1;
      }
      kept.add(line);
    }
    if (!removed) {
      return markdown;
    }
    if (seam >= 0) {
      flushSeam(kept, seam);
    }
    return String.join("\n", kept);
  }

  /** 이음매에 모은 빈 줄 처리: 문서 맨 앞이면 없애고, 하나면 그대로, 둘 이상이면 하나로 접는다. */
  private static void flushSeam(List<String> kept, int blanks) {
    if (!kept.isEmpty() && blanks >= 1) {
      kept.add("");
    }
  }

  /** 글자가 줄 끝에서 {@code boxTag} 와 같은 이름의 닫는 태그로 끝나는가. */
  private static boolean closesSameTagAtEnd(String text, String boxTag) {
    Matcher close = CLOSE_AT_END.matcher(text);
    return close.find() && close.group(1).equalsIgnoreCase(boxTag);
  }

  /** 속성 문자열의 class 값에 지시 상자 토큰이 있는가(공백 경계 토큰 단위 비교). */
  private static boolean hasInstructionClass(String attrs) {
    Matcher m = CLASS_ATTR.matcher(attrs);
    while (m.find()) {
      String value = m.group(1) != null ? m.group(1) : m.group(2);
      if (INSTRUCTION_TOKEN.matcher(value).find()) {
        return true;
      }
    }
    return false;
  }
}
