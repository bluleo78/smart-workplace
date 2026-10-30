package com.workplace.user.dto;

/**
 * 아바타 자를 영역(WP-1222) — 브라우저가 보여 주는 모습(EXIF 방향 적용 뒤)의 픽셀 좌표·정사각 한 변. 셋 다 주거나 모두 빼야 하며, 모두 빠지면(또는 이 값
 * 자체가 null 이면) 가운데 정사각을 쓴다. 컨트롤러가 multipart 필드(cropX·cropY·cropSize)를 묶어 서비스·처리기로 한 덩어리로 넘긴다.
 */
public record AvatarCrop(Integer cropX, Integer cropY, Integer cropSize) {

  /** 세 값이 모두 없는지 — 가운데 정사각을 쓸 때. */
  public boolean isEmpty() {
    return cropX == null && cropY == null && cropSize == null;
  }
}
