package com.workplace.issue.dto;

import com.workplace.issue.exception.InvalidCursorException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;

/**
 * 사용자 지정 정렬(WP-1238, {@link IssueSort})의 복합 커서. 정렬 키 값(널 여부 플래그 포함)과 동률 깨기(수정 시각·id)를 그대로 담아 같은 값
 * 행이 페이지 경계에 걸려도 중복·누락이 없다.
 *
 * <p>직렬화는 base64url(`s1|서명|값…`). 접두 {@code s1} 로 기존 {@link IssueCursor}·다른 목록 커서와 구분하고, 서명({@link
 * IssueSort#signature()})으로 다른 정렬에서 나온 커서를 알아본다({@link #fits}). 값은 담당자 이름처럼 구분자({@code |})를 포함할 수
 * 있어 각 값을 다시 base64url 로 싼다. 값의 뜻·형식(날짜·시각·숫자·문자열)은 리포지토리의 정렬 키 목록이 정한다 — 이 클래스는 문자열로만 옮긴다.
 *
 * @param signature 커서를 만든 정렬 서명
 * @param values 정렬 키 값(리포지토리 키 목록 순서, 마지막은 id)
 */
public record IssueSortCursor(String signature, List<String> values) {

  private static final String PREFIX = "s1";
  private static final String SEP = "|";

  /** 이 커서가 요청한 정렬에서 나온 것인지 — 서명이 다르면 값 자리의 뜻이 달라 seek 할 수 없다. */
  public boolean fits(IssueSort sort) {
    return signature.equals(sort.signature());
  }

  /** 커서 문자열로 직렬화한다. */
  public String encode() {
    List<String> parts = new ArrayList<>(values.size() + 2);
    parts.add(PREFIX);
    parts.add(signature);
    for (String v : values) parts.add(b64(v));
    return b64(String.join(SEP, parts));
  }

  /** 커서 문자열을 해석한다. 형식이 틀리면(기존 IssueCursor·다른 목록 커서 포함) {@link InvalidCursorException}(400). */
  public static IssueSortCursor decode(String cursor) {
    try {
      String raw = unb64(cursor);
      String[] p = raw.split("\\|", -1);
      if (p.length < 3 || !PREFIX.equals(p[0])) {
        throw new InvalidCursorException("cursor 형식 오류");
      }
      List<String> values = new ArrayList<>(p.length - 2);
      for (int i = 2; i < p.length; i++) values.add(unb64(p[i]));
      return new IssueSortCursor(p[1], List.copyOf(values));
    } catch (InvalidCursorException e) {
      throw e;
    } catch (Exception e) {
      throw new InvalidCursorException("cursor 디코딩 실패");
    }
  }

  private static String b64(String s) {
    return Base64.getUrlEncoder()
        .withoutPadding()
        .encodeToString(s.getBytes(StandardCharsets.UTF_8));
  }

  private static String unb64(String s) {
    return new String(Base64.getUrlDecoder().decode(s), StandardCharsets.UTF_8);
  }
}
