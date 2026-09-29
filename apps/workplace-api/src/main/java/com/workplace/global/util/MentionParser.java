package com.workplace.global.util;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.function.LongFunction;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 메시지 본문에서 {@code <@{userId}>} 멘션 토큰을 추출한다. 중복은 첫 등장 순서를 유지한 채 제거. 토큰 유효성(존재하는 user) 검증은 서비스
 * 단(UserMentionHydrator)에서 수행한다. chat·messaging 공용.
 */
public final class MentionParser {
  private MentionParser() {}

  // 자릿수 상한(18)으로 bigint 범위를 넘는 토큰 차단 — Long.parseLong overflow(500) 방지.
  private static final Pattern P = Pattern.compile("<@(\\d{1,18})>");

  public static List<Long> parse(String body) {
    if (body == null || body.isEmpty()) return List.of();
    Matcher m = P.matcher(body);
    LinkedHashSet<Long> seen = new LinkedHashSet<>();
    while (m.find()) seen.add(Long.parseLong(m.group(1)));
    return new ArrayList<>(seen);
  }

  /**
   * 본문의 멘션 토큰을 replacer 가 돌려준 문자열로 치환한다. 토큰 패턴을 한 곳({@link #P})에서만 관리하기 위해 파싱과 같은 정규식을 쓴다 — 푸시
   * 미리보기(@이름 표시) 등 표시용 변환 공용. null/빈 본문은 빈 문자열.
   */
  public static String replace(String body, LongFunction<String> replacer) {
    if (body == null || body.isEmpty()) return "";
    Matcher m = P.matcher(body);
    StringBuilder sb = new StringBuilder();
    while (m.find()) {
      m.appendReplacement(sb, Matcher.quoteReplacement(replacer.apply(Long.parseLong(m.group(1)))));
    }
    m.appendTail(sb);
    return sb.toString();
  }
}
