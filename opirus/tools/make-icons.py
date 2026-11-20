#!/usr/bin/env python3
"""오피러스 카세트 v1.0 — PWA 아이콘 생성 (icon-192, icon-512, maskable, apple-touch)"""
from PIL import Image, ImageDraw, ImageFilter
import numpy as np, os

SS = 4  # 슈퍼샘플 배수
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")


def lin_grad(w, h, top, bottom):
    t = np.linspace(0.0, 1.0, h).reshape(h, 1, 1)
    arr = np.array(top, float)[None, None, :] * (1 - t) + np.array(bottom, float)[None, None, :] * t
    arr = np.repeat(arr, w, axis=1)
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGB")


def rounded_mask(size, radius):
    m = Image.new("L", size, 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, size[0] - 1, size[1] - 1), radius=radius, fill=255)
    return m


def fill_round(base, box, radius, top, bottom=None):
    """둥근 사각형 안을 세로 그라데이션으로 채운다."""
    x0, y0, x1, y1 = [int(round(v)) for v in box]
    w, h = max(1, x1 - x0), max(1, y1 - y0)
    g = lin_grad(w, h, top, bottom if bottom else top)
    m = rounded_mask((w, h), radius)
    base.paste(g, (x0, y0), m)


def render(size, radius_ratio, content, transparent=False):
    C = size * SS
    # 배경
    bg = lin_grad(C, C, (58, 52, 45), (17, 15, 13))
    arr = np.asarray(bg).astype(np.float32)
    yy, xx = np.mgrid[0:C, 0:C]
    cx, cy = C * 0.5, C * -0.12
    d = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2) / (C * 1.05)
    glow = np.clip(1 - d, 0, 1) ** 2.2
    arr += glow[..., None] * np.array([70, 58, 40], np.float32)
    # 모서리 비네트
    dv = np.sqrt((xx - C / 2) ** 2 + (yy - C / 2) ** 2) / (C * 0.72)
    arr -= np.clip(dv, 0, 1)[..., None] ** 3 * 26
    bg = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGB").convert("RGBA")

    if not transparent and radius_ratio > 0:
        bg.putalpha(rounded_mask((C, C), int(C * radius_ratio)))

    d_ = ImageDraw.Draw(bg)

    # 카세트
    bw = C * 0.78 * content
    bh = bw / 1.58
    bx0, by0 = (C - bw) / 2, (C - bh) / 2
    bx1, by1 = bx0 + bw, by0 + bh
    rad = bw * 0.045

    # 그림자
    sh = Image.new("RGBA", (C, C), (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle((bx0, by0 + bh * 0.07, bx1, by1 + bh * 0.07),
                                         radius=rad, fill=(0, 0, 0, 150))
    sh = sh.filter(ImageFilter.GaussianBlur(bw * 0.035))
    bg.alpha_composite(sh)

    # 몸체 + 금색 테두리
    fill_round(bg, (bx0 - bw * 0.012, by0 - bw * 0.012, bx1 + bw * 0.012, by1 + bw * 0.012),
               rad * 1.25, (176, 148, 96), (86, 70, 46))
    fill_round(bg, (bx0, by0, bx1, by1), rad, (84, 76, 66), (26, 22, 19))

    # 라벨
    lx0, ly0, lx1, ly1 = bx0 + bw * 0.07, by0 + bh * 0.10, bx1 - bw * 0.07, by0 + bh * 0.44
    fill_round(bg, (lx0, ly0, lx1, ly1), bw * 0.012, (232, 224, 204), (188, 179, 158))
    d_ = ImageDraw.Draw(bg)
    # 라벨 위 글줄
    for i, y in enumerate((ly0 + (ly1 - ly0) * 0.36, ly0 + (ly1 - ly0) * 0.62)):
        d_.line([(lx0 + bw * 0.06, y), (lx1 - bw * 0.30, y)], fill=(120, 112, 96), width=int(bw * 0.012))

    # 테이프 창
    wx0 = bx0 + bw * 0.10
    wx1 = bx1 - bw * 0.10
    wy0 = by0 + bh * 0.50
    wy1 = by0 + bh * 0.86
    fill_round(bg, (wx0, wy0, wx1, wy1), bw * 0.03, (12, 10, 9), (22, 18, 16))

    cy_r = (wy0 + wy1) / 2
    rr = (wy1 - wy0) * 0.46
    for fx in (0.30, 0.70):
        rcx = wx0 + (wx1 - wx0) * fx
        d_.ellipse((rcx - rr, cy_r - rr, rcx + rr, cy_r + rr), fill=(62, 45, 37), outline=(10, 8, 7), width=int(bw * 0.008))
        hub = rr * 0.34
        d_.ellipse((rcx - hub, cy_r - hub, rcx + hub, cy_r + hub), fill=(226, 217, 199))
        d_.ellipse((rcx - hub * 0.42, cy_r - hub * 0.42, rcx + hub * 0.42, cy_r + hub * 0.42), fill=(16, 13, 12))

    # 나사
    for sx, sy in ((bx0 + bw * 0.035, by0 + bh * 0.06), (bx1 - bw * 0.035, by0 + bh * 0.06),
                   (bx0 + bw * 0.035, by1 - bh * 0.06), (bx1 - bw * 0.035, by1 - bh * 0.06)):
        sr = bw * 0.014
        d_.ellipse((sx - sr, sy - sr, sx + sr, sy + sr), fill=(118, 108, 92), outline=(14, 12, 10))

    # 하단 헤드 개구부
    d_.polygon([(bx0 + bw * 0.34, by1 - bh * 0.12), (bx1 - bw * 0.34, by1 - bh * 0.12),
                (bx1 - bw * 0.38, by1 - bh * 0.01), (bx0 + bw * 0.38, by1 - bh * 0.01)], fill=(10, 8, 7))

    return bg.resize((size, size), Image.LANCZOS)


def main():
    render(512, 0.20, 1.0).convert("RGB").save(os.path.join(OUT, "icon-512.png"))
    render(192, 0.20, 1.0).convert("RGB").save(os.path.join(OUT, "icon-192.png"))
    render(512, 0.0, 0.72).convert("RGB").save(os.path.join(OUT, "icon-maskable-512.png"))
    render(180, 0.0, 0.92).convert("RGB").save(os.path.join(OUT, "apple-touch-icon.png"))
    print("icons written")


if __name__ == "__main__":
    main()
