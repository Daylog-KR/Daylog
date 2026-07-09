package com.example.Daylog.Util;

import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.geom.AffineTransform;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;

import javax.imageio.ImageIO;

// [B] edit by smsong - 썸네일 생성 시 EXIF 방향(Orientation)을 반영해 이미지를 바로 세우는 유틸.
//  문제: javax.imageio.ImageIO.read 는 JPEG 의 EXIF Orientation 태그를 무시하고 픽셀 그대로 읽는다.
//        → 세로로 찍은 사진(대개 Orientation=6)이 눕고, 새로 저장한 썸네일 JPEG 에는 EXIF 도 없어
//          브라우저가 되돌리지도 못한다(원본은 EXIF 가 남아 상세보기에선 정상).
//  해결: 업로드 바이트에서 EXIF Orientation 을 직접 파싱(외부 의존성 없음)해 회전/반전 후 리사이즈.
//  스마트폰은 대부분 1/3/6/8 을 사용하며, 드문 반전(2/4/5/7)도 함께 처리한다.
public final class ImageUtil {

    private ImageUtil() {}

    // [B] edit by smsong - 원본 바이트 → EXIF 방향 반영 + 리사이즈한 소형 JPEG 썸네일 바이트.
    //  업로드/일괄 재생성 공용. 디코드 불가(HEIC 등) 시 null.
    public static byte[] buildThumbnailJpeg(byte[] original, int maxEdge) {
        BufferedImage src = decodeOriented(original);
        if (src == null) return null;
        int w = src.getWidth(), h = src.getHeight();
        if (w <= 0 || h <= 0) return null;
        double scale = Math.min(1.0, (double) maxEdge / Math.max(w, h));
        int tw = Math.max(1, (int) Math.round(w * scale));
        int th = Math.max(1, (int) Math.round(h * scale));
        BufferedImage dst = new BufferedImage(tw, th, BufferedImage.TYPE_INT_RGB);
        Graphics2D g = dst.createGraphics();
        g.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BILINEAR);
        g.setRenderingHint(RenderingHints.KEY_RENDERING, RenderingHints.VALUE_RENDER_QUALITY);
        g.drawImage(src, 0, 0, tw, th, null);
        g.dispose();
        try {
            java.io.ByteArrayOutputStream baos = new java.io.ByteArrayOutputStream();
            ImageIO.write(dst, "jpg", baos);
            return baos.toByteArray();
        } catch (Exception e) {
            return null;
        }
    }

    // 업로드 바이트 → EXIF 방향이 반영된 BufferedImage (디코드 불가 시 null)
    public static BufferedImage decodeOriented(byte[] data) {
        if (data == null || data.length == 0) return null;
        BufferedImage src;
        try {
            src = ImageIO.read(new ByteArrayInputStream(data));
        } catch (Exception e) {
            return null;
        }
        if (src == null) return null;
        int orientation = 1;
        try {
            orientation = readExifOrientation(data);
        } catch (Exception ignore) {
            orientation = 1;
        }
        if (orientation <= 1 || orientation > 8) return src;
        try {
            return applyOrientation(src, orientation);
        } catch (Exception e) {
            return src; // 변환 실패 시 원본(무회전)이라도 반환 → 썸네일 자체는 생성
        }
    }

    // ===== EXIF Orientation(0x0112) 파싱 : JPEG APP1(Exif) → TIFF IFD0 =====
    public static int readExifOrientation(byte[] d) {
        if (d == null || d.length < 4) return 1;
        if ((d[0] & 0xFF) != 0xFF || (d[1] & 0xFF) != 0xD8) return 1; // JPEG SOI 아님
        int offset = 2;
        int length = d.length;
        while (offset + 4 <= length) {
            if ((d[offset] & 0xFF) != 0xFF) { offset++; continue; }
            int marker = d[offset + 1] & 0xFF;
            if (marker == 0xD8 || marker == 0xD9) { offset += 2; continue; }      // SOI/EOI
            if (marker >= 0xD0 && marker <= 0xD7) { offset += 2; continue; }      // RSTn
            if (marker == 0x01) { offset += 2; continue; }                        // TEM
            if (offset + 4 > length) break;
            int segLen = ((d[offset + 2] & 0xFF) << 8) | (d[offset + 3] & 0xFF);
            if (segLen < 2) return 1;
            if (marker == 0xE1) { // APP1 → Exif 헤더 확인
                int segStart = offset + 4;
                if (segStart + 6 <= length
                        && d[segStart] == 'E' && d[segStart + 1] == 'x'
                        && d[segStart + 2] == 'i' && d[segStart + 3] == 'f'
                        && d[segStart + 4] == 0 && d[segStart + 5] == 0) {
                    return parseTiffOrientation(d, segStart + 6, length);
                }
            }
            offset += 2 + segLen;
        }
        return 1;
    }

    private static int parseTiffOrientation(byte[] d, int tiff, int length) {
        if (tiff + 8 > length) return 1;
        boolean little;
        int b0 = d[tiff] & 0xFF, b1 = d[tiff + 1] & 0xFF;
        if (b0 == 0x49 && b1 == 0x49) little = true;        // "II"
        else if (b0 == 0x4D && b1 == 0x4D) little = false;  // "MM"
        else return 1;
        int ifdOffset = readInt(d, tiff + 4, little);
        int ifd = tiff + ifdOffset;
        if (ifd + 2 > length || ifd < tiff) return 1;
        int entries = readShort(d, ifd, little);
        int p = ifd + 2;
        for (int i = 0; i < entries; i++) {
            if (p + 12 > length) break;
            int tag = readShort(d, p, little);
            if (tag == 0x0112) { // Orientation
                int val = readShort(d, p + 8, little); // SHORT 값은 value 필드 앞 2바이트
                return (val >= 1 && val <= 8) ? val : 1;
            }
            p += 12;
        }
        return 1;
    }

    private static int readShort(byte[] d, int o, boolean little) {
        int a = d[o] & 0xFF, b = d[o + 1] & 0xFF;
        return little ? (a | (b << 8)) : ((a << 8) | b);
    }

    private static int readInt(byte[] d, int o, boolean little) {
        int a = d[o] & 0xFF, b = d[o + 1] & 0xFF, c = d[o + 2] & 0xFF, e = d[o + 3] & 0xFF;
        return little ? (a | (b << 8) | (c << 16) | (e << 24))
                      : ((a << 24) | (b << 16) | (c << 8) | e);
    }

    // ===== Orientation 값(1~8)에 맞춰 회전/반전 =====
    public static BufferedImage applyOrientation(BufferedImage img, int orientation) {
        switch (orientation) {
            case 2: return flipH(img);
            case 3: return rotate180(img);
            case 4: return flipV(img);
            case 5: return flipH(rotate90(img)); // transpose
            case 6: return rotate90(img);        // 90° CW (세로 사진 대표 케이스)
            case 7: return flipH(rotate270(img)); // transverse
            case 8: return rotate270(img);       // 270° CW (=90° CCW)
            case 1:
            default: return img;
        }
    }

    private static BufferedImage blank(int w, int h) {
        return new BufferedImage(w, h, BufferedImage.TYPE_INT_RGB);
    }

    private static BufferedImage draw(BufferedImage src, int dw, int dh, AffineTransform tx) {
        BufferedImage dst = blank(dw, dh);
        Graphics2D g = dst.createGraphics();
        g.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BILINEAR);
        g.setRenderingHint(RenderingHints.KEY_RENDERING, RenderingHints.VALUE_RENDER_QUALITY);
        g.drawImage(src, tx, null);
        g.dispose();
        return dst;
    }

    private static BufferedImage rotate90(BufferedImage src) { // clockwise
        int w = src.getWidth(), h = src.getHeight();
        AffineTransform tx = new AffineTransform();
        tx.translate(h, 0);
        tx.rotate(Math.PI / 2);
        return draw(src, h, w, tx);
    }

    private static BufferedImage rotate270(BufferedImage src) { // clockwise 270 (=CCW 90)
        int w = src.getWidth(), h = src.getHeight();
        AffineTransform tx = new AffineTransform();
        tx.translate(0, w);
        tx.rotate(3 * Math.PI / 2);
        return draw(src, h, w, tx);
    }

    private static BufferedImage rotate180(BufferedImage src) {
        int w = src.getWidth(), h = src.getHeight();
        AffineTransform tx = new AffineTransform();
        tx.translate(w, h);
        tx.rotate(Math.PI);
        return draw(src, w, h, tx);
    }

    private static BufferedImage flipH(BufferedImage src) {
        int w = src.getWidth(), h = src.getHeight();
        AffineTransform tx = new AffineTransform();
        tx.translate(w, 0);
        tx.scale(-1, 1);
        return draw(src, w, h, tx);
    }

    private static BufferedImage flipV(BufferedImage src) {
        int w = src.getWidth(), h = src.getHeight();
        AffineTransform tx = new AffineTransform();
        tx.translate(0, h);
        tx.scale(1, -1);
        return draw(src, w, h, tx);
    }
}
