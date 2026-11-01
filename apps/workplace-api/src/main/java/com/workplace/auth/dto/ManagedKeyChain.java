package com.workplace.auth.dto;

import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;

/**
 * 한 AI 의 한 워크스페이스 활성 managed 키 사슬(WP-1253) — Works 가 자동 발급한 키를 오래된 순(id 오름차순)으로 담는다. 마지막이 현재
 * 키(desired 의 agent-key 버전)이고, 교체가 아직 확인되지 않았으면 첫째가 지금 Pod 가 쓰는 옛 키다.
 *
 * <p>교체·재시도·정리 판정이 리스트 위치와 교체 generation 비교를 여기저기서 되풀이하지 않게 한곳에 모은다. 자동 발급 키의 시간 규칙(수명·미리 다시 받기·정리
 * 유예)도 여기에만 둔다 — 회전 주기가 키 사슬을 AI·워크스페이스마다 두세 개로 묶는 것도 이 값들 때문이다.
 *
 * @param keys 활성 managed 키(오래된 순)
 */
public record ManagedKeyChain(List<Key> keys) {

  /** 키가 하나도 없는 사슬. */
  public static final ManagedKeyChain EMPTY = new ManagedKeyChain(List.of());

  /** 자동 발급 키의 수명. */
  private static final Duration LIFETIME = Duration.ofDays(30);

  /** 미리 다시 받는 여유 — 만료 이만큼 전부터 runner 가 새 키를 받는다(rotateAfter = 만료 − 이 값). */
  private static final Duration ROTATE_BEFORE = Duration.ofDays(7);

  /** 끄기·삭제·교체 뒤 옛 키를 남겨 두는 정리 유예 — 지워지는 Pod 가 SIGTERM 유예 안에 마무리 보고를 할 수 있게. */
  private static final Duration GRACE = Duration.ofMinutes(5);

  public ManagedKeyChain {
    keys = List.copyOf(keys);
  }

  /**
   * 활성 managed 키 한 개(평문 없음).
   *
   * @param rotationGeneration 이 키가 맞춰진 실행 설정 generation(모르는 옛 키는 null)
   * @param retiringAt 정리 유예로 줄인 시각(WP-1263 — 지금 쓰는 키면 null)
   */
  public record Key(
      long id, OffsetDateTime expiresAt, Long rotationGeneration, OffsetDateTime retiringAt) {
    /** 정리 유예에 든 키인지(끄기·삭제·위치 이동·교체 확인 뒤 줄인 키). */
    public boolean isRetiring() {
      return retiringAt != null;
    }

    /** runner 가 미리 다시 받을 시각. */
    public OffsetDateTime rotateAfter() {
      return ManagedKeyChain.rotateAfter(expiresAt);
    }
  }

  /** {@code issuedAt} 에 발급한 키의 만료 시각. */
  public static OffsetDateTime expiresAtFor(OffsetDateTime issuedAt) {
    return issuedAt.plus(LIFETIME);
  }

  /** 만료가 {@code expiresAt} 인 키를 runner 가 미리 다시 받을 시각 — 만료 − 7일. */
  public static OffsetDateTime rotateAfter(OffsetDateTime expiresAt) {
    return expiresAt.minus(ROTATE_BEFORE);
  }

  /** 정리 유예가 끝나는 시각 — {@code now} + 5분. 옛 키를 이 시각으로 줄인다. */
  public static OffsetDateTime graceUntil(OffsetDateTime now) {
    return now.plus(GRACE);
  }

  /**
   * 정리 유예에 든 키(끄기·삭제·위치 이동·교체 확인 뒤 {@link #graceUntil} 로 줄이며 retiring_at 을 남긴 키)를 뺀 사슬. 그 키들은 지워지는
   * Pod 의 것이라 「지금 쓰는 키」가 아니다 — 교체 판정이 이것을 쓰지 않으면, 끈 뒤(또는 다른 위치로 옮긴 뒤) 유예 안에 다시 켰을 때 새 Pod 의 첫 키 발급이
   * 교체로 보여 generation 이 한 번 더 오르고 막 뜬 Pod 가 바로 낡는다(WP-1251 실측).
   *
   * <p>WP-1263: 예전에는 만료가 지금 + 5분 안인지로 짐작했다 — 이제는 줄일 때 남긴 칸(retiring_at)으로 가른다. 시각 비교가 없어 자연 만료가 곧
   * 오는 키를 유예 중으로 잘못 보지 않는다(runner 는 만료 7일 전부터 미리 다시 받으므로 실제로 달라지는 경우는 없다).
   */
  public ManagedKeyChain live() {
    return new ManagedKeyChain(keys.stream().filter(k -> !k.isRetiring()).toList());
  }

  public boolean isEmpty() {
    return keys.isEmpty();
  }

  /** 현재 키(가장 새 키) — 없으면 empty. */
  public Optional<Key> current() {
    return keys.isEmpty() ? Optional.empty() : Optional.of(keys.get(keys.size() - 1));
  }

  /** 교체 전 키(가장 오래된 키) — 키가 둘 이상일 때만. 교체가 확인되기 전이면 지금 Pod 가 쓰는 키다. */
  public Optional<Key> podKey() {
    return keys.size() < 2 ? Optional.empty() : Optional.of(keys.get(0));
  }

  /**
   * 현재 키가 Pod 에 쓰였다고 확인됐는지 — 현재 키의 교체 generation 이 있고 관찰 generation 이 그 이상일 때. 교체 generation 이 없는 옛
   * 키는 확인할 수 없다.
   */
  public boolean isConfirmed(Long observedGeneration) {
    Long rotation = current().map(Key::rotationGeneration).orElse(null);
    return rotation != null && observedGeneration != null && observedGeneration >= rotation;
  }

  /**
   * 현재 키가 아직 어떤 Pod 에도 쓰였다고 확인되지 않아 runner 가 앞 응답을 못 받은 것으로 볼지 — 키가 맞춰진 generation 이 지금 generation
   * 이고 관찰 generation 이 그보다 작을(또는 없을) 때. 관찰 generation 은 끈 뒤에도 남으므로 「관찰 보고가 있음」만으로는 쓰였다고 보지 않는다 — 끄고
   * 다시 켠 AI 의 첫 키 재요청이 교체로 잘못 보이지 않게. 교체 generation 이 없는 옛 키는 관찰 보고가 아직 없을 때만 전달 전으로 본다. 키가 없으면
   * false.
   */
  public boolean isUndelivered(long generation, Long observedGeneration) {
    Optional<Key> current = current();
    if (current.isEmpty()) return false;
    Long rotation = current.get().rotationGeneration();
    if (rotation == null) return observedGeneration == null;
    return rotation == generation && (observedGeneration == null || observedGeneration < rotation);
  }

  /** 교체가 아직 확인되지 않았는데 지금 Pod 가 쓰는 옛 키가 {@code deadline} 까지 만료되는지. */
  public boolean podKeyExpiresBy(Long observedGeneration, OffsetDateTime deadline) {
    if (current().map(Key::rotationGeneration).isEmpty() || isConfirmed(observedGeneration)) {
      return false;
    }
    return podKey().map(Key::expiresAt).filter(expires -> !expires.isAfter(deadline)).isPresent();
  }
}
