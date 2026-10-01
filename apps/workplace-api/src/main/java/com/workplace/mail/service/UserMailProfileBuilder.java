package com.workplace.mail.service;

import com.workplace.mail.dto.UserMailProfile;
import com.workplace.mail.repository.MailPeopleRepository;
import com.workplace.mail.repository.MailPeopleRepository.ProfileBasics;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Objects;
import java.util.stream.Collectors;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.util.StringUtils;

/**
 * "나" 프로필 빌더(WP-150, 공용) — 메일 개인 분석이 쓰고, AI 대화 등에서도 재사용할 수 있다.
 *
 * <p>주소와 나머지를 각자 짧은 트랜잭션(RLS GUC 주입)에서 읽는다. 주소는 ⑤ 규칙 입력이라 실패하면 예외를 던진다(④ 시도가 기록되지 않아 다음 백필이 재시도).
 * 이름·직함·소속 조회가 실패하면 그 정보만 빼고 주소만 담는다 — Postgres 는 실패한 문장 뒤 같은 트랜잭션을 못 쓰므로 트랜잭션을 나눈다.
 *
 * <p>⚠️ {@link #build} 는 바깥 트랜잭션 밖에서 불러야 한다. 안쪽 트랜잭션이 REQUIRED 라 바깥 트랜잭션에 합류하면, 조회 실패가 바깥 트랜잭션을
 * abort 시킨 뒤에도 catch 가 주소만 담은 프로필로 "성공"처럼 넘어가 이후 문장이 모두 실패한다(분리 의도가 무력화). 호출자(분석 서비스)는 트랜잭션 없이 부른다.
 */
@Slf4j
@Component
public class UserMailProfileBuilder {

  /** 다른 이름(계정 표시 이름) 상한 — 프롬프트 길이 제한. */
  static final int OTHER_NAMES_MAX = 3;

  private final MailPeopleRepository peopleRepo;
  private final TransactionTemplate txTemplate;

  public UserMailProfileBuilder(
      MailPeopleRepository peopleRepo, PlatformTransactionManager txManager) {
    this.peopleRepo = peopleRepo;
    this.txTemplate = new TransactionTemplate(txManager);
  }

  /** 프로필 1건 조회. 주소 조회 실패는 예외, 그 밖의 실패는 주소만 있는 프로필. */
  public UserMailProfile build(long userId) {
    if (TransactionSynchronizationManager.isActualTransactionActive()) {
      // 전파 방식은 바꾸지 않는다 — 전제 위반만 알려 원인 추적을 돕는다
      log.warn("\"나\" 프로필 빌더가 바깥 트랜잭션 안에서 호출됨 — 블록별 실패 격리가 동작하지 않을 수 있음 (userId={})", userId);
    }
    List<String> addresses =
        Objects.requireNonNullElse(
            txTemplate.execute(status -> peopleRepo.listOwnAddresses(userId)), List.of());
    try {
      return txTemplate.execute(status -> withProfile(userId, addresses));
    } catch (RuntimeException e) {
      log.warn("\"나\" 프로필에서 이름·직함·소속을 뺌 (userId={}): {}", userId, e.toString());
      return UserMailProfile.addressesOnly(userId, addresses);
    }
  }

  /** 한 분석 배치(동기화 1회·백필 1회) 동안 쓸 사용자별 캐시. */
  public UserMailProfileCache newCache() {
    return new UserMailProfileCache(this);
  }

  private UserMailProfile withProfile(long userId, List<String> addresses) {
    ProfileBasics b = peopleRepo.findProfileBasics(userId).orElse(null);
    if (b == null) {
      return UserMailProfile.addressesOnly(userId, addresses);
    }
    List<String> displayNames =
        b.accountDisplayNames().stream()
            .map(UserMailProfile::oneLine)
            .filter(StringUtils::hasText)
            .collect(
                Collectors.toMap(
                    n -> n.toLowerCase(Locale.ROOT),
                    n -> n,
                    (first, dup) -> first, // 대소문자만 다른 중복은 먼저 나온 표기를 남긴다
                    LinkedHashMap::new))
            .values()
            .stream()
            .toList();
    String userName = UserMailProfile.oneLine(b.name());
    // 이름이 비었으면 첫 계정 표시 이름을 이름으로 쓴다
    String name =
        StringUtils.hasText(userName)
            ? userName
            : displayNames.isEmpty() ? null : displayNames.get(0);
    List<String> others =
        displayNames.stream()
            .filter(n -> name == null || !n.equalsIgnoreCase(name))
            .limit(OTHER_NAMES_MAX)
            .toList();
    String title = StringUtils.hasText(b.title()) ? UserMailProfile.oneLine(b.title()) : null;
    return new UserMailProfile(
        userId, name, others, title, addresses, peopleRepo.listSharedGroupNames(userId));
  }
}
