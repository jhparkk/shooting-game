/* =========================================================
   ZOOM GUARD — 아이폰 사파리 확대(핀치 줌 · 더블탭 줌) 차단
   ---------------------------------------------------------
   iOS 10+ 사파리는 <meta viewport user-scalable=no> 를 무시한다.
   이 게임은 왼손 조이스틱과 오른손 발사·고도 버튼을 동시에 누르기 때문에
   두 손가락 터치가 그대로 핀치 줌이 되어 버린다. CSS(touch-action) 위에
   문서·창 수준에서 한 겹 더 막고, 버튼·메뉴 클릭은 그대로 통과시킨다.
   ========================================================= */
(function () {
  'use strict';
  if (window.__zoomGuard) return; // 중복 설치 방지

  var DOUBLE_TAP_MS = 320;
  // 클릭으로 동작하는 UI — 이 영역에서는 기본 동작을 건드리지 않는다.
  var INTERACTIVE = 'button, a, input, select, textarea, label, .screen';

  // 검증용 카운터 (?debug 등에서 확인)
  var stats = { gesture: 0, pinch: 0, doubleTap: 0, wheel: 0 };
  window.__zoomGuard = stats;

  function isInteractive(target) {
    return !!(target && target.closest && target.closest(INTERACTIVE));
  }

  function stop(e) {
    if (e.cancelable !== false) e.preventDefault();
  }

  /* 1) 사파리 전용 제스처 이벤트 — 핀치 줌의 원천 */
  ['gesturestart', 'gesturechange', 'gestureend'].forEach(function (type) {
    function blockGesture(e) {
      stats.gesture++;
      stop(e);
    }
    document.addEventListener(type, blockGesture, { passive: false });
    window.addEventListener(type, blockGesture, { passive: false });
  });

  /* 2) 두 손가락 이상 = 핀치 줌 차단 (조이스틱 + 발사 버튼 동시 터치) */
  function touchGuard(e) {
    if (!e.touches) return;
    if (e.touches.length > 1) {
      stats.pinch++;
      stop(e);
      return;
    }
    // 사파리가 이미 확대 중일 때(e.scale) 밀어내는 동작도 막는다.
    if (e.scale !== undefined && e.scale !== 1) stop(e);
  }
  document.addEventListener('touchstart', touchGuard, { passive: false });
  document.addEventListener('touchmove', touchGuard, { passive: false });

  /* 3) 더블탭 줌 — 300ms 안에 두 번 두드리면 두 번째 터치를 무효화.
        버튼·메뉴는 연달아 누르는 경우가 있으므로 건너뛴다. */
  var lastTouchEnd = 0;
  document.addEventListener('touchend', function (e) {
    if (e.touches && e.touches.length > 0) return; // 아직 손가락이 남아 있음
    var now = Date.now();
    var isDoubleTap = now - lastTouchEnd < DOUBLE_TAP_MS;
    lastTouchEnd = now;
    if (isDoubleTap && !isInteractive(e.target)) {
      stats.doubleTap++;
      stop(e);
    }
  }, { passive: false });

  /* 4) 트랙패드·마우스 휠 확대 (ctrl/⌘ + 휠) */
  window.addEventListener('wheel', function (e) {
    if (e.ctrlKey || e.metaKey) {
      stats.wheel++;
      stop(e);
    }
  }, { passive: false });

  /* 5) 더블클릭 확대 · 길게 눌러 뜨는 메뉴 */
  document.addEventListener('dblclick', function (e) {
    if (!isInteractive(e.target)) stop(e);
  }, { passive: false });
  document.addEventListener('contextmenu', function (e) {
    if (!isInteractive(e.target)) stop(e);
  });
})();
