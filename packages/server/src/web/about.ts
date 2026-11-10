function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * Plain-language "about, data, and rules" page. This is a starting template
 * written by the maintainers, not reviewed legal terms. Operators should
 * adapt it before running a public instance.
 */
export function renderAboutHtml(contactEmail?: string): string {
  const contact = contactEmail
    ? `<a href="mailto:${escapeHtml(contactEmail)}">${escapeHtml(contactEmail)}</a>`
    : "the operator of this server";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>About Lento</title>
    <style>
      body {
        margin: 0;
        background: #f4efe6;
        color: #121212;
        font-family: "Iowan Old Style", "Palatino Linotype", "Georgia", serif;
        font-size: 17px;
        line-height: 1.55;
      }
      main { max-width: 640px; margin: 0 auto; padding: 28px 18px 56px; }
      h1 { font-style: italic; font-size: 30px; margin: 0 0 4px; }
      h2 { font-size: 20px; margin: 28px 0 6px; }
      p, li { color: rgba(18, 18, 18, 0.78); }
      a { color: #d74f2a; }
    </style>
  </head>
  <body>
    <main>
      <h1>Lento</h1>
      <p>The slow network. Every word costs a breath.</p>
      <p><a href="/">Back to the feed</a></p>

      <h2>What this is</h2>
      <p>
        Lento is an experimental, open source social network that is slow on purpose. Posting
        and reacting take a moment and spend a limited energy budget. It is an early alpha:
        things can break and data can be lost.
      </p>

      <h2>What is stored</h2>
      <ul>
        <li>Your handle, and the posts, reactions, vouches, and reports you make.</li>
        <li>A trust score and an energy balance computed from that activity.</li>
        <li>Short-lived request logs with IP addresses, used to stop abuse.</li>
      </ul>
      <p>
        There is no advertising and no tracking. Your sign-in key is kept in your browser, not
        in a cookie. Posts are public: do not post anything you want kept private.
      </p>

      <h2>Agents</h2>
      <p>
        Automated accounts are allowed only when a human sponsors them. They are labeled, they
        spend their sponsor's energy, and the sponsor answers for what they do.
      </p>

      <h2>Rules</h2>
      <ul>
        <li>No harassment, threats, spam, or illegal content.</li>
        <li>No undeclared bots. Sponsor your agent or do not run it here.</li>
        <li>Accounts and content that break these rules can be removed.</li>
      </ul>

      <h2>Contact and removal requests</h2>
      <p>
        To report content, ask for your data to be removed, or raise a legal concern, contact
        ${contact}.
      </p>
    </main>
  </body>
</html>`;
}
