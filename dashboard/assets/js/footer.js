const FOOTER_START_YEAR = 2026;

function copyrightYears() {
  const year = new Date().getFullYear();
  return year > FOOTER_START_YEAR
    ? `${FOOTER_START_YEAR} - ${year}`
    : String(FOOTER_START_YEAR);
}

function initSiteFooter() {
  const root = document.getElementById("site-footer");
  if (!root) return;
  root.innerHTML = `© ${copyrightYears()} <strong>PageSpeedTester</strong> • One of <a href="https://platomat.com/" target="_blank" rel="noopener">PlatoMat</a>`;
}

initSiteFooter();
