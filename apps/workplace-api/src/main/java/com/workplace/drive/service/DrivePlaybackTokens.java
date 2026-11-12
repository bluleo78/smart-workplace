package com.workplace.drive.service;

import com.workplace.global.security.JwtProperties;
import com.workplace.global.security.LabeledTokenCrypto;
import java.time.Clock;
import java.time.Instant;
import java.util.Optional;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

/**
 * 드라이브 재생 토큰(WP-1532) — 영상·오디오를 {@code <video src>} 에 바로 넣어 Range 로 재생하게 하는 짧은 봉인 값.
 *
 * <p>access 토큰은 메모리에 있고 axios 헤더로만 실려, 브라우저가 직접 보내는 미디어 요청에는 인증이 없다. 그래서 로그인한 사용자가 볼 권한을 확인받은 뒤 이
 * 토큰이 든 주소를 받아 미디어 요소에 넣는다.
 *
 * <p>형식은 {@link LabeledTokenCrypto#seal} — {@code base64url(iv ‖ AES-GCM(payload))}, payload 는
 * {@code tenantId|userId|driveFileId|coreFileId|expEpochSec}. 서명이 아니라 봉인인 이유: 주소는 브라우저 기록·프록시 로그에
 * 남으므로 내부 id(테넌트·사용자· 파일)를 드러내지 않는다. GCM 태그가 변조를 막고, 서버에 상태를 두지 않아 인스턴스가 여러 개여도 동작한다.
 *
 * <ul>
 *   <li>tenantId·driveFileId — 다른 워크스페이스·다른 파일 주소로 바꿔 쓸 수 없게 묶는다.
 *   <li>coreFileId — 현재 버전의 file.id. 새 버전이 올라오면 바뀌어 이전 토큰은 저절로 쓸 수 없다(버전 묶음).
 *   <li>userId — 매 요청 그 사용자가 아직 볼 수 있는지 다시 확인한다(공간에서 빠지면 바로 막힌다).
 *   <li>키 — JWT 시크릿에서 라벨({@value #KEY_LABEL})로 도메인 분리해 파생한다. 공유 열람 토큰·JWT 와 키가 달라 서로의 값을 받아 주지 않는다.
 * </ul>
 */
@Component
public class DrivePlaybackTokens {

  /** 키 파생 라벨 — 공유 열람 토큰({@code swp-share-view-v1})과 다른 값이어야 한다. */
  static final String KEY_LABEL = "swp-drive-playback-v1";

  private final LabeledTokenCrypto crypto;
  private final Clock clock;

  @Autowired
  public DrivePlaybackTokens(JwtProperties jwt) {
    this(jwt, Clock.systemUTC());
  }

  /** 테스트용 — 시계를 고정해 만료 판정을 본다. */
  DrivePlaybackTokens(JwtProperties jwt, Clock clock) {
    this.crypto = LabeledTokenCrypto.derive(jwt.secret(), KEY_LABEL);
    this.clock = clock;
  }

  /** 토큰이 묶는 값. expiresAt 은 초 단위로 잘라 쓴다. */
  public record Claims(
      long tenantId, long userId, long driveFileId, long coreFileId, Instant expiresAt) {}

  /** 주어진 값을 봉인한 토큰을 만든다(만료 시각은 호출부가 정한다 — 테스트가 이미 지난 시각으로도 만든다). */
  public String seal(Claims c) {
    return crypto.seal(
        c.tenantId()
            + "|"
            + c.userId()
            + "|"
            + c.driveFileId()
            + "|"
            + c.coreFileId()
            + "|"
            + c.expiresAt().getEpochSecond());
  }

  /** 봉인이 열리고(변조·다른 키 아님) 만료 전이면 묶인 값을 돌려준다. 형식 오류를 포함한 모든 실패는 빈 값(호출부가 404 로 다룬다). */
  public Optional<Claims> verify(String token) {
    return crypto.open(token).flatMap(this::parse);
  }

  private Optional<Claims> parse(String plain) {
    try {
      String[] p = plain.split("\\|", -1);
      if (p.length != 5) return Optional.empty();
      Instant exp = Instant.ofEpochSecond(Long.parseLong(p[4]));
      if (!exp.isAfter(clock.instant())) return Optional.empty();
      return Optional.of(
          new Claims(
              Long.parseLong(p[0]),
              Long.parseLong(p[1]),
              Long.parseLong(p[2]),
              Long.parseLong(p[3]),
              exp));
    } catch (RuntimeException e) {
      return Optional.empty();
    }
  }
}
