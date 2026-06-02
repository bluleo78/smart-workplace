package com.workplace.global.util;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
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
}
