package com.workplace.global.util;

import java.util.List;
import java.util.regex.MatchResult;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 자유 텍스트에서 비밀값(토큰·키·이메일)을 가리고 공백을 정리해 길이를 제한한다. 도움말 지표처럼 사용자가 입력한 질문을 저장하기 전에 쓴다 — 실수로 붙여 넣은 토큰이 DB
 * 에 남지 않게 하려는 것이다(WP-1512).
 */
public final class SecretTextMasker {

  /** 결과의 최대 길이(코드포인트). */
  public static final int MAX_CODE_POINTS = 200;

  /** 비밀값 자리에 대신 넣는 표시. */
  public static final String MASK = "[가림]";

  /** 정규식 비용을 묶기 위해 가리기 전에 먼저 자르는 입력 길이(코드포인트). */
  private static final int PRE_TRIM_CODE_POINTS = 2000;

  /** 연속 공백 — 한 칸으로 합친다. */
  private static final Pattern WHITESPACE = Pattern.compile("\\s+");

  /**
   * Bearer 값 — "Bearer" 단어까지 통째로 가린다. 값에 숫자가 있을 때만 토큰으로 본다 — "bearer token 발급" 같은 평범한 검색어까지 가려 관리자가
   * 읽을 수 없게 되는 것을 막는다(실제 토큰은 거의 늘 숫자를 품는다).
   */
  private static final Pattern BEARER =
      Pattern.compile("(?i)\\bBearer\\s+(?=[A-Za-z._~+/=-]*\\d)[A-Za-z0-9._~+/=-]+");

  /** 알려진 접두 토큰(Anthropic·GitHub·Slack·AWS) — 접두가 분명해 짧아도 확실히 가린다. */
  private static final List<Pattern> PREFIXED =
      List.of(
          Pattern.compile("\\bsk-[A-Za-z0-9_-]{16,}"),
          Pattern.compile("\\bgh[pousr]_[A-Za-z0-9]{20,}"),
          Pattern.compile("\\bgithub_pat_[A-Za-z0-9_]{20,}"),
          Pattern.compile("\\bxox[abposr]-[A-Za-z0-9-]{10,}"),
          Pattern.compile("\\bAKIA[0-9A-Z]{16}\\b"));

  /** JWT 꼴 — base64url 세 마디(각 10자 이상)를 점으로 이은 것. */
  private static final Pattern JWT =
      Pattern.compile("[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}");

  /** 이메일 주소 — 개인 식별 정보라 가린다. 긴 덩어리 규칙보다 먼저 적용한다. */
  private static final Pattern EMAIL =
      Pattern.compile("[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}");

  /** 긴 영숫자 덩어리 후보 — 하이픈은 빼서 경로·슬러그 꼴(docs-manual-...)이 한 덩어리로 잡히지 않게 한다. */
  private static final Pattern LONG_RUN = Pattern.compile("[A-Za-z0-9+/_=]{24,}");

  private SecretTextMasker() {}

  /**
   * 입력을 정리하고 비밀값을 가린다. null·공백뿐이면 빈 문자열. 순서: 공백 합침·양끝 제거 → 앞 2000 코드포인트만 취함(잘렸으면 마지막 낱말 버림) → 패턴별
   * 가리기 → 200 코드포인트로 자름. 가리기를 자르기보다 먼저 해서, 경계에 걸친 토큰이 반쪽으로 잘려 남지 않게 한다.
   */
  public static String mask(String s) {
    if (s == null || s.isBlank()) return "";
    // 공백을 먼저 합친 뒤 자른다 — 앞을 공백으로 채운 긴 입력이 합쳐진 뒤 200자 안으로 줄어, 앞 자르기에 반쪽 난 토큰이 가리기 규칙(최소
    // 길이)을 비껴 남는 일을 막는다. 공백 합치기는 선형이라 자르기 전에 해도 비용이 묶인다.
    String collapsed = WHITESPACE.matcher(s).replaceAll(" ").strip();
    String out = Texts.headCodePoints(collapsed, PRE_TRIM_CODE_POINTS);
    if (out.length() < collapsed.length()) {
      // 잘렸으면 경계에 걸린 마지막 낱말(반쪽 토큰일 수 있음)을 버린다.
      int sp = out.lastIndexOf(' ');
      if (sp > 0) out = out.substring(0, sp);
    }
    out = BEARER.matcher(out).replaceAll(MASK);
    for (Pattern p : PREFIXED) {
      out = p.matcher(out).replaceAll(MASK);
    }
    out = JWT.matcher(out).replaceAll(MASK);
    out = EMAIL.matcher(out).replaceAll(MASK);
    out = LONG_RUN.matcher(out).replaceAll(SecretTextMasker::maskLongRun);
    return Texts.headCodePoints(out, MAX_CODE_POINTS);
  }

  /**
   * 긴 덩어리가 비밀값처럼 보일 때만 가린다 — 24자 이상이면서 대문자·소문자·숫자를 모두 가졌거나, 32자 이상이면서 영문과 숫자를 가진 경우. 숫자 없는 긴 영단어나
   * 평범한 식별자는 남긴다.
   */
  private static String maskLongRun(MatchResult m) {
    String run = m.group();
    boolean upper = false;
    boolean lower = false;
    boolean digit = false;
    for (int i = 0; i < run.length(); i++) {
      char c = run.charAt(i);
      if (c >= 'A' && c <= 'Z') upper = true;
      else if (c >= 'a' && c <= 'z') lower = true;
      else if (c >= '0' && c <= '9') digit = true;
    }
    boolean letter = upper || lower;
    boolean secret = (upper && lower && digit) || (run.length() >= 32 && letter && digit);
    return secret ? MASK : Matcher.quoteReplacement(run);
  }
}
