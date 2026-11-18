package com.workplace.file.api;

/**
 * 스테이징 복사 출처 리졸버(WP-1705) — 출처 도메인(issue·issue_chat·drive)이 구현해 "이 호출자가 그 첨부를 읽을 수 있는지"를 판정하고 원본
 * FILE id 를 돌려준다.
 *
 * <p>왜 포트인가: core {@code file} 패키지는 issue·chat·drive 를 import 하지 않는다. 읽기 권한(프로젝트 멤버십·채널 접근·드라이브 공유
 * 등)은 각 도메인 가드만 정확히 알므로, 코어는 인터페이스만 두고 구현은 도메인 패키지에 둔다({@link StorageQuotaGuard} 와 같은 방식).
 */
public interface StagedCopySourceResolver {

  /** 이 리졸버가 맡는 출처 키 — {@link StagedCopySource#source()} 와 대조된다. 리졸버끼리 중복되면 안 된다. */
  String source();

  /**
   * 호출자가 읽을 수 있는 원본 FILE id 를 돌려준다.
   *
   * @throws IllegalArgumentException 이 출처에 필요한 필드가 없을 때(400) — 문구는 {@code source '<s>' 는 <필드·필드> 가
   *     필요합니다}
   * @throws RuntimeException 읽을 수 없거나 없을 때는 도메인 가드가 던지는 예외 그대로(404·403)
   */
  long resolveReadableFileId(long callerId, StagedCopySource src);
}
