package com.workplace.mail.util;

import jakarta.mail.internet.AddressException;
import jakarta.mail.internet.InternetAddress;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 저장된 수신자 헤더(email_message.to_addresses/cc_addresses) → 소문자 주소 목록(WP-149 ⑤).
 *
 * <p>IMAP 행은 {@code InternetAddress.toString()}(표시 이름·쉼표·RFC 2047 포함), Graph 행은 주소만 ", " 로 이은 형식이라
 * RFC 파서로 먼저 읽고, 깨진 값은 주소 정규식으로 건진다.
 */
public final class MailAddresses {

  private static final Pattern EMAIL = Pattern.compile("[A-Za-z0-9._%+'\\-]+@[A-Za-z0-9.\\-]+");

  private MailAddresses() {}

  /** 헤더 값을 주소 목록으로. 소문자·중복 제거·입력 순서 유지. null/공백 → 빈 목록. */
  public static List<String> parseList(String header) {
    if (header == null || header.isBlank()) {
      return List.of();
    }
    Set<String> out = new LinkedHashSet<>();
    try {
      for (InternetAddress a : InternetAddress.parseHeader(header, false)) {
        String n = normalize(a.getAddress());
        if (n != null && n.contains("@")) {
          out.add(n);
        }
      }
    } catch (AddressException e) {
      // 깨진 헤더 — 정규식으로 주소만 건진다
      out.clear();
      Matcher m = EMAIL.matcher(header);
      while (m.find()) {
        out.add(normalize(m.group()));
      }
    }
    return new ArrayList<>(out);
  }

  /** 수신자 한 명 — 소문자 주소와 표시 이름(RFC 2047 풀림, 없으면 null). */
  public record Person(String address, String name) {}

  /**
   * 헤더 값을 사람 목록으로 — 주소와 표시 이름까지(WP-945 최근 수신인). 입력 순서 유지, 중복은 그대로 둔다. 깨진 헤더는 항목(쉼표)마다 다시 읽어 멀쩡한 항목의
   * 이름은 지키고, 그래도 깨진 항목만 {@link #parseList} 로 주소를 건진다.
   */
  public static List<Person> parsePeople(String header) {
    if (header == null || header.isBlank()) {
      return List.of();
    }
    try {
      return parsePeopleStrict(header);
    } catch (AddressException e) {
      List<Person> out = new ArrayList<>();
      for (String piece : header.split(",")) {
        try {
          out.addAll(parsePeopleStrict(piece));
        } catch (AddressException broken) {
          parseList(piece).forEach(a -> out.add(new Person(a, null)));
        }
      }
      return out;
    }
  }

  /** RFC 파서로 읽는다 — 주소다운 것(@ 포함)만, 이름이 비면 null. */
  private static List<Person> parsePeopleStrict(String header) throws AddressException {
    List<Person> out = new ArrayList<>();
    for (InternetAddress a : InternetAddress.parseHeader(header, false)) {
      String address = normalize(a.getAddress());
      if (address != null && address.contains("@")) {
        String name = a.getPersonal();
        out.add(new Person(address, name == null || name.isBlank() ? null : name.trim()));
      }
    }
    return out;
  }

  /** trim + 소문자(Locale.ROOT). null → null. */
  public static String normalize(String address) {
    return address == null ? null : address.trim().toLowerCase(Locale.ROOT);
  }
}
