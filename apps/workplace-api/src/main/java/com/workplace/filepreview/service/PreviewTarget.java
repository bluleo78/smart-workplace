package com.workplace.filepreview.service;

import com.workplace.filepreview.repository.PreviewStateStore;
import java.nio.file.Path;
import java.util.Optional;

/**
 * 미리보기 변환 대상 한 건(WP-432) — {@link PreviewEngine} 은 상태기계(판정·선점·기록)만 알고, 대상은 키·원본·결과 위치만 안다.
 *
 * <p>드라이브는 {@code file_id} 키로 원본 옆 {@code preview.pdf} 를, 메일 첨부는 {@code (tenant_id, content_hash)}
 * 키로 암호화한 결과를 쓴다. 엔진이 드라이브 전용 지식(FILE 테이블·FileStore)에 묶이지 않게 이 경계로 나눈다.
 *
 * @param <K> 상태 행의 키
 */
public interface PreviewTarget<K> {

  /** 상태 행 키. */
  K key();

  /** 대상이 속한 테넌트 — 실행기 스레드가 이 값으로 GUC 를 세운다. */
  long tenantId();

  /** 이 대상의 상태 저장소. */
  PreviewStateStore<K> store();

  /** 로그에 남길 식별 문자열(예: {@code fileId=12}). */
  String logKey();

  /**
   * 변환 서비스에 보낼 정규형 mime. 대상 아님(null)은 서비스가 대상을 만들기 전에 거른다 — 엔진은 선점 뒤 다시 읽은 메타가 대상이 아니게 된 드문 경우만
   * UNSUPPORTED 로 기록한다.
   */
  String targetMime();

  /** 받기 전 크기 판정 결과. */
  enum SizeCheck {
    /** 상한 안이거나 모른다 — 선점으로 간다. */
    WITHIN,
    /** 정확한 원본 크기가 상한을 넘는다 — 영구 실패로 행에 굳힌다(드라이브). */
    OVER,
    /**
     * 추정 크기(예: IMAP manifest 의 base64 크기)가 상한을 넘는다 — 응답만 하고 행에는 쓰지 않는다. 같은 키를 공유하는 다른 원본의 상태를 추정으로
     * 덮지 않기 위해서다(메일). 실제 크기 초과는 선점한 작업이 받은 바이트로 판정해 기록한다.
     */
    OVER_ESTIMATED
  }

  /** 원본을 받기 전 크기 상한 판정. */
  SizeCheck sizeCheck(long maxBytes);

  /**
   * 저장된 변환 결과를 읽는다(트랜잭션 안에서 불린다). 결과가 없거나 읽을 수 없으면 empty — 엔진이 READY 행을 되돌려 다시 변환한다.
   *
   * <p>돌려주는 {@link PreviewOutcome.Ready} 의 ETag 는 대상이 만든다 — 원본·엔진·재변환 중 하나라도 바뀌면 달라져야 한다.
   */
  Optional<PreviewOutcome.Ready> loadResult();

  /** 변환 서비스에 보낼 원본 파일을 연다(실행기 스레드, 트랜잭션 밖). 쓰고 나면 {@link SourceFile#close} 로 정리한다. */
  SourceFile openSource();

  /**
   * {@link #openSource} 가 던진 예외를 실패 코드·일시 여부로 옮긴다. 기본은 일시 실패(UNAVAILABLE) — provider·디스크의 일시 장애로
   * 본다. 다시 해도 같은 실패(실제 크기 초과 등)는 대상이 영구 코드로 바꾼다(상태 테이블 CHECK 에 있는 코드만).
   *
   * <p>null 을 돌려주면 공유 행에 실패를 기록하지 않고 선점을 반납한다(PENDING, 시도 횟수 미소모) — 실패가 이 요청자에게만 해당할 때(메일: 내 메일만
   * provider 에서 지워졌고 같은 바이트의 다른 사본은 남아 있을 수 있다). 요청자에게 알리는 일은 대상이 따로 한다.
   */
  default PreviewOutcome.Failed sourceFailure(RuntimeException e) {
    return new PreviewOutcome.Failed("UNAVAILABLE", true);
  }

  /** 변환 결과를 저장한다. 실패하면 RuntimeException. */
  void storeResult(byte[] pdf);

  /**
   * 저장했지만 완료 기록(CAS)에 실패한 결과를 지운다 — 고아 결과 파일을 남기지 않게. 엔진은 행이 없거나 다른 작업의 결과(READY·살아 있는 리스의
   * CONVERTING)가 아닐 때만, 그 행을 잠근 트랜잭션 안에서 부른다.
   */
  void deleteResult();

  /**
   * 변환 서비스에 보낼 원본 파일과 그 정리 동작.
   *
   * @param path 원본 경로
   * @param cleanup 다 쓴 뒤 할 정리(메일은 평문 임시 파일 삭제, 드라이브는 없음)
   */
  record SourceFile(Path path, Runnable cleanup) implements AutoCloseable {

    /** 정리할 것이 없는 원본(드라이브 — 원본 blob 을 그대로 보낸다). */
    public static SourceFile of(Path path) {
      return new SourceFile(path, () -> {});
    }

    @Override
    public void close() {
      cleanup.run();
    }
  }
}
