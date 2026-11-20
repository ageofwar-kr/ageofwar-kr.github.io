#!/usr/bin/env python3
"""AI 단톡방 v1.4 앱 아이콘 생성 — 하늘색(#b2c7d9) 바탕에 카톡 노란 말풍선 + 'AI'

  python3 site/aichat/tools/make_icons.py
산출물(site/aichat/):
  icon-192.png  icon-512.png  icon-maskable-512.png  apple-touch-icon.png
"""
import os
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONT = "/usr/share/fonts/pickle-hwp/NotoSansCJKkr-Regular.otf"
SKY = (178, 199, 217)     # #b2c7d9 — 앱 배경과 같은 하늘색
YELLOW = (254, 229, 0)    # #fee500 — 카톡 노란 말풍선
INK = (60, 30, 30)        # #3c1e1e — 말풍선 속 글자


def bubble(size, inset=0.0, radius_ratio=0.235, full_bleed=True):
    """정사각 아이콘 한 장. inset 은 말풍선을 안쪽으로 줄이는 비율(마스커블 안전영역)."""
    scale = 4
    S = size * scale
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    if full_bleed:
        d.rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * radius_ratio), fill=SKY)
    else:
        pad = int(S * 0.07)
        d.rounded_rectangle([pad, pad, S - 1 - pad, S - 1 - pad], radius=int(S * radius_ratio), fill=SKY)

    # 말풍선 몸통 — 꼬리 자리를 아래에 남기고 살짝 위로
    m = S * (0.17 + inset)
    x1, y1, x2, y2 = m, m * 1.02, S - m, S - m * 1.44
    r = int((x2 - x1) * 0.26)
    d.rounded_rectangle([x1, y1, x2, y2], radius=r, fill=YELLOW)

    # 꼬리 (왼쪽 아래로 짧고 통통하게)
    tail_x = x1 + (x2 - x1) * 0.24
    tail_w = (x2 - x1) * 0.20
    d.polygon([
        (tail_x, y2 - r * 0.55),
        (tail_x + tail_w, y2 - r * 0.55),
        (tail_x + tail_w * 0.30, y2 + (y2 - y1) * 0.20),
    ], fill=YELLOW)

    # 'AI' 글자
    f_size = int((y2 - y1) * 0.56)
    font = ImageFont.truetype(FONT, f_size)
    txt = "AI"
    box = d.textbbox((0, 0), txt, font=font)
    tw, th = box[2] - box[0], box[3] - box[1]
    tx = x1 + ((x2 - x1) - tw) / 2 - box[0]
    ty = y1 + ((y2 - y1) - th) / 2 - box[1] - (y2 - y1) * 0.05
    d.text((tx, ty), txt, font=font, fill=INK)

    return img.resize((size, size), Image.LANCZOS)


def main():
    jobs = [
        ("icon-192.png", 192, dict(inset=0.0)),
        ("icon-512.png", 512, dict(inset=0.0)),
        ("icon-maskable-512.png", 512, dict(inset=0.10)),
        ("apple-touch-icon.png", 180, dict(inset=0.0, radius_ratio=0.0)),
    ]
    for name, size, kw in jobs:
        path = os.path.join(ROOT, name)
        bubble(size, **kw).save(path, "PNG", optimize=True)
        print(path, os.path.getsize(path), "bytes")


if __name__ == "__main__":
    main()
