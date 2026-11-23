/**
 * The shipped version in the table's corner, so a friend's bug report says which version they played. Only builds made
 * by `pnpm table:ship` carry a version (`VITE_TABLE_VERSION`); Adam's own dev table shows nothing.
 */
const version = import.meta.env.VITE_TABLE_VERSION;

if (version) {
  const badge = document.createElement("div");
  badge.className = "table-version";
  badge.textContent = `v${version}`;
  badge.setAttribute("aria-label", `Version ${version}`);
  Object.assign(badge.style, {
    position: "fixed",
    left: "8px",
    bottom: "6px",
    zIndex: "5",
    font: "11px/1 system-ui, sans-serif",
    letterSpacing: "0.04em",
    color: "rgba(216, 226, 236, 0.45)",
    pointerEvents: "none",
    userSelect: "none",
  });
  document.body.append(badge);
}
