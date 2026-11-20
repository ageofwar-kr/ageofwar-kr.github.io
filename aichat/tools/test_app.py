#!/usr/bin/env python3
"""AI 단톡방 v1.4 검증 — 마지막 방 기억 · GET 중계 안내(roomread/roompost) · PWA(manifest/sw/아이콘) · 콘솔 오류 0

  python3 site/aichat/tools/test_app.py                     # 로컬 정적 서버로 검사
  python3 site/aichat/tools/test_app.py https://ageofwar-kr.github.io/aichat/   # 라이브 검사

실시간(SSE) 스트림이 화면 전환 때 끊기는 ERR_ABORTED 는 오류로 세지 않는다.
"""
import os, sys, json, threading, http.server, socketserver, functools

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT_HOLDER = {}
EXE = "/workspace/.cache/ms-playwright/chromium_headless_shell-1254/chrome-headless-shell-linux64/chrome-headless-shell"
STREAM = ("messages.json", "reads.json", "typing.json")


def serve():
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
    socketserver.TCPServer.allow_reuse_address = True
    httpd = socketserver.TCPServer(("127.0.0.1", 0), handler)
    PORT_HOLDER["port"] = httpd.server_address[1]
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


def main():
    from playwright.sync_api import sync_playwright
    live = sys.argv[1].rstrip("/") + "/" if len(sys.argv) > 1 else ""
    httpd = None if live else serve()
    base = live or ("http://127.0.0.1:%d/" % PORT_HOLDER["port"])
    tag = "live" if live else "local"
    room = "v14check%d" % (int.from_bytes(os.urandom(2), "big") % 9000 + 1000)
    out = {"base": base, "checks": [], "errors": [], "room": room}

    def check(name, ok, detail=""):
        out["checks"].append({"name": name, "ok": bool(ok), "detail": str(detail)[:300]})
        print(("PASS " if ok else "FAIL ") + name + (" — " + str(detail)[:160] if detail else ""))

    with sync_playwright() as p:
        b = p.chromium.launch(executable_path=EXE, args=["--no-sandbox"])
        ctx = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2,
                            is_mobile=True, has_touch=True, locale="ko-KR", timezone_id="Asia/Seoul")
        page = ctx.new_page()
        page.on("pageerror", lambda e: out["errors"].append("pageerror: " + str(e)[:200]))
        page.on("console", lambda m: out["errors"].append("console: " + m.text[:200]) if m.type == "error" else None)
        failed = []

        def onfail(r):
            u = r.url
            if any(s in u for s in STREAM) and "ERR_ABORTED" in str(r.failure):
                return                       # 화면 전환 때 끊긴 실시간 스트림 — 정상
            failed.append(u[:140] + " " + str(r.failure))
        page.on("requestfailed", onfail)

        page.goto(base + "#room=" + room, wait_until="load")
        page.wait_for_timeout(1300)
        page.fill("#join-nick", "테스터")
        page.click("#join-go")
        page.wait_for_timeout(500)
        check("해시 방 열림", page.eval_on_selector("#room-code", "e=>e.textContent") == room.upper(),
              page.eval_on_selector("#room-code", "e=>e.textContent"))
        check("마지막 방 저장", page.evaluate("localStorage.getItem('aichat.lastRoom.v1')") == room,
              page.evaluate("localStorage.getItem('aichat.lastRoom.v1')"))

        page.goto(base, wait_until="load")
        page.wait_for_timeout(1300)
        check("해시 없이 열어도 마지막 방", page.eval_on_selector("#room-code", "e=>e.textContent") == room.upper(),
              page.eval_on_selector("#room-code", "e=>e.textContent"))
        check("주소에 방 코드 복원", room in page.url, page.url)

        page.click("#btn-help")
        page.wait_for_timeout(300)
        code = page.eval_on_selector("#help-code", "e=>e.textContent")
        check("도움말 roomread", "action=roomread&room=" + room in code)
        check("도움말 roompost", "action=roompost&room=" + room in code)
        out["help"] = code
        page.screenshot(path=os.path.join(ROOT, "screenshots", "live-mobile-%s-help.png" % tag))

        page.keyboard.press("Escape")
        page.click("#btn-rooms")
        page.wait_for_timeout(300)
        check("앱 설치 버튼 있음", page.eval_on_selector_all("#btn-install", "e=>e.length") == 1,
              page.eval_on_selector("#btn-install", "e=>e.textContent"))
        page.click("#btn-install")
        page.wait_for_timeout(300)
        check("설치 안내 토스트", page.eval_on_selector("#toast", "e=>e.getAttribute('data-show')") == "1",
              page.eval_on_selector("#toast", "e=>e.textContent"))
        page.screenshot(path=os.path.join(ROOT, "screenshots", "live-mobile-%s-rooms.png" % tag))
        page.keyboard.press("Escape")
        page.wait_for_timeout(300)
        page.screenshot(path=os.path.join(ROOT, "screenshots", "live-mobile-%s-chat.png" % tag))

        for path in ["manifest.json", "sw.js", "icon-192.png", "icon-512.png", "apple-touch-icon.png"]:
            r = ctx.request.get(base + path)
            check("200 " + path, r.status == 200, r.status)
        mf = ctx.request.get(base + "manifest.json").json()
        check("manifest 내용", mf.get("name") == "AI 단톡방" and mf.get("short_name") == "AI 단톡방"
              and mf.get("display") == "standalone" and mf.get("start_url") == "./"
              and mf.get("theme_color") == "#b2c7d9", json.dumps(mf, ensure_ascii=False)[:160])
        sizes = [i.get("sizes") for i in mf.get("icons", [])]
        check("아이콘 192·512", "192x192" in sizes and "512x512" in sizes, sizes)

        sw = "none"
        for _ in range(12):
            sw = page.evaluate("""async () => {
                const r = await navigator.serviceWorker.getRegistration();
                return r ? (r.active ? 'active' : (r.installing ? 'installing' : 'waiting')) : 'none';
            }""")
            if sw == "active":
                break
            page.wait_for_timeout(400)
        check("서비스워커 등록", sw == "active", sw)
        page.reload(wait_until="load")
        page.wait_for_timeout(1200)
        check("서비스워커가 새로고침 뒤에도 유지",
              page.evaluate("async () => !!(await navigator.serviceWorker.getRegistration())"))
        caches = page.evaluate("async () => (await caches.keys())")
        check("앱 셸 캐시", any("aichat-v1.4" in c for c in caches), caches)
        check("버전 표기 v1.4", page.eval_on_selector("#ver-chip", "e=>e.textContent") == "v1.4",
              page.eval_on_selector("#ver-chip", "e=>e.textContent"))
        ov = page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
        check("가로 넘침 0", ov <= 0, ov)

        out["errors"].extend(failed)
        check("콘솔·페이지·요청 오류 0", not out["errors"], out["errors"][:4])
        b.close()
    if httpd:
        httpd.shutdown()

    ok = all(c["ok"] for c in out["checks"])
    print("SUMMARY", "OK" if ok else "FAIL")
    os.makedirs(os.path.join(ROOT, "screenshots"), exist_ok=True)
    rp = os.path.join(ROOT, "screenshots", "test-%s.json" % tag)
    json.dump(out, open(rp, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print("report:", rp)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
