// 메인 AI 채팅 업로드 전 이미지 축소(WP-234). 모델 이미지 한도(약 5MB, 도구는 원본 3.75MB 까지 이미지 블록)에
// 걸리지 않도록 긴 변 2048px·JPEG 로 줄인다. 서버 측 축소는 하지 않으므로 여기서 한 번만 한다.
// 판단(순수 함수)은 vitest, canvas 변환은 E2E(큰 PNG → image/jpeg 업로드)로 검증한다.

/** 축소 후 긴 변(px). */
export const DOWNSCALE_MAX_EDGE = 2048;
/**
 * 이 크기(3.5MiB)를 넘으면 치수가 작아도 JPEG 로 다시 인코딩한다.
 * ai-agent 이미지 블록 상한(HOME_IMAGE_MAX_BYTES 3.75MiB)보다 작게 둬야, 축소 없이 올라간 이미지가 도구에서
 * "모델에 보낼 수 없음 — 다시 올려 달라"로 막히지 않는다(여유분 256KiB).
 */
export const DOWNSCALE_TRIGGER_BYTES = 3.5 * 1024 * 1024;
/** JPEG 품질 — 문서 스크린샷 글자가 뭉개지지 않는 선. */
export const DOWNSCALE_JPEG_QUALITY = 0.85;

// GIF 는 canvas 를 거치면 첫 프레임만 남아 애니메이션이 사라지므로 제외한다.
const DOWNSCALABLE_TYPES: ReadonlySet<string> = new Set(['image/jpeg', 'image/png', 'image/webp']);

/** 축소를 시도할 형식인지(jpeg·png·webp). */
export function isDownscalableType(mime: string): boolean {
  return DOWNSCALABLE_TYPES.has(mime);
}

/**
 * 축소 목표 치수. 그대로 올려도 되면 null.
 * 긴 변이 2048 이하인데 3.5MiB 를 넘으면 같은 치수로 JPEG 재인코딩만 한다(용량만 줄임).
 */
export function downscaleTarget(width: number, height: number, sizeBytes: number): { width: number; height: number } | null {
  const longEdge = Math.max(width, height);
  if (longEdge <= DOWNSCALE_MAX_EDGE && sizeBytes <= DOWNSCALE_TRIGGER_BYTES) return null;
  if (longEdge <= DOWNSCALE_MAX_EDGE) return { width, height };
  const scale = DOWNSCALE_MAX_EDGE / longEdge;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** JPEG 로 바뀐 파일 이름 — 확장자만 .jpg 로 바꾼다(없으면 붙인다). */
export function toJpegName(name: string): string {
  const dot = name.lastIndexOf('.');
  return `${dot > 0 ? name.slice(0, dot) : name}.jpg`;
}

/**
 * 필요하면 이미지를 축소한 새 File 을, 아니면 원본을 돌려준다. 실패하면 언제나 원본 —
 * 크롬의 HEIC 처럼 디코딩할 수 없는 형식은 그대로 올리고, 읽을 수 없다는 안내는 서버 도구가 맡는다.
 */
export async function downscaleImageForUpload(file: File): Promise<File> {
  if (!isDownscalableType(file.type)) return file;
  let bitmap: ImageBitmap;
  try {
    // imageOrientation 기본값(from-image)이라 EXIF 회전이 반영된 치수로 그린다.
    bitmap = await createImageBitmap(file);
  } catch {
    return file;
  }
  try {
    const target = downscaleTarget(bitmap.width, bitmap.height, file.size);
    if (!target) return file;
    const canvas = document.createElement('canvas');
    canvas.width = target.width;
    canvas.height = target.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    // JPEG 는 투명도가 없어 PNG 투명 영역이 검게 나온다 — 흰 바탕을 먼저 깐다(UI 색이 아닌 픽셀 값이라 토큰 대상 아님).
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, target.width, target.height);
    ctx.drawImage(bitmap, 0, 0, target.width, target.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', DOWNSCALE_JPEG_QUALITY),
    );
    if (!blob) return file;
    return new File([blob], toJpegName(file.name), { type: 'image/jpeg', lastModified: file.lastModified });
  } catch {
    return file;
  } finally {
    bitmap.close();
  }
}
