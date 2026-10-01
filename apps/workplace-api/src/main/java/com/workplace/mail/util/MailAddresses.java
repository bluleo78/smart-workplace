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

  /** trim + 소문자(Locale.ROOT). null → null. */
  public static String normalize(String address) {
    return address == null ? null : address.trim().toLowerCase(Locale.ROOT);
  }
}
