package com.workplace.fileai.inbound;

import com.workplace.fileai.ExtractionProfile;

/**
 * 도메인 중립 "파일 텍스트 추출 요청" 이벤트(WP-242). 드라이브·이슈 첨부·이슈 챗 첨부가 파일이 영구가 되는 시점에 발행한다.
 *
 * <p>반드시 트랜잭션 안에서 발행해야 한다 — fileai 리스너가 같은 트랜잭션에서 file_extraction 행을 만들고(원자성), 커밋 후 워커로 디스패치한다.
 * storageKey 는 싣지 않는다(디스패치가 file 테이블에서 직접 조회).
 *
 * @param fileId 코어 file.id
 * @param tenantId 행의 tenant_id
 * @param mime 정규화된 mime — 추출 가능 판정({@link com.workplace.fileai.ExtractableTypes})
 * @param profile 추출 이후 처리 범위
 */
public record FileExtractionRequestedEvent(
    long fileId, long tenantId, String mime, ExtractionProfile profile) {}
