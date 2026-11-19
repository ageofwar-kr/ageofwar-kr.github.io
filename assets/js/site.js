(() => {
  'use strict';

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');

  /* ---------------------------------------------------------------- nav */
  const nav = document.getElementById('nav');
  const burger = document.getElementById('burger');
  const menu = document.getElementById('navMenu');

  let lastY = window.scrollY;
  const onNavScroll = () => {
    const y = window.scrollY;
    nav.classList.toggle('is-scrolled', y > 16);
    lastY = y;
  };
  onNavScroll();
  window.addEventListener('scroll', onNavScroll, { passive: true });

  const setMenu = (open) => {
    if (!burger || !menu) return;
    burger.setAttribute('aria-expanded', String(open));
    burger.setAttribute('aria-label', open ? '메뉴 닫기' : '메뉴 열기');
    menu.setAttribute('aria-hidden', String(!open));
    menu.classList.toggle('is-open', open);
    document.body.style.overflow = open ? 'hidden' : '';
  };

  if (burger && menu) {
    burger.addEventListener('click', () => setMenu(burger.getAttribute('aria-expanded') !== 'true'));
    menu.querySelectorAll('a').forEach((a) => a.addEventListener('click', () => setMenu(false)));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && burger.getAttribute('aria-expanded') === 'true') {
        setMenu(false);
        burger.focus();
      }
    });
    window.addEventListener('resize', () => {
      if (window.innerWidth > 900 && burger.getAttribute('aria-expanded') === 'true') setMenu(false);
    });
  }

  /* ------------------------------------------------------------ reveal */
  const revealEls = Array.from(document.querySelectorAll('.reveal'));
  if ('IntersectionObserver' in window && !reduceMotion.matches) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('in');
          io.unobserve(entry.target);
        }
      });
    }, { rootMargin: '0px 0px -12% 0px', threshold: 0.12 });
    revealEls.forEach((el) => io.observe(el));
  } else {
    revealEls.forEach((el) => el.classList.add('in'));
  }

  /* -------------------------------------------------------- active link */
  const navLinks = Array.from(document.querySelectorAll('.nav__links a'));
  const sections = navLinks
    .map((a) => document.querySelector(a.getAttribute('href')))
    .filter(Boolean);

  if ('IntersectionObserver' in window && sections.length) {
    const spy = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const id = '#' + entry.target.id;
        navLinks.forEach((a) => a.classList.toggle('is-active', a.getAttribute('href') === id));
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    sections.forEach((s) => spy.observe(s));
  }

  /* ----------------------------------------------------------- parallax */
  const parallaxEls = Array.from(document.querySelectorAll('[data-parallax]'));
  if (parallaxEls.length && !reduceMotion.matches) {
    let raf = 0;
    const apply = () => {
      raf = 0;
      const y = window.scrollY;
      const wide = window.innerWidth > 900;
      parallaxEls.forEach((el) => {
        const factor = parseFloat(el.dataset.parallax) || 0;
        const offset = wide ? Math.max(-120, Math.min(160, y * factor)) : 0;
        el.style.setProperty('--py', offset.toFixed(1) + 'px');
      });
    };
    const request = () => { if (!raf) raf = requestAnimationFrame(apply); };
    apply();
    window.addEventListener('scroll', request, { passive: true });
    window.addEventListener('resize', request);
  }

  /* --------------------------------------------------------------- tilt */
  const tiltEls = Array.from(document.querySelectorAll('[data-tilt]'));
  if (tiltEls.length && finePointer.matches && !reduceMotion.matches) {
    const MAX = 6;
    tiltEls.forEach((el) => {
      el.classList.add('tiltable');
      let raf = 0;
      let rx = 0, ry = 0;

      const paint = () => {
        raf = 0;
        el.style.setProperty('--rx', rx.toFixed(2) + 'deg');
        el.style.setProperty('--ry', ry.toFixed(2) + 'deg');
      };

      el.addEventListener('pointermove', (e) => {
        const r = el.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width - 0.5;
        const py = (e.clientY - r.top) / r.height - 0.5;
        ry = px * MAX * 2;
        rx = -py * MAX * 2;
        el.classList.add('is-tilting');
        if (!raf) raf = requestAnimationFrame(paint);
      });
      el.addEventListener('pointerleave', () => {
        rx = 0; ry = 0;
        el.classList.remove('is-tilting');
        if (!raf) raf = requestAnimationFrame(paint);
      });
    });
  }

  /* -------------------------------------------------------------- video */
  const video = document.getElementById('promo');
  const player = document.getElementById('player');
  const hint = document.getElementById('videoHint');
  const soundBtn = document.getElementById('soundToggle');
  const soundLabel = document.getElementById('soundLabel');
  const fsBtn = document.getElementById('fsToggle');
  const playOverlay = document.getElementById('playOverlay');

  if (video && player) {
    let loaded = false;
    let userWantsSound = false;
    let failed = false;

    const load = () => {
      if (loaded) return;
      loaded = true;
      const src = video.dataset.src;
      if (!src) return;
      video.src = src;
      video.load();
    };

    const hideHint = () => hint && hint.classList.add('is-hidden');
    const showOverlay = (show) => {
      if (!playOverlay) return;
      playOverlay.hidden = !show;
    };

    const syncSoundUi = () => {
      const on = !video.muted;
      if (soundBtn) {
        soundBtn.classList.toggle('is-on', on);
        soundBtn.setAttribute('aria-pressed', String(on));
      }
      if (soundLabel) soundLabel.textContent = on ? '소리 끄기' : '소리 켜기';
      if (on) {
        hideHint();
        video.controls = true;
      }
    };

    const tryPlay = async () => {
      try {
        await video.play();
        showOverlay(false);
      } catch (err) {
        showOverlay(true);
      }
    };

    const unmute = (fromVideoClick) => {
      video.muted = false;
      userWantsSound = true;
      syncSoundUi();
      tryPlay();
      if (fromVideoClick) {
        /* native controls may treat the same click as play/pause */
        window.setTimeout(() => {
          if (video.paused && !failed) tryPlay();
        }, 320);
      }
    };

    const toggleSound = () => {
      if (video.muted) {
        unmute();
      } else {
        video.muted = true;
        userWantsSound = false;
        syncSoundUi();
      }
    };

    /* lazy load + play only while on screen */
    if ('IntersectionObserver' in window) {
      const vio = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && entry.intersectionRatio > 0.35) {
            load();
            if (!failed && !userWantsSound) tryPlay();
          } else if (entry.isIntersecting === false && !video.paused && !userWantsSound) {
            video.pause();
          }
        });
      }, { threshold: [0, 0.35, 0.75] });
      vio.observe(player);
    } else {
      load();
    }

    video.addEventListener('error', () => {
      failed = true;
      showOverlay(true);
      if (hint) hint.textContent = '영상을 불러오지 못했습니다';
    });

    video.addEventListener('loadeddata', () => {
      if (failed) {
        failed = false;
        showOverlay(false);
      }
    });

    video.addEventListener('playing', () => showOverlay(false));
    video.addEventListener('play', () => {
      if (!failed) showOverlay(false);
    });

    video.addEventListener('click', () => {
      if (video.muted) {
        unmute(true);
      } else if (video.paused) {
        tryPlay();
      }
    });

    player.addEventListener('click', (e) => {
      if (e.target === video) return;
      if (playOverlay && !playOverlay.hidden) return;
      if (video.muted) unmute();
    });

    if (playOverlay) {
      playOverlay.addEventListener('click', (e) => {
        e.stopPropagation();
        load();
        unmute();
      });
    }

    if (soundBtn) soundBtn.addEventListener('click', toggleSound);

    if (fsBtn) {
      fsBtn.addEventListener('click', async () => {
        const target = video;
        try {
          if (document.fullscreenElement) {
            await document.exitFullscreen();
          } else if (target.requestFullscreen) {
            await target.requestFullscreen();
          } else if (target.webkitEnterFullscreen) {
            target.webkitEnterFullscreen();
          }
        } catch (err) {
          /* fullscreen can be refused; leave the inline player as is */
        }
      });
    }

    document.addEventListener('visibilitychange', () => {
      if (document.hidden && !video.paused && !userWantsSound) video.pause();
    });

    syncSoundUi();
  }
})();
