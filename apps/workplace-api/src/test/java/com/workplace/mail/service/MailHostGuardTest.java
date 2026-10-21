package com.workplace.mail.service;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.InetAddress;
import java.net.UnknownHostException;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** MailHostGuard 판정(WP-740) — 이름 풀이는 가짜 resolver 로 정해 DNS 없이 검증한다. */
class MailHostGuardTest {

  /** 이름 → 주소 고정표. 표에 없으면 풀리지 않는 이름. 불린 이름은 resolved 에 남긴다. */
  private final List<String> resolved = new ArrayList<>();

  private MailHostGuard guard(List<String> allowed, Map<String, String[]> table) {
    return new MailHostGuard(
        allowed,
        host -> {
          resolved.add(host);
          String[] ips = table.get(host);
          if (ips == null) throw new UnknownHostException(host);
          InetAddress[] out = new InetAddress[ips.length];
          for (int i = 0; i < ips.length; i++) out[i] = InetAddress.getByName(ips[i]);
          return out;
        });
  }

  @Test
  void publicHost_passes() {
    MailHostGuard g = guard(List.of(), Map.of("imap.example.com", new String[] {"93.184.216.34"}));
    assertThat(g.check("imap.example.com")).isNull();
  }

  @Test
  void loopbackPrivateMetadataCgnat_areBlocked() {
    MailHostGuard g =
        guard(
            List.of(),
            Map.of(
                "127.0.0.1", new String[] {"127.0.0.1"},
                "10.255.255.1", new String[] {"10.255.255.1"},
                "169.254.169.254", new String[] {"169.254.169.254"},
                "100.64.0.1", new String[] {"100.64.0.1"},
                "::1", new String[] {"::1"}));
    for (String h : List.of("127.0.0.1", "10.255.255.1", "169.254.169.254", "100.64.0.1", "::1")) {
      assertThat(g.check(h)).as(h).isEqualTo(MailHostGuard.INTERNAL_MESSAGE);
    }
  }

  @Test
  void nameResolvingToAnyInternalAddress_isBlocked() {
    // 공개 주소와 사설 주소를 함께 돌려주는 이름 — 하나라도 내부면 거절(fail-closed)
    MailHostGuard g =
        guard(List.of(), Map.of("mixed.example.com", new String[] {"93.184.216.34", "10.0.0.5"}));
    assertThat(g.check("mixed.example.com")).isEqualTo(MailHostGuard.INTERNAL_MESSAGE);
  }

  @Test
  void localhostNames_areBlockedWithoutResolving() {
    MailHostGuard g = guard(List.of(), Map.of());
    assertThat(g.check("localhost")).isEqualTo(MailHostGuard.INTERNAL_MESSAGE);
    assertThat(g.check("Mail.LOCALHOST")).isEqualTo(MailHostGuard.INTERNAL_MESSAGE);
    assertThat(resolved).isEmpty();
  }

  @Test
  void bracketedIpv6_isStrippedAndBlocked() {
    MailHostGuard g = guard(List.of(), Map.of("::1", new String[] {"::1"}));
    assertThat(g.check("[::1]")).isEqualTo(MailHostGuard.INTERNAL_MESSAGE);
  }

  @Test
  void unresolvableOrBlankHost_isRejectedAsUnknown() {
    MailHostGuard g = guard(List.of(), Map.of());
    assertThat(g.check("no-such.example")).isEqualTo(MailHostGuard.UNKNOWN_HOST_MESSAGE);
    assertThat(g.check(" ")).isEqualTo(MailHostGuard.UNKNOWN_HOST_MESSAGE);
    assertThat(g.check(null)).isEqualTo(MailHostGuard.UNKNOWN_HOST_MESSAGE);
  }

  @Test
  void operatorAllowedHost_passesWithoutResolving_caseAndSpaceInsensitive() {
    MailHostGuard g = guard(List.of(" Mail.Corp.Internal ", "10.1.2.3"), Map.of());
    assertThat(g.check("mail.corp.internal")).isNull();
    assertThat(g.check("10.1.2.3")).isNull();
    assertThat(resolved).isEmpty();
  }

  @Test
  void shortIpv4Form_resolvesToLoopbackAndIsBlocked() {
    // 실제 resolver(InetAddress.getAllByName) — 127.1 같은 축약형도 127.0.0.1 로 풀려 막힌다. JavaMail 도 같은 방식으로
    // 푼다.
    MailHostGuard g = new MailHostGuard(List.of("127.0.0.1"));
    assertThat(g.check("127.1")).isEqualTo(MailHostGuard.INTERNAL_MESSAGE);
  }
}
