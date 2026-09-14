#!/usr/bin/env python3
"""Генерация иконок «Книги здоровья».
Запуск: python3 docs/make_icons.py  (из корня проекта)
"""
from PIL import Image, ImageDraw
import math, os

ACCENT = (23, 98, 126)      # #17627E
ACCENT2 = (42, 139, 168)    # #2A8BA8
PAPER = (255, 255, 255)
PAPER2 = (222, 236, 242)


def heart(draw, cx, cy, size, fill):
    """Сердце по классической параметрической кривой — без стыков и углов."""
    pts = []
    steps = 240
    for i in range(steps):
        t = 2 * math.pi * i / steps
        x = 16 * math.sin(t) ** 3
        y = (13 * math.cos(t) - 5 * math.cos(2 * t)
             - 2 * math.cos(3 * t) - math.cos(4 * t))
        pts.append((cx + x * size / 32.0, cy - y * size / 32.0))
    draw.polygon(pts, fill=fill)


def draw_icon(size, pad_ratio=0.0, radius_ratio=0.22, bg=True):
    S = size * 4  # рисуем крупно и уменьшаем — так края получаются гладкими
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    if bg:
        r = int(S * radius_ratio)
        d.rounded_rectangle([0, 0, S - 1, S - 1], radius=r, fill=ACCENT)

    # Рабочая область с отступом (для maskable — больше)
    pad = S * (0.18 + pad_ratio)
    x0, y0, x1, y1 = pad, pad * 1.05, S - pad, S - pad * 1.05
    w, h = x1 - x0, y1 - y0

    # Книга: белый блок со скруглением и корешком
    br = int(w * 0.09)
    d.rounded_rectangle([x0, y0, x1, y1], radius=br, fill=PAPER)
    # Корешок
    spine = x0 + w * 0.13
    d.rectangle([x0 + br * 0.2, y0 + h * 0.03, spine, y1 - h * 0.03], fill=PAPER2)
    d.line([(spine, y0 + h * 0.05), (spine, y1 - h * 0.05)],
           fill=(190, 210, 220), width=max(2, int(S * 0.006)))

    # Сердце на обложке
    cx = x0 + w * 0.60
    cy = y0 + h * 0.47
    heart(d, cx, cy, w * 0.72, ACCENT2)

    # Линия пульса поверх сердца
    lw = max(3, int(S * 0.020))
    yb = cy + h * 0.02
    pts = [
        (cx - w * 0.24, yb),
        (cx - w * 0.12, yb),
        (cx - w * 0.08, yb - h * 0.11),
        (cx - w * 0.01, yb + h * 0.10),
        (cx + w * 0.07, yb - h * 0.04),
        (cx + w * 0.11, yb),
        (cx + w * 0.24, yb),
    ]
    d.line(pts, fill=PAPER, width=lw, joint="curve")

    return img.resize((size, size), Image.LANCZOS)


def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    out = lambda n: os.path.join(root, n)

    draw_icon(192).save(out("icon-192.png"))
    draw_icon(512).save(out("icon-512.png"))
    # maskable: значимая часть должна укладываться в 80% полотна
    draw_icon(512, pad_ratio=0.07, radius_ratio=0.50).save(out("icon-512-maskable.png"))
    draw_icon(180, radius_ratio=0.0).save(out("apple-touch-icon.png"))

    # Превью для README
    big = draw_icon(1024)
    prev = Image.new("RGB", (1200, 630), (237, 243, 246))
    prev.paste(big.resize((360, 360), Image.LANCZOS), (110, 135), big.resize((360, 360), Image.LANCZOS))
    d = ImageDraw.Draw(prev)
    d.rectangle([0, 600, 1200, 630], fill=ACCENT)
    os.makedirs(os.path.join(root, "docs", "img"), exist_ok=True)
    prev.save(os.path.join(root, "docs", "img", "og-preview.png"))
    print("Иконки готовы")


if __name__ == "__main__":
    main()
