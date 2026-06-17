// Loaded after the Decap CMS bundle (window.CMS is defined by then).
// Goal: make the entry editor's live preview MIRROR the published page — i.e.
// show only the rendered body content styled like the real site, NOT the raw
// metadata fields (title, menu order, draft, SEO description/keywords) that
// Decap's default preview would otherwise dump.
(function () {
  if (!window.CMS || !CMS.registerPreviewStyle) return;

  // The site's compiled stylesheet (stable, non-fingerprinted path — see head.html).
  CMS.registerPreviewStyle("/sass/main.min.css");
  // The site's content pages render the body in a centered column with justified
  // text (theme rule `.intro p`); replicate that for the preview without the full
  // page chrome (.main/.intro wrappers aren't present in the preview iframe).
  CMS.registerPreviewStyle(
    "body{max-width:42rem;margin:0 auto;padding:1.5rem 1rem}p{text-align:justify}",
    { raw: true }
  );

  // Custom preview: render ONLY the body, matching what visitors actually see.
  // (On the live site these pages show just the markdown body — no title heading
  // and no metadata — so this is the faithful preview.)
  if (CMS.registerPreviewTemplate) {
    CMS.registerPreviewTemplate("sections", function (props) {
      var body = props.widgetFor("body");
      // Wrap in the theme's content container when a createElement helper is
      // available, so class-scoped site styles apply; otherwise fall back to the
      // bare body (still styled by the registered stylesheet + rules above).
      var create =
        (window.React && window.React.createElement) || window.h || null;
      if (create) {
        return create("section", { className: "intro" }, create("div", null, body));
      }
      return body;
    });
  }
})();
