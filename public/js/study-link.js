// Shows the IELTS link only when Hypnic Study is actually reachable.
//
// Study is a separate app on port 3000, launched alongside the studio. It
// signs people in with the same Hypnic ID, so it belongs in the top nav rather
// than being something you have to be told about.
//
// Asking the studio rather than probing the port directly, because the browser
// cannot answer this honestly:
//
//   a cross-origin fetch to another port comes back opaque — it resolves
//     whether Study answered, returned a 404, or was some unrelated program
//     that happened to be listening
//   on a page served over the tunnel the probe is blocked as mixed content
//     before it is sent, so the answer is always "no" for the wrong reason
//
// The studio is on the same machine as Study and can simply look. It also
// knows whether *this* visitor could reach it: a second port on the laptop is
// only reachable from the same WiFi, never through the tunnel, so a friend who
// joined from another city must not be shown a link that will hang.

(() => {
  const link = document.getElementById('studyLink');
  if (!link) return;

  fetch('/api/study', { signal: AbortSignal.timeout(6000) })
    .then((r) => r.json())
    .then(({ reachable, url }) => {
      if (!reachable || !url) return; // a dead link in the nav is worse than none
      link.href = url;
      link.hidden = false;
    })
    .catch(() => {
      /* Study is not running tonight; the nav simply does not mention it. */
    });
})();
