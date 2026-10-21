// Runs before first paint so the saved theme never flashes. External file: the CSP forbids inline scripts.
(function () {
  var saved = null;
  try { saved = localStorage.getItem('sc-theme'); } catch (e) {}
  var light = saved === 'light' || (saved !== 'dark' && window.matchMedia('(prefers-color-scheme: light)').matches);
  document.documentElement.dataset.theme = light ? 'light' : 'dark';
})();
