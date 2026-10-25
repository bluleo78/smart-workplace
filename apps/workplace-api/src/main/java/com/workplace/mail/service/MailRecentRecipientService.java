package com.workplace.mail.service;

import com.workplace.mail.dto.RecentRecipient;
import com.workplace.mail.repository.MailPeopleRepository;
import com.workplace.mail.repository.MailRecipientRepository;
import com.workplace.mail.repository.MailRecipientRepository.SentHeaders;
import com.workplace.mail.util.MailAddresses;
import com.workplace.mail.util.MailAddresses.Person;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 받는사람 자동완성의 최근 수신인(WP-945) — 최근 보낸 메일에서 받는사람·참조·숨은참조를 사람 단위로 모아 최근 보낸 순으로 준다.
 *
 * <p>따로 모아 두는 표 없이 보낸편지함을 그때그때 읽는다 — 최근 {@link #SCAN_LIMIT} 통만 보므로 요청 하나의 비용이 정해져 있고, 보낸 메일이 지워지면
 * 후보에서도 바로 빠진다. 내 주소(내 계정·사용자 이메일)는 빼서 「나에게 보내기」가 후보 맨 위를 차지하지 않게 한다.
 */
@Service
@RequiredArgsConstructor
public class MailRecentRecipientService {

  /** 살펴보는 최근 보낸 메일 수 — 자주 쓰는 수신인이 다 들어올 만큼 넉넉하되 요청마다 읽는 양은 작게. */
  static final int SCAN_LIMIT = 300;

  /** 한 번에 돌려주는 사람 수 상한 — 작성창이 한 번 받아 두고 브라우저에서 거른다(키 입력마다 다시 묻지 않게). */
  static final int MAX_LIMIT = 200;

  private final MailRecipientRepository recipientRepo;
  private final MailPeopleRepository peopleRepo;

  /** 최근 수신인 — 마지막으로 보낸 순(같으면 보낸 횟수 많은 순)으로 limit 명까지. */
  @Transactional(readOnly = true)
  public List<RecentRecipient> list(long userId, int limit) {
    int size = Math.max(1, Math.min(limit, MAX_LIMIT));
    Set<String> own = new HashSet<>(peopleRepo.listOwnAddresses(userId));

    // 보낸 순으로 읽으므로 사람마다 처음 만난 행이 마지막으로 보낸 메일이다 — 이름도 그 메일의 것을 쓰고, 없을 때만 앞선 메일의 이름으로 채운다.
    Map<String, Acc> byAddress = new LinkedHashMap<>();
    for (SentHeaders mail : recipientRepo.listRecentSent(userId, SCAN_LIMIT)) {
      Set<String> inThisMail = new HashSet<>();
      for (String header : new String[] {mail.to(), mail.cc(), mail.bcc()}) {
        for (Person p : MailAddresses.parsePeople(header)) {
          if (own.contains(p.address()) || !inThisMail.add(p.address())) {
            continue;
          }
          Acc acc = byAddress.computeIfAbsent(p.address(), a -> new Acc(mail.sentAt()));
          acc.count++;
          if (acc.name == null) {
            acc.name = p.name();
          }
        }
      }
    }

    List<RecentRecipient> out = new ArrayList<>();
    byAddress.forEach(
        (address, acc) ->
            out.add(new RecentRecipient(address, acc.name, acc.lastSentAt, acc.count)));
    // 마지막으로 보낸 순, 같은 메일에 함께 든 사람끼리는 보낸 횟수가 많은 순(그래도 같으면 헤더에 적힌 순 — 안정 정렬).
    out.sort(
        Comparator.comparing(
                RecentRecipient::lastSentAt, Comparator.nullsLast(Comparator.reverseOrder()))
            .thenComparing(RecentRecipient::sentCount, Comparator.reverseOrder()));
    return out.stream().limit(size).toList();
  }

  /** 사람 하나의 누적 — 마지막 보낸 시각·이름·횟수. */
  private static final class Acc {
    final OffsetDateTime lastSentAt;
    String name;
    int count;

    Acc(OffsetDateTime lastSentAt) {
      this.lastSentAt = lastSentAt;
    }
  }
}
