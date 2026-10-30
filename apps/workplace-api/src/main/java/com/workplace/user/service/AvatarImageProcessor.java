package com.workplace.user.service;

import com.workplace.file.api.ImageSniffer;
import com.workplace.file.exception.FileSizeLimitExceededException;
import com.workplace.user.dto.AvatarCrop;
import com.workplace.user.exception.AvatarProcessingBusyException;
import com.workplace.user.exception.InvalidAvatarImageException;
import java.awt.Color;
import java.awt.Graphics2D;
import java.awt.Rectangle;
import java.awt.RenderingHints;
import java.awt.geom.AffineTransform;
import java.awt.image.BufferedImage;
import java.awt.image.WritableRaster;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.HexFormat;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;
import javax.imageio.IIOImage;
import javax.imageio.ImageIO;
import javax.imageio.ImageReadParam;
import javax.imageio.ImageReader;
import javax.imageio.ImageWriteParam;
import javax.imageio.ImageWriter;
import javax.imageio.stream.ImageInputStream;
import javax.imageio.stream.ImageOutputStream;
import org.springframework.stereotype.Component;
import org.springframework.web.multipart.MultipartFile;

/**
 * 아바타 이미지 처리(WP-1222) — 올린 바이트를 판별·검증하고, 방향을 바로잡아 정사각으로 자른 뒤 64·128·256px 로 다시 인코딩한다.
 *
 * <p>원본은 남기지 않는다. 다시 인코딩하는 이유는 ① EXIF(위치·기기 정보)를 지우고 ② 공개 주소로 내보내는 바이트가 우리가 만든 PNG·JPEG 뿐이게 하려는
 * 것이다(올린 파일에 다른 내용이 섞여 있어도 그대로 나가지 않는다). 알파(투명)가 실제로 있으면 PNG, 없으면 JPEG(품질 0.85).
 *
 * <p>메모리: 원본 전체를 ARGB 로 바꾸거나 통째로 돌리지 않는다. 먼저 자를 정사각을 원본(EXIF 방향 적용 전) 좌표로 옮겨 그 영역만 디코딩하고, 잘린 정사각만
 * 돌린 뒤 줄인다 — 4000px 사진도 자른 영역 크기의 사본 하나만 더 생긴다. 동시에 처리하는 요청 수도 {@link #MAX_CONCURRENT} 로 묶어 업로드가
 * 몰려도 힙을 다 쓰지 않게 한다. 업로드 바이트(최대 5MB)도 처리 자리를 잡은 뒤에야 메모리로 읽어, 자리를 못 잡고 거절되는 요청이 버퍼를 들고 있지 않게 한다.
 *
 * <p>원본에 알파 채널이 없으면(대부분의 JPEG 사진) 처음부터 RGB 로만 다뤄 투명 픽셀 검사와 JPEG 용 RGB 재그리기를 건너뛴다.
 *
 * <p>디스크·DB 를 모르는 순수 처리기라 서비스가 결과를 저장한다.
 */
@Component
public class AvatarImageProcessor {

  /** 올릴 수 있는 최대 바이트(5MB). */
  public static final long MAX_BYTES = 5L * 1024 * 1024;

  /** 원본 가로·세로 상한 — 디코딩 전에 머리글로 확인해 압축 폭탄(작은 파일·거대한 픽셀)을 막는다. */
  public static final int MAX_DIMENSION = 4000;

  /** 자른 정사각의 최소 변 — 이보다 작으면 256px 로 늘렸을 때 흐려진다. */
  public static final int MIN_CROP = 128;

  /** 만드는 크기(큰 것부터 — 작은 크기는 바로 위 크기에서 줄여 품질을 지킨다). */
  public static final List<Integer> SIZES = List.of(256, 128, 64);

  /** 해시 길이(16진 20자 = 80비트) — 공개 주소에 들어가므로 추측할 수 없을 만큼 길게. */
  static final int HASH_LENGTH = 20;

  private static final float JPEG_QUALITY = 0.85f;

  /** 동시에 디코딩·축소하는 업로드 수 — 한 건이 최대 수십 MB 힙을 쓰므로 몰려도 이 수만큼만 처리한다. */
  static final int MAX_CONCURRENT = 2;

  /** 처리 자리를 기다리는 최대 시간 — 넘으면 429 로 「잠시 후 다시」를 알린다(요청 스레드를 오래 묶지 않게 짧게). */
  private static final long ACQUIRE_TIMEOUT_SECONDS = 3;

  /** 해시용 난수원 — 공개 주소에 들어가는 값이라 추측할 수 없어야 한다. */
  private static final SecureRandom RANDOM = new SecureRandom();

  /** 동시 처리 상한({@link #MAX_CONCURRENT}). */
  private final Semaphore permits = new Semaphore(MAX_CONCURRENT);

  /**
   * 처리 결과.
   *
   * @param hash 업로드마다 새로 뽑은 난수 16진 {@link #HASH_LENGTH} 자 — 같은 그림을 다시 올려도 다르다
   * @param extension 저장 확장자(png·jpg)
   * @param images 크기 → 인코딩된 바이트
   */
  public record ProcessedAvatar(String hash, String extension, Map<Integer, byte[]> images) {}

  /**
   * 올린 이미지를 아바타 세 크기로 만든다. 자를 영역(픽셀 좌표·정사각)은 셋 다 주거나 모두 빼야 하며, 빼면(또는 crop 이 null 이면) 가운데 정사각을 쓴다.
   * 좌표는 EXIF 방향을 적용한 뒤(브라우저가 보여 주는 모습) 기준이다.
   *
   * <p>순서: 빈 파일·5MB 초과·이미지 아닌 형식은 앞 몇 바이트만 보고 바로 거절한다(처리 자리를 잡지 않는다) → 처리 자리를 잡은 뒤에야 전체 바이트를 읽는다.
   *
   * @throws InvalidAvatarImageException 형식·크기·자를 영역이 맞지 않을 때(400)
   * @throws FileSizeLimitExceededException 5MB 를 넘을 때(기존 업로드 크기 오류와 같은 문구·400)
   */
  public ProcessedAvatar process(MultipartFile file, AvatarCrop crop) {
    if (file == null || file.isEmpty()) {
      throw new InvalidAvatarImageException("아바타로 쓸 이미지 파일을 골라 주세요");
    }
    if (file.getSize() > MAX_BYTES) {
      throw new FileSizeLimitExceededException("IMAGE", MAX_BYTES, file.getOriginalFilename());
    }
    String mime =
        ImageSniffer.detectUpload(file)
            .orElseThrow(
                () -> new InvalidAvatarImageException("PNG·JPEG·GIF·WEBP 이미지만 아바타로 쓸 수 있습니다"));
    acquire();
    try {
      byte[] bytes = readAll(file);
      int orientation =
          "image/jpeg".equals(mime) ? JpegExifOrientation.read(bytes) : JpegExifOrientation.NORMAL;
      BufferedImage square = decodeSquare(bytes, mime, orientation, crop);

      // 큰 크기에서 작은 크기로 이어 줄인다 — 256 → 128 → 64 는 정확히 절반이라 단계 축소가 곧 고품질 축소다.
      Map<Integer, BufferedImage> scaled = new LinkedHashMap<>();
      BufferedImage previous = square;
      for (int size : SIZES) {
        previous = resize(previous, size);
        scaled.put(size, previous);
      }
      boolean alpha = hasTransparency(scaled.get(SIZES.get(0)));
      String extension = alpha ? "png" : "jpg";
      Map<Integer, byte[]> images = new LinkedHashMap<>();
      for (Map.Entry<Integer, BufferedImage> e : scaled.entrySet()) {
        images.put(e.getKey(), alpha ? encodePng(e.getValue()) : encodeJpeg(e.getValue()));
      }
      return new ProcessedAvatar(newHash(), extension, images);
    } finally {
      permits.release();
    }
  }

  private static byte[] readAll(MultipartFile file) {
    try {
      return file.getBytes();
    } catch (IOException e) {
      throw new UncheckedIOException("아바타 업로드 읽기 실패", e);
    }
  }

  /** 처리 자리를 잡는다. 짧게 기다려도 자리가 나지 않으면(업로드가 몰림) 429 — 웹은 문구를 그대로 토스트로 보인다. */
  private void acquire() {
    try {
      if (permits.tryAcquire(ACQUIRE_TIMEOUT_SECONDS, TimeUnit.SECONDS)) return;
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
    }
    throw new AvatarProcessingBusyException();
  }

  /**
   * 판별한 형식의 리더로 첫 이미지(GIF 는 첫 프레임)에서 자를 정사각만 읽어, EXIF 방향대로 돌린 정사각을 돌려준다(원본에 알파가 있으면 ARGB, 없으면 RGB —
   * {@link #orientSquare}).
   *
   * <p>전체를 디코딩하기 전에 머리글의 가로·세로를 먼저 본다 — 몇 KB 짜리 파일이 수만 px 를 선언해 메모리를 터뜨리는 것을 막는다. 자를 영역은 브라우저가 보여
   * 주는(방향 적용 뒤) 좌표라 {@link #rawRegion} 으로 원본 좌표로 옮겨 그 영역만 읽는다(ImageReadParam 의 source region).
   */
  private static BufferedImage decodeSquare(
      byte[] bytes, String mime, int orientation, AvatarCrop crop) {
    try (ImageInputStream in = ImageIO.createImageInputStream(new ByteArrayInputStream(bytes))) {
      Iterator<ImageReader> readers = ImageIO.getImageReadersByMIMEType(mime);
      if (in == null || !readers.hasNext()) {
        throw unreadable();
      }
      ImageReader reader = readers.next();
      try {
        reader.setInput(in, true, true);
        int width = reader.getWidth(0);
        int height = reader.getHeight(0);
        if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
          throw new InvalidAvatarImageException(
              "가로·세로 " + MAX_DIMENSION + "px 이하 이미지만 아바타로 쓸 수 있습니다");
        }
        boolean swap = isSwapped(orientation);
        Rectangle shown = cropRegion(swap ? height : width, swap ? width : height, crop);
        Rectangle raw = rawRegion(orientation, width, height, shown);
        ImageReadParam param = reader.getDefaultReadParam();
        param.setSourceRegion(raw);
        BufferedImage image = reader.read(0, param);
        if (image == null) {
          throw unreadable();
        }
        if (image.getWidth() != raw.width || image.getHeight() != raw.height) {
          // 영역 읽기를 따르지 않는 리더 대비 — 전체가 왔으면 그 안에서 잘라 쓴다(사본 없이 같은 래스터를 가리킨다).
          if (image.getWidth() != width || image.getHeight() != height) throw unreadable();
          image = image.getSubimage(raw.x, raw.y, raw.width, raw.height);
        }
        return orientSquare(image, orientation);
      } finally {
        reader.dispose();
      }
    } catch (InvalidAvatarImageException e) {
      throw e;
    } catch (IOException | RuntimeException e) {
      // 깨진 파일·지원하지 않는 세부 형식(CMYK JPEG 등) — 서버 오류가 아니라 사용자가 다른 파일을 고를 일이다.
      throw unreadable();
    }
  }

  private static InvalidAvatarImageException unreadable() {
    return new InvalidAvatarImageException("이미지를 읽을 수 없습니다. 다른 파일로 다시 시도해 주세요");
  }

  /** EXIF 방향 5~8(전치·90도 돌림)은 보이는 모습의 가로·세로가 원본과 뒤바뀐다. */
  private static boolean isSwapped(int orientation) {
    return orientation >= 5 && orientation <= 8;
  }

  /**
   * 자를 영역을 검증해 보이는 모습(방향 적용 뒤, 가로 w·세로 h) 좌표의 정사각으로 돌려준다. 영역이 없으면 가운데 정사각.
   *
   * @throws InvalidAvatarImageException 일부만 왔거나, 이미지 밖이거나, {@link #MIN_CROP} 보다 작을 때
   */
  static Rectangle cropRegion(int w, int h, AvatarCrop crop) {
    int x;
    int y;
    int side;
    if (crop == null || crop.isEmpty()) {
      side = Math.min(w, h);
      x = (w - side) / 2;
      y = (h - side) / 2;
    } else if (crop.cropX() == null || crop.cropY() == null || crop.cropSize() == null) {
      throw new InvalidAvatarImageException("자를 영역(cropX·cropY·cropSize)은 셋 다 보내거나 모두 빼야 합니다");
    } else {
      x = crop.cropX();
      y = crop.cropY();
      side = crop.cropSize();
      // long 으로 더해 int 넘침으로 범위 검사를 빠져나가지 못하게 한다.
      if (x < 0 || y < 0 || side <= 0 || (long) x + side > w || (long) y + side > h) {
        throw new InvalidAvatarImageException("자를 영역이 이미지 밖에 있습니다");
      }
    }
    if (side < MIN_CROP) {
      throw new InvalidAvatarImageException(
          "아바타 이미지는 가로·세로 " + MIN_CROP + "px 이상이어야 합니다 (자른 영역 기준)");
    }
    return new Rectangle(x, y, side, side);
  }

  /**
   * 보이는 모습 좌표의 정사각을 원본(저장된 픽셀, 가로 w·세로 h) 좌표로 옮긴다. 방향 o 는 원본 (x, y) 를 보이는 (u, v) 로 보낸다 — 2: (w-1-x,
   * y), 3: (w-1-x, h-1-y), 4: (x, h-1-y), 5: (y, x), 6: (h-1-y, x), 7: (h-1-y, w-1-x), 8: (y,
   * w-1-x). 이 식을 거꾸로 풀어 정사각 한 변 s 의 왼쪽 위 모서리를 구한다(정사각이라 가로·세로 길이는 그대로).
   */
  static Rectangle rawRegion(int orientation, int w, int h, Rectangle shown) {
    int cx = shown.x;
    int cy = shown.y;
    int s = shown.width;
    return switch (orientation) {
      case 2 -> new Rectangle(w - cx - s, cy, s, s);
      case 3 -> new Rectangle(w - cx - s, h - cy - s, s, s);
      case 4 -> new Rectangle(cx, h - cy - s, s, s);
      case 5 -> new Rectangle(cy, cx, s, s);
      case 6 -> new Rectangle(cy, h - cx - s, s, s);
      case 7 -> new Rectangle(w - cy - s, h - cx - s, s, s);
      case 8 -> new Rectangle(w - cy - s, cx, s, s);
      default -> new Rectangle(cx, cy, s, s);
    };
  }

  /**
   * 원본 좌표로 잘라 읽은 정사각을 EXIF 방향대로 돌려 보이는 모습의 정사각으로 만든다(방향 1 도 한 번 옮겨 이후 처리가 정해진 두 형태만 다루게). 원본에 알파
   * 채널이 있으면 ARGB, 없으면 RGB 로 만든다 — 불투명 원본은 이후 축소·JPEG 인코딩까지 RGB 로 이어져 알파 검사·변환을 하지 않는다. 픽셀을 하나씩 옮기지
   * 않고 아핀 변환으로 한 번에 그린다 — 90도 단위 변환이라 최근접 보간이면 픽셀이 정확히 옮겨진다. 변환은 {@link #rawRegion} 의 방향 식과 같다(한 변
   * s 정사각 안에서).
   */
  static BufferedImage orientSquare(BufferedImage src, int orientation) {
    int s = src.getWidth();
    // AffineTransform(m00, m10, m01, m11, m02, m12): u = m00·x + m01·y + m02, v = m10·x + m11·y +
    // m12
    AffineTransform at =
        switch (orientation) {
          case 2 -> new AffineTransform(-1, 0, 0, 1, s, 0); // 좌우 뒤집기
          case 3 -> new AffineTransform(-1, 0, 0, -1, s, s); // 180도
          case 4 -> new AffineTransform(1, 0, 0, -1, 0, s); // 상하 뒤집기
          case 5 -> new AffineTransform(0, 1, 1, 0, 0, 0); // 대각선 뒤집기(transpose)
          case 6 -> new AffineTransform(0, 1, -1, 0, s, 0); // 시계 방향 90도
          case 7 -> new AffineTransform(0, -1, -1, 0, s, s); // 반대 대각선 뒤집기(transverse)
          case 8 -> new AffineTransform(0, -1, 1, 0, 0, s); // 반시계 방향 90도
          default -> new AffineTransform();
        };
    int type =
        src.getColorModel().hasAlpha() ? BufferedImage.TYPE_INT_ARGB : BufferedImage.TYPE_INT_RGB;
    BufferedImage out = new BufferedImage(s, s, type);
    Graphics2D g = out.createGraphics();
    g.setRenderingHint(
        RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_NEAREST_NEIGHBOR);
    g.drawImage(src, at, null);
    g.dispose();
    return out;
  }

  /**
   * 정사각 이미지를 target px 로 바꾼다. 줄일 때는 절반씩 단계적으로 줄인 뒤 마지막에 맞춘다 — 한 번에 크게 줄이면 bicubic 도 표본을 건너뛰어 계단·물결이
   * 생긴다. 알파가 있으면 투명 가장자리에 검은 테가 끼지 않게 미리 곱한 알파(ARGB_PRE)로, 없으면 RGB 로 그린다.
   */
  static BufferedImage resize(BufferedImage src, int target) {
    BufferedImage current = src;
    int size = src.getWidth();
    while (size / 2 >= target) {
      size /= 2;
      current = draw(current, size);
    }
    if (size != target) {
      current = draw(current, target);
    }
    if (current == src) {
      current = draw(src, target); // 이미 같은 크기여도 새 이미지로(호출부가 원본을 계속 쓰므로)
    }
    return current;
  }

  private static BufferedImage draw(BufferedImage src, int size) {
    int type =
        src.getColorModel().hasAlpha()
            ? BufferedImage.TYPE_INT_ARGB_PRE
            : BufferedImage.TYPE_INT_RGB;
    BufferedImage out = new BufferedImage(size, size, type);
    Graphics2D g = out.createGraphics();
    g.setRenderingHint(
        RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BICUBIC);
    g.setRenderingHint(RenderingHints.KEY_RENDERING, RenderingHints.VALUE_RENDER_QUALITY);
    g.setRenderingHint(
        RenderingHints.KEY_ALPHA_INTERPOLATION, RenderingHints.VALUE_ALPHA_INTERPOLATION_QUALITY);
    g.drawImage(src, 0, 0, size, size, null);
    g.dispose();
    return out;
  }

  /**
   * 실제로 반투명·투명한 픽셀이 있는지 — 알파 채널만 있고 모두 불투명한 PNG 는 JPEG 로 저장해 크기를 줄인다. 알파 채널이 없으면 보지 않고 false, 있으면
   * 알파 래스터를 한 번에 읽어 본다(픽셀마다 색 변환하는 getRGB 를 피한다).
   */
  private static boolean hasTransparency(BufferedImage image) {
    WritableRaster alpha = image.getAlphaRaster();
    if (alpha == null) return false;
    int[] samples = alpha.getSamples(0, 0, alpha.getWidth(), alpha.getHeight(), 0, (int[]) null);
    for (int a : samples) {
      if (a != 0xFF) return true;
    }
    return false;
  }

  private static byte[] encodePng(BufferedImage image) {
    // PNG 기록기가 미리 곱한 알파를 다루지 않도록 일반 ARGB 로 바꿔 쓴다(이미 ARGB 면 그대로).
    BufferedImage argb = image;
    if (image.getType() != BufferedImage.TYPE_INT_ARGB) {
      argb = new BufferedImage(image.getWidth(), image.getHeight(), BufferedImage.TYPE_INT_ARGB);
      Graphics2D g = argb.createGraphics();
      g.drawImage(image, 0, 0, null);
      g.dispose();
    }
    ByteArrayOutputStream out = new ByteArrayOutputStream();
    try {
      if (!ImageIO.write(argb, "png", out)) {
        throw new IllegalStateException("PNG 기록기를 찾을 수 없습니다");
      }
    } catch (IOException e) {
      throw new UncheckedIOException("아바타 PNG 인코딩 실패", e);
    }
    return out.toByteArray();
  }

  /**
   * 불투명 이미지를 품질 {@link #JPEG_QUALITY} JPEG 로 쓴다. JDK 기록기는 JFIF 머리글만 쓰고 EXIF 는 쓰지 않는다. 알파 채널이 있는
   * 이미지(모두 불투명)만 흰 바탕 RGB 로 옮기고, 이미 RGB 면(알파 없는 원본) 그대로 쓴다.
   */
  private static byte[] encodeJpeg(BufferedImage image) {
    BufferedImage rgb = image;
    if (image.getType() != BufferedImage.TYPE_INT_RGB) {
      rgb = new BufferedImage(image.getWidth(), image.getHeight(), BufferedImage.TYPE_INT_RGB);
      Graphics2D g = rgb.createGraphics();
      g.setColor(Color.WHITE);
      g.fillRect(0, 0, rgb.getWidth(), rgb.getHeight());
      g.drawImage(image, 0, 0, null);
      g.dispose();
    }
    ImageWriter writer = ImageIO.getImageWritersByFormatName("jpeg").next();
    ByteArrayOutputStream out = new ByteArrayOutputStream();
    try (ImageOutputStream ios = ImageIO.createImageOutputStream(out)) {
      ImageWriteParam param = writer.getDefaultWriteParam();
      param.setCompressionMode(ImageWriteParam.MODE_EXPLICIT);
      param.setCompressionQuality(JPEG_QUALITY);
      writer.setOutput(ios);
      writer.write(null, new IIOImage(rgb, null, null), param);
    } catch (IOException e) {
      throw new UncheckedIOException("아바타 JPEG 인코딩 실패", e);
    } finally {
      writer.dispose();
    }
    return out.toByteArray();
  }

  /**
   * 새 해시 — 업로드마다 SecureRandom 으로 뽑은 {@link #HASH_LENGTH} 자 16진. 결과 바이트에서 계산하지 않는 이유: ① 같은 그림을 다시
   * 올려도 폴더가 달라 겹친 요청끼리 서로 DB 가 가리키는 폴더를 지우지 못하고 ② 원본 이미지를 아는 사람이 주소를 계산해 낼 수 없다. 주소가 바뀌어도 새 업로드뿐이라
   * 영구 캐시는 그대로 맞다.
   */
  private static String newHash() {
    byte[] bytes = new byte[HASH_LENGTH / 2];
    RANDOM.nextBytes(bytes);
    return HexFormat.of().formatHex(bytes);
  }

  /** 해시 형식 검사용 — 공개 주소의 hash 조각이 경로 문자를 품지 못하게 서비스가 쓴다. */
  static boolean isHash(String value) {
    if (value == null || value.length() != HASH_LENGTH) return false;
    for (byte b : value.getBytes(StandardCharsets.US_ASCII)) {
      boolean hex = (b >= '0' && b <= '9') || (b >= 'a' && b <= 'f');
      if (!hex) return false;
    }
    return true;
  }
}
