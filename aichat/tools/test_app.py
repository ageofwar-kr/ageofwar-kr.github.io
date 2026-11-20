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

        # ── GET 중계 — 쓰기(roompost)·읽기(roomread) 실제 동작 ──
        from urllib.parse import quote
        relay = ("https://script.google.com/macros/s/AKfycbwnHX4qyLBYiK5Eg4kK6t31n1gZ3a9995VuxufJn3moUz85wZXYZ-"
                 "SZJh1IuSZtJUG8/exec")
        word = "GET 중계로 올린 말"
        r = ctx.request.get(relay + "?action=roompost&room=%s&name=%s&text=%s" % (room, quote("브로"), quote(word)), timeout=60000)
        j = r.json()
        check("roompost 응답 ok", j.get("ok") is True and j.get("room") == room, j)
        try:
            page.wait_for_function("t => document.querySelector('#log').innerText.includes(t)", arg=word, timeout=15000)
            shown = True
        except Exception:
            shown = False
        check("올린 말이 화면에 뜸", shown)
        s = page.inner_text("#log")
        check("브로 이름으로 보임", "브로" in s)
        rr = ctx.request.get(relay + "?action=roomread&room=%s&limit=5&who=%s" % (room, quote("제미나이")), timeout=60000)
        jj = rr.json()
        check("roomread 응답 ok", jj.get("ok") is True and jj.get("room") == room, {k: jj.get(k) for k in ("ok", "room", "count")})
        texts = [m.get("text") for m in (jj.get("messages") or [])]
        check("roomread에 그 말이 있음", word in texts, texts[-3:])
        check("roomread 메시지 모양", all(set(["key", "who", "name", "text", "ts", "mid"]) <= set(m) for m in jj.get("messages") or []),
              (jj.get("messages") or [{}])[0])
        out["relay"] = {"post": j, "read": {k: jj.get(k) for k in ("ok", "room", "count")}}

        # ── 사용자가 준 방(#room=k558uuh7)으로 한 번 들어갔다가 기본 주소로 다시 열기 ──
        if live:
            page.goto(base + "#room=k558uuh7", wait_until="load")
            page.wait_for_timeout(1200)
            got = page.eval_on_selector("#room-code", "e=>e.textContent")
            page.goto(base, wait_until="load")
            page.wait_for_timeout(1200)
            again = page.eval_on_selector("#room-code", "e=>e.textContent")
            check("k558uuh7 한 번 열고 기본 주소로도 그 방", got == "K558UUH7" and again == "K558UUH7", (got, again))
            page.screenshot(path=os.path.join(ROOT, "screenshots", "live-mobile-reopen-k558uuh7.png"))

        # ── 오프라인 폴백 �� 서비스워커 캐시만으로 화면이 뜨는지 ──
        pre_errors = list(out["errors"])
        ctx.set_offline(True)
        try:
            page.reload(wait_until="load", timeout=20000)
            page.wait_for_timeout(900)
            off_ok = page.eval_on_selector("#ver-chip", "e=>e.textContent") == "v1.4" and len(page.inner_text("#log")) > 0
        except Exception as e:
            off_ok = False
            out["errors"].append("offline: " + str(e)[:120])
        finally:
            ctx.set_offline(False)
        check("오프라인에서도 화면이 뜸", off_ok)
        out["errors"] = pre_errors        # 오프라인 중 네트워크 실패 로그는 오류로 세지 않는다
        failed.clear()
        page.reload(wait_until="load")
        page.wait_for_timeout(900)

        # ── 데스크톱(1440×900) 한 번 더 ──
        dctx = b.new_context(viewport={"width": 1440, "height": 900}, locale="ko-KR", timezone_id="Asia/Seoul")
        dp = dctx.new_page()
        derr = []
        dp.on("pageerror", lambda e: derr.append("pageerror: " + str(e)[:160]))
        dp.on("console", lambda m: derr.append("console: " + m.text[:160]) if m.type == "error" else None)
        dp.goto(base, wait_until="load")
        dp.wait_for_timeout(1200)
        dp.fill("#join-nick", "테스터")
        dp.click("#join-go")
        dp.wait_for_timeout(400)
        dov = dp.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
        check("데스크톱 가로 넘침 0", dov <= 0, dov)
        dp.click("#btn-help")
        dp.wait_for_timeout(400)
        dp.screenshot(path=os.path.join(ROOT, "screenshots", "live-desktop-v14-help.png"))
        dp.keyboard.press("Escape")
        dp.wait_for_timeout(300)
        dp.screenshot(path=os.path.join(ROOT, "screenshots", "live-desktop-v14-chat.png"))
        check("데스크톱 오류 0", not derr, derr[:3])
        dctx.close()

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
