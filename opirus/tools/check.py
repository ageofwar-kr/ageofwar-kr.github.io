#!/usr/bin/env python3
"""오피러스 카세트 v1.1 검증 스크립트.
   사용: python3 tools/check.py            (로컬 서버: deploy-repo/opirus)
        python3 tools/check.py --live     (https://ageofwar-kr.github.io/opirus/)
"""
import argparse, json, os, sys, threading, functools, http.server, socketserver, math, wave, struct
from playwright.sync_api import sync_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
HERE = os.path.dirname(os.path.abspath(__file__))
SHOT = os.path.join(HERE, "shots")
LOCAL_URL = "http://127.0.0.1:8123/opirus/"
LIVE_URL = "https://ageofwar-kr.github.io/opirus/"
WAV = os.path.join(SHOT, "test-tone.wav")

os.makedirs(SHOT, exist_ok=True)


def make_wav(path, seconds=12, freq=440.0, rate=16000, name=None):
    """테스트용 짧은 톤(앞 2초 무음, 나머지 사인파) WAV."""
    if os.path.exists(path) and not name:
        return path
    frames = int(rate * seconds)
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        data = bytearray()
        for i in range(frames):
            t = i / rate
            v = 0.0 if t < 2 else 0.35 * math.sin(2 * math.pi * freq * t)
            data += struct.pack("<h", int(v * 32767))
        w.writeframes(bytes(data))
    return path


def serve():
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
    class Q(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a):
            pass
    handler = functools.partial(Q, directory=ROOT)
    httpd = socketserver.TCPServer(("127.0.0.1", 8123), handler)
    t = threading.Thread(target=httpd.serve_forever, daemon=True)
    t.start()
    return httpd


def shot(page, name, full=False):
    p = os.path.join(SHOT, name + ".png")
    page.screenshot(path=p, full_page=full)
    return p


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--live", action="store_true")
    args = ap.parse_args()

    url = LIVE_URL if args.live else LOCAL_URL
    httpd = None
    if not args.live:
        httpd = serve()

    wav = make_wav(WAV)
    wav2 = make_wav(os.path.join(SHOT, "test-tone-2.wav"), seconds=9, freq=587.0)

    out = {"url": url, "checks": [], "errors": [], "shots": []}

    def check(name, ok, detail=""):
        out["checks"].append({"name": name, "ok": bool(ok), "detail": str(detail)[:300]})
        print(("PASS " if ok else "FAIL ") + name + ("  " + str(detail)[:160] if detail else ""))

    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=["--autoplay-policy=no-user-gesture-required"])

        # ───────── 뷰포트 3종 스크린샷 ─────────
        views = [
            ("mobile-portrait", 390, 844, 3, True),
            ("mobile-landscape", 844, 390, 2, True),
            ("desktop", 1440, 900, 1, False),
        ]
        for name, w, h, dsf, mobile in views:
            ctx = browser.new_context(viewport={"width": w, "height": h}, device_scale_factor=dsf,
                                      is_mobile=mobile, has_touch=mobile)
            page = ctx.new_page()
            errs = []
            page.on("console", lambda m, e=errs: e.append("console:" + m.type + ":" + m.text) if m.type == "error" else None)
            page.on("pageerror", lambda e, errs=errs: errs.append("pageerror:" + str(e)))
            page.goto(url, wait_until="networkidle")
            # 부팅 화면
            page.wait_for_timeout(320)
            if name == "mobile-portrait":
                out["shots"].append(shot(page, "00-boot"))
            page.wait_for_timeout(1600)
            out["shots"].append(shot(page, "01-" + name))

            m = page.evaluate("""() => ({
                sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight,
                iw: innerWidth, ih: innerHeight,
                navW: document.querySelector('#monitor').getBoundingClientRect().width,
                navH: document.querySelector('#monitor').getBoundingClientRect().height,
                lcdW: document.querySelector('#lcd').getBoundingClientRect().width,
                lcdH: document.querySelector('#lcd').getBoundingClientRect().height,
                lcdBottom: document.querySelector('#lcd').getBoundingClientRect().bottom
            })""")
            check("overflow-x " + name, m["sw"] <= m["iw"] + 1, f"{m['sw']} vs {m['iw']}")
            check("overflow-y " + name, m["sh"] <= m["ih"] + 1, f"{m['sh']} vs {m['ih']}")
            check("LCD 비율/크기 " + name, 0.4 * m["iw"] < m["lcdW"] or m["lcdW"] > 200,
                  f"lcd {m['lcdW']:.0f}x{m['lcdH']:.0f} / nav {m['navW']:.0f}x{m['navH']:.0f}")
            if errs:
                out["errors"].extend([name + " " + e for e in errs])
            ctx.close()

        # ───────── 기능 검증 ─────────
        ctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=3,
                                  is_mobile=True, has_touch=True)
        page = ctx.new_page()
        errs = []
        page.on("console", lambda m: errs.append("console:" + m.type + ":" + m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: errs.append("pageerror:" + str(e)))
        page.goto(url, wait_until="networkidle")
        page.wait_for_timeout(1800)

        # 테이프 만들기 (SEL → 새 테이프 만들기 → 이름/라벨/음원)
        page.click("#btn-sel")
        page.wait_for_timeout(250)
        out["shots"].append(shot(page, "02-shelf-empty"))
        page.click("#tapes-new")
        page.wait_for_timeout(250)
        page.fill("#new-name", "트로트")
        page.click('.swatch[data-style="red"]')

        with page.expect_file_chooser() as fc:
            page.click("#new-pick")
        fc.value.set_files([wav, wav2])
        page.wait_for_timeout(700)
        out["shots"].append(shot(page, "03-new-tape"))
        page.click("#new-save")

        # 삽입 애니메이션
        page.wait_for_timeout(500)
        out["shots"].append(shot(page, "04-inserting"))
        page.wait_for_timeout(1400)
        out["shots"].append(shot(page, "05-loaded"))

        st = page.evaluate("""() => ({
            label: document.querySelector('#label-name').textContent,
            title: document.querySelector('#track-title').textContent,
            dur: document.querySelector('#t-dur').textContent,
            src: document.querySelector('#audio').currentSrc.slice(0, 24),
            paused: document.querySelector('#audio').paused,
            playing: document.querySelector('#monitor').classList.contains('is-playing'),
            flapOpen: document.querySelector('#mouth').classList.contains('is-open'),
            lb: getComputedStyle(document.querySelector('#label-bg')).fill
        })""")
        check("테이프 라벨에 이름 표시", st["label"] == "트로트", st["label"])
        check("라벨 색 적용(레드)", "168" in st["lb"] or "rgb(168" in st["lb"], st["lb"])
        check("트랙 제목 표시", "test-tone" in st["title"], st["title"])
        check("길이 표시", st["dur"] not in ("--:--", "00:00"), st["dur"])
        check("삽입 후 플랩 닫힘", st["flapOpen"] is False)
        check("삽입 후 자동 재생", st["paused"] is False and st["playing"], st["paused"])

        # 재생 시간 증가 + 릴 회전
        t0 = page.evaluate("document.querySelector('#audio').currentTime")
        r0 = page.evaluate("getComputedStyle(document.querySelector('#reelL')).transform")
        page.wait_for_timeout(1200)
        t1 = page.evaluate("document.querySelector('#audio').currentTime")
        r1 = page.evaluate("getComputedStyle(document.querySelector('#reelL')).transform")
        check("재생 시간 증가", t1 > t0 + 0.4, f"{t0:.2f} → {t1:.2f}")
        check("카세트 릴 회전", r0 != r1, f"{r0[:28]} → {r1[:28]}")

        # 앞으로감기 +10
        page.click("#key-fwd")
        page.wait_for_timeout(200)
        t2 = page.evaluate("document.querySelector('#audio').currentTime")
        check("앞으로감기 10초", t2 - t1 > 8, f"{t1:.2f} → {t2:.2f}")

        # 뒤로감기 -10
        page.click("#key-back")
        page.wait_for_timeout(200)
        t3 = page.evaluate("document.querySelector('#audio').currentTime")
        check("뒤로감기 10초", t2 - t3 > 8, f"{t2:.2f} → {t3:.2f}")

        # 멈추기
        page.click("#key-play")
        page.wait_for_timeout(260)
        paused = page.evaluate("document.querySelector('#audio').paused")
        rot_a = page.evaluate("getComputedStyle(document.querySelector('#reelL')).transform")
        page.wait_for_timeout(400)
        rot_b = page.evaluate("getComputedStyle(document.querySelector('#reelL')).transform")
        check("멈추기 동작", paused is True, paused)
        check("멈추면 릴 정지", rot_a == rot_b, f"{rot_a[:24]}")

        # 다시 재생
        page.click("#key-play")
        page.wait_for_timeout(400)
        check("재생 재개", page.evaluate("document.querySelector('#audio').paused") is False)

        # 테이프 꺼내기
        page.click("#btn-eject")
        page.wait_for_timeout(900)
        ej = page.evaluate("""() => ({
            label: document.querySelector('#label-name').textContent,
            ghost: document.querySelector('#tape').classList.contains('is-ghost'),
            title: document.querySelector('#track-title').textContent,
            paused: document.querySelector('#audio').paused
        })""")
        check("꺼내기: 빈 덱", ej["ghost"] and ej["label"] == "NO TAPE" and ej["paused"], json.dumps(ej, ensure_ascii=False))
        out["shots"].append(shot(page, "06-ejected"))

        # 테이프 함에서 다시 넣기
        page.click("#btn-sel")
        page.wait_for_timeout(300)
        out["shots"].append(shot(page, "07-shelf"))
        page.click(".tape-row__go")
        page.wait_for_timeout(1500)
        back = page.evaluate("document.querySelector('#label-name').textContent")
        check("함에서 다시 넣기", back == "트로트", back)
        out["shots"].append(shot(page, "08-reinserted"))

        # 새로고침 후 테이프 보존 (IndexedDB)
        page.reload(wait_until="networkidle")
        page.wait_for_timeout(2000)
        keep = page.evaluate("""() => ({
            label: document.querySelector('#label-name').textContent,
            title: document.querySelector('#track-title').textContent,
            dur: document.querySelector('#t-dur').textContent
        })""")
        check("새로고침 후 테이프 유지", keep["label"] == "트로트", json.dumps(keep, ensure_ascii=False))

        # PWA 자산
        for path, ct in [("manifest.json", "json"), ("sw.js", "javascript"), ("icon-192.png", "png"),
                         ("icon-512.png", "png"), ("apple-touch-icon.png", "png"), ("favicon.svg", "svg")]:
            r = page.request.get(url + path)
            check("200 " + path, r.status == 200, f"{r.status} {r.headers.get('content-type','')}")
            if ct == "json":
                man = r.json()
                check("manifest 이름/표시", man.get("name") == "오피러스 카세트" and man.get("display") == "standalone",
                      json.dumps({k: man.get(k) for k in ("name", "short_name", "start_url", "scope")}, ensure_ascii=False))

        sw = page.evaluate("""async () => {
            const rs = await navigator.serviceWorker.getRegistrations();
            return rs.length;
        }""")
        check("서비스워커 등록", sw >= 1, sw)

        if errs:
            out["errors"].extend(["functional " + e for e in errs])
        check("콘솔/페이지 오류 0", len(errs) == 0, "; ".join(errs)[:400])

        ctx.close()
        browser.close()

    if httpd:
        httpd.shutdown()

    ok = all(c["ok"] for c in out["checks"]) and not out["errors"]
    out["ok"] = ok
    print("\n=== " + ("ALL PASS" if ok else "FAILURES") + " ===")
    print(json.dumps({"ok": ok, "failed": [c for c in out["checks"] if not c["ok"]],
                      "errors": out["errors"]}, ensure_ascii=False, indent=1))
    with open(os.path.join(SHOT, "result.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
