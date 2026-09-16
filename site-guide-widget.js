/*! Site Guide — floating chat for Discount Peptides (not Elfsight-branded). */
(function () {
  "use strict";

  const PAGE = (function () {
    const p = (location.pathname || "").toLowerCase();
    if (p.endsWith("testing.html") || p.includes("/testing")) return "testing";
    if (p.endsWith("suppliers.html") || p.includes("/suppliers")) return "suppliers";
    return "home";
  })();

  const GREETINGS = {
    home: {
      welcome:
        "Hi — I can help you find a peptide on this catalog, compare prices, or point you to testing notes and suppliers. Research use only; I don’t give dosing or medical advice.",
      pills: ["Find a peptide", "Compare prices", "What does testing mean?", "Go to suppliers"],
    },
    testing: {
      welcome:
        "You’re on the testing page. I can explain what a COA can (and can’t) prove, how vendor tiers work on this site, or pull research notes for a named peptide. No dosing, no medical advice.",
      pills: ["What can a COA prove?", "Vendor testing tiers", "Ask about a peptide", "Back to price list"],
    },
    suppliers: {
      welcome:
        "You’re on the suppliers page. I can list who’s on the site, summarize shipping/payment from our supplier notes, or send you to testing tiers and the price list. Catalog facts only — no vendor hype.",
      pills: ["List suppliers", "Ask about a vendor", "See testing tiers", "Back to peptides"],
    },
  };

  const CSS = `
#sg-root{all:initial;position:fixed;z-index:99999;right:18px;bottom:18px;font-family:'IBM Plex Sans',system-ui,sans-serif;color:#F2F3F1}
#sg-root *{box-sizing:border-box}
#sg-launcher{
  width:56px;height:56px;border-radius:50%;border:1.5px solid #3ED9A6;
  background:#171B19;color:#3ED9A6;cursor:pointer;
  box-shadow:0 8px 28px rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;
  transition:transform .15s ease,background .15s ease
}
#sg-launcher:hover{background:#132420;transform:scale(1.04)}
#sg-launcher svg{width:26px;height:26px;fill:none;stroke:#3ED9A6;stroke-width:1.8}
#sg-panel{
  display:none;position:absolute;right:0;bottom:68px;width:min(380px,calc(100vw - 28px));
  height:min(520px,calc(100vh - 100px));background:#171B19;border:1.5px solid #24302B;
  border-radius:14px;overflow:hidden;box-shadow:0 16px 48px rgba(0,0,0,.55);
  flex-direction:column
}
#sg-root.open #sg-panel{display:flex}
#sg-root.open #sg-launcher{border-color:#8A9490;color:#8A9490}
#sg-head{
  display:flex;align-items:center;justify-content:space-between;gap:8px;
  padding:12px 14px;border-bottom:1px solid #24302B;background:#0E1211
}
#sg-head strong{font-family:'Fraunces',Georgia,serif;font-weight:500;font-size:16px;color:#F2F3F1}
#sg-head span{font-size:11px;color:#8A9490;font-family:'IBM Plex Mono',monospace}
#sg-close{
  background:transparent;border:0;color:#8A9490;font-size:20px;line-height:1;cursor:pointer;padding:4px 6px
}
#sg-close:hover{color:#F2F3F1}
#sg-msgs{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:10px}
.sg-msg{max-width:92%;padding:10px 12px;border-radius:12px;font-size:13.5px;line-height:1.45;white-space:pre-wrap;word-break:break-word}
.sg-msg.bot{align-self:flex-start;background:#0E1211;border:1px solid #24302B;color:#F2F3F1}
.sg-msg.user{align-self:flex-end;background:#132420;border:1px solid #2DA37D;color:#F2F3F1}
.sg-msg a{color:#3ED9A6}
#sg-pills{display:flex;flex-wrap:wrap;gap:6px;padding:0 12px 10px}
.sg-pill{
  border:1px solid #2DA37D;background:transparent;color:#3ED9A6;border-radius:999px;
  padding:6px 10px;font-size:12px;cursor:pointer;font-family:'IBM Plex Mono',monospace
}
.sg-pill:hover{background:#132420}
#sg-form{display:flex;gap:8px;padding:10px 12px;border-top:1px solid #24302B;background:#0E1211}
#sg-input{
  flex:1;border:1.5px solid #24302B;border-radius:10px;background:#171B19;color:#F2F3F1;
  padding:10px 12px;font-size:13.5px;font-family:inherit;outline:none
}
#sg-input:focus{border-color:#3ED9A6}
#sg-send{
  border:1.5px solid #3ED9A6;background:#3ED9A6;color:#0E1211;border-radius:10px;
  padding:0 14px;font-weight:600;cursor:pointer;font-family:'IBM Plex Mono',monospace;font-size:12px
}
#sg-send:disabled{opacity:.5;cursor:wait}
#sg-foot{padding:6px 12px 10px;font-size:10px;color:#8A9490;text-align:center}
@media (max-width:420px){
  #sg-root{right:10px;bottom:10px}
  #sg-panel{height:min(70vh,560px)}
}
`;

  function el(tag, attrs, html) {
    const n = document.createElement(tag);
    if (attrs) Object.entries(attrs).forEach(([k, v]) => {
      if (k === "className") n.className = v;
      else if (k === "text") n.textContent = v;
      else n.setAttribute(k, v);
    });
    if (html != null) n.innerHTML = html;
    return n;
  }

  function linkify(text) {
    const esc = text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    return esc.replace(
      /(https?:\/\/[^\s]+|(?:index|testing|suppliers|about)\.html)/g,
      (m) => `<a href="${m.startsWith("http") ? m : "/" + m.replace(/^\//, "")}" target="_blank" rel="noopener">${m}</a>`
    );
  }

  const root = el("div", { id: "sg-root", "aria-live": "polite" });
  const style = el("style", null, CSS);
  document.head.appendChild(style);

  const launcher = el("button", {
    id: "sg-launcher",
    type: "button",
    "aria-label": "Open Site Guide",
  }, `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6.5C4 5.1 5.1 4 6.5 4h11C18.9 4 20 5.1 20 6.5v7c0 1.4-1.1 2.5-2.5 2.5H11l-4 3.5V16H6.5C5.1 16 4 14.9 4 13.5v-7z"/><path d="M8 9h8M8 12h5"/></svg>`);

  const panel = el("div", { id: "sg-panel", role: "dialog", "aria-label": "Site Guide" });
  const head = el("div", { id: "sg-head" });
  head.appendChild(el("div", null, `<strong>Site Guide</strong><br><span>catalog · research notes</span>`));
  const closeBtn = el("button", { id: "sg-close", type: "button", "aria-label": "Close" }, "×");
  head.appendChild(closeBtn);

  const msgs = el("div", { id: "sg-msgs" });
  const pills = el("div", { id: "sg-pills" });
  const form = el("form", { id: "sg-form" });
  const input = el("input", {
    id: "sg-input",
    type: "text",
    placeholder: "Ask about a peptide…",
    autocomplete: "off",
    maxlength: "500",
  });
  const send = el("button", { id: "sg-send", type: "submit" }, "Send");
  form.appendChild(input);
  form.appendChild(send);
  const foot = el("div", { id: "sg-foot" }, "Research use only · not medical advice");

  panel.appendChild(head);
  panel.appendChild(msgs);
  panel.appendChild(pills);
  panel.appendChild(form);
  panel.appendChild(foot);
  root.appendChild(panel);
  root.appendChild(launcher);
  document.body.appendChild(root);

  const g = GREETINGS[PAGE] || GREETINGS.home;

  function addMsg(role, text) {
    const m = el("div", { className: "sg-msg " + role });
    m.innerHTML = linkify(text);
    msgs.appendChild(m);
    msgs.scrollTop = msgs.scrollHeight;
  }

  function setPills(list) {
    pills.innerHTML = "";
    list.forEach((label) => {
      const b = el("button", { type: "button", className: "sg-pill", text: label });
      b.addEventListener("click", () => ask(label));
      pills.appendChild(b);
    });
  }

  addMsg("bot", g.welcome);
  setPills(g.pills);

  function toggle(open) {
    const on = open == null ? !root.classList.contains("open") : open;
    root.classList.toggle("open", on);
    launcher.setAttribute("aria-label", on ? "Close Site Guide" : "Open Site Guide");
    if (on) setTimeout(() => input.focus(), 50);
  }
  launcher.addEventListener("click", () => toggle());
  closeBtn.addEventListener("click", () => toggle(false));

  let busy = false;
  async function ask(text) {
    const q = String(text || "").trim();
    if (!q || busy) return;
    busy = true;
    send.disabled = true;
    addMsg("user", q);
    pills.innerHTML = "";
    try {
      const res = await fetch("/api/site-guide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: q, page: PAGE }),
      });
      const data = await res.json().catch(() => ({}));
      addMsg("bot", data.reply || "Something went wrong — try again, or browse the catalog.");
    } catch (e) {
      addMsg("bot", "Couldn’t reach Site Guide. Check your connection, or use the price / testing / suppliers pages directly.");
    } finally {
      busy = false;
      send.disabled = false;
      input.value = "";
      input.focus();
    }
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    ask(input.value);
  });
})();
