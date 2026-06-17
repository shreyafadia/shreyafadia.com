// Loaded after the Decap CMS bundle (window.CMS is defined by then).
// Makes the entry editor's live preview pane resemble the live site by injecting
// the site's compiled stylesheet into the (isolated) preview iframe, plus a few
// layout rules that mimic the theme's content wrapper.
(function () {
  if (!window.CMS || !CMS.registerPreviewStyle) return;
  // The site's compiled stylesheet (stable, non-fingerprinted path — see head.html).
  CMS.registerPreviewStyle("/sass/main.min.css");
  // Mimic the theme's reading column + justified body text without needing the
  // site's full page chrome (.main/.intro wrappers aren't present in the preview).
  CMS.registerPreviewStyle(
    "body{max-width:42rem;margin:0 auto;padding:1.5rem 1rem}p{text-align:justify}",
    { raw: true }
  );
})();
