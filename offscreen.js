// offscreen.js
// Service workers can't touch <audio>, so the background script spins up
// this hidden, non-visible document just to play the chime on request.
chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'sm-play-chime') {
    const el = document.getElementById('chime');
    if (el) {
      el.currentTime = 0;
      el.play().catch(() => {
        /* autoplay can be blocked in rare cases - not worth surfacing */
      });
    }
  }
});
