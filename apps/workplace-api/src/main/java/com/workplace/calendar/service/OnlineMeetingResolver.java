package com.workplace.calendar.service;

import com.workplace.calendar.dto.OnlineMeeting;
import java.net.URI;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 일정의 온라인 회의 참가 정보 판정(WP-710) — 목록·상세·MCP 가 같은 답을 내도록 서버의 한 곳에서만 판정하는 순수 함수 모음.
 *
 * <p>우선순위: ① 동기화 때 저장한 참가 주소(M365 {@code onlineMeeting.joinUrl}) ② 설명에서 처음 나온 회의 링크 ③ 장소에서 처음 나온 회의
 * 링크. 회의 링크 판정은 주소 모양만 본다 — Teams({@code teams.microsoft.com/l/meetup-join/…}, {@code
 * teams.microsoft.com/meet/…}, {@code teams.live.com/meet/…}), Google Meet({@code
 * meet.google.com/xxx-xxxx-xxx}), Zoom({@code *.zoom.us/j/…}, {@code *.zoom.us/my/…}). 일반 웹 링크는 회의로
 * 취급하지 않는다. 링크는 http(s) 만 허용해 {@code javascript:} 같은 스킴이 버튼으로 새지 않는다.
 */
public final class OnlineMeetingResolver {

  private OnlineMeetingResolver() {}

  // http(s) URL 후보 — 공백·꺾쇠·따옴표·한글에서 끊는다(프론트 splitTextLinks 와 같은 경계). 문장 끝 구두점은 trimEnd 에서 뗀다.
  private static final Pattern URL =
      Pattern.compile("https?://[^\\s<>\"'\\u1100-\\u11FF\\u3130-\\u318F\\uAC00-\\uD7AF]+");

  private static final Pattern MEET_PATH =
      Pattern.compile("/[a-z]{3}-[a-z]{4}-[a-z]{3}(?:/.*)?", Pattern.CASE_INSENSITIVE);

  /**
   * 참가 정보를 판정한다.
   *
   * @param storedUrl 저장된 참가 주소(없으면 null). http(s) 가 아니면 무시하고 본문 탐색으로 넘어간다.
   * @param description 설명(null 허용)
   * @param location 장소(null 허용)
   * @return 회의가 아니면 null
   */
  public static OnlineMeeting resolve(String storedUrl, String description, String location) {
    if (isHttpUrl(storedUrl)) {
      String url = storedUrl.trim();
      String known = knownProviderOf(url);
      return new OnlineMeeting(known != null ? known : "OTHER", url);
    }
    OnlineMeeting found = findIn(description);
    return found != null ? found : findIn(location);
  }

  /** 텍스트에서 처음 나온 회의 링크 — 없으면 null. */
  private static OnlineMeeting findIn(String text) {
    if (text == null || text.isEmpty()) return null;
    Matcher m = URL.matcher(text);
    while (m.find()) {
      String url = trimEnd(m.group());
      String provider = knownProviderOf(url);
      if (provider != null) return new OnlineMeeting(provider, url);
    }
    return null;
  }

  /** 주소가 Teams·Meet·Zoom 회의 주소 모양이면 그 공급자, 아니면 null. */
  private static String knownProviderOf(String url) {
    URI uri = parse(url);
    if (uri == null || uri.getHost() == null) return null;
    String host = uri.getHost().toLowerCase(Locale.ROOT);
    String path = uri.getPath() == null ? "" : uri.getPath();
    if (host.equals("teams.microsoft.com")
        && (path.startsWith("/l/meetup-join/") || path.startsWith("/meet/"))) {
      return "TEAMS";
    }
    if (host.equals("teams.live.com") && path.startsWith("/meet/")) return "TEAMS";
    if (host.equals("meet.google.com") && MEET_PATH.matcher(path).matches()) return "MEET";
    if ((host.equals("zoom.us") || host.endsWith(".zoom.us"))
        && (path.startsWith("/j/") || path.startsWith("/my/"))) {
      return "ZOOM";
    }
    return null;
  }

  /**
   * 저장·판정 공통의 http(s) 주소 검사 — 파싱 가능한 {@link URI} 이고 호스트가 있으며 스킴이 http/https 일 때만 true. 동기화가 저장할
   * 주소({@code GraphCalendarFetcher.mapJoinUrl})와 응답 쪽 판정이 같은 기준을 써서, 저장은 됐는데 응답에서 무시되는 주소가 생기지 않는다.
   */
  public static boolean isHttpUrl(String s) {
    if (s == null || s.isBlank()) return false;
    URI uri = parse(s.trim());
    return uri != null
        && uri.getHost() != null
        && ("http".equalsIgnoreCase(uri.getScheme()) || "https".equalsIgnoreCase(uri.getScheme()));
  }

  private static URI parse(String s) {
    try {
      return new URI(s);
    } catch (Exception e) {
      return null; // 공백·잘못된 문자가 섞인 주소는 회의 링크로 보지 않는다
    }
  }

  /**
   * URL 끝의 문장 부호와 짝 없는 닫는 괄호(소·대·중괄호)를 뗀다 — 「(https://…).」·「[https://…]」. 프론트 {@code trimUrlEnd} 와
   * 같은 규칙.
   */
  private static String trimEnd(String url) {
    String u = url;
    while (!u.isEmpty()) {
      char last = u.charAt(u.length() - 1);
      // 끝 구두점은 무조건, 닫는 괄호는 여는 짝보다 많이 나왔을 때만(=문장의 괄호가 URL 에 딸려 온 것) 뗀다.
      int closer = ")]}".indexOf(last);
      boolean strip =
          ".,;:!?".indexOf(last) >= 0
              || (closer >= 0 && count(u, "([{".charAt(closer)) < count(u, last));
      if (!strip) break;
      u = u.substring(0, u.length() - 1);
    }
    return u;
  }

  private static long count(String s, char c) {
    return s.chars().filter(ch -> ch == c).count();
  }
}
