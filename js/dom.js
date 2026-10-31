// Small DOM helpers: el(), the confirm dialog, the status-bar probe, and where sheets mount.

// The status bar's height in real pixels. The page paints under it (black-translucent), so
// anything that measures against the viewport has to subtract it — window.innerHeight now
// INCLUDES the strip. Read off a probe because env() doesn't survive into JS; see #satProbe.
const satProbeEl = document.getElementById("satProbe");
export function safeTop() { return parseFloat(getComputedStyle(satProbeEl).paddingTop) || 0; }

// ---------- DOM helpers ----------
export function el(tag, attrs, ...children) {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") node.className = v;
      else if (k === "style") Object.assign(node.style, v);
      else if (k.startsWith("on")) node.addEventListener(k.slice(2).toLowerCase(), v);
      else node.setAttribute(k, v);
    }
  }
  for (const c of children) {
    if (c == null) continue;
    node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return node;
}

// ---------- confirm dialog ----------
export function confirmAction(message, okLabel, onConfirm) {
  const ov = el("div", { class: "confirm-overlay", onclick: () => ov.remove() });
  ov.appendChild(el("div", { class: "confirm-box", onclick: e => e.stopPropagation() },
    el("p", null, message),
    el("div", { class: "confirm-actions" },
      el("button", { class: "confirm-cancel", onclick: () => ov.remove() }, "Cancel"),
      el("button", { class: "confirm-ok", onclick: () => { ov.remove(); onConfirm(); } }, okLabel)
    )));
  document.body.appendChild(ov);
}

// where every sheet mounts
export const sheetRoot = document.getElementById("sheetRoot");
