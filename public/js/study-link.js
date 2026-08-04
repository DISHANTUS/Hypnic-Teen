// Shows the IELTS link only when Hypnic Study is actually running.
//
// Study is a separate app on port 3000, launched alongside the studio. It
// signs people in with the same Hypnic ID, so it belongs in the top nav
// rather than being something you have to be told about.
//
// The address is built from whatever host the page was opened on, so a friend
// on the WiFi gets their own reachable URL instead of a localhost link that
// only works on this laptop. A dead link in the nav is worse than no link, so
// it stays hidden until Study answers.

(() => {
  const STUDY_PORT = 3000;
  const link = document.getElementById('studyLink');
  if (!link) return;

  const url = `${location.protocol}//${location.hostname}:${STUDY_PORT}`;

  // A HEAD request to a Next dev server is enough to know it is up, and
  // no-cors keeps it quiet in the console when it is not.
  fetch(url, { method: 'HEAD', mode: 'no-cors', signal: AbortSignal.timeout(2500) })
    .then(() => {
      link.href = url;
      link.hidden = false;
    })
    .catch(() => {
      /* Study is not running tonight; the nav simply does not mention it. */
    });
})();
