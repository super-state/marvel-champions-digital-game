/**
 * "Report a bug" in the table's menu (Adam, 2026-11-25: "players should always be able to submit feedback... capture
 * the moment... submitted into GitHub issues"). The menu turns into a box to type in; Send posts the words with the
 * moment (`capture.ts`) to `/api/reports`:
 *
 * - on the test site, the site keeps it (site-api.ts) and `pnpm table:reports` files it as a GitHub issue;
 * - on Adam's own dev table, the dev server files it straight away (`vite-battle-report.ts`).
 *
 * It lives inside the menu dialog rather than a dialog of its own, so the table's keys (Enter, Ctrl+Space, Ctrl+Z) and
 * the controller already leave it alone while the menu is open, and Escape puts the menu away as always. What was typed
 * stays in the box until it is sent.
 */
import "./report.css";
import { TEXT_LIMIT, type ReportMoment } from "./moment.js";

export interface ReportOptions {
  /** The table's menu dialog. */
  menu: HTMLDialogElement;
  /** Reads the moment off the table. */
  capture: () => ReportMoment;
}

function make<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = ""): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

/** Sends a report; the answer's words for the player. */
export async function sendReport(text: string, moment: ReportMoment): Promise<{ ok: boolean; message: string }> {
  try {
    const response = await fetch("/api/reports", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, moment }),
    });
    const answer = (await response.json().catch(() => ({}))) as { error?: string };
    if (response.ok)
      return { ok: true, message: "Thanks: that's sent. It goes straight to the people making the game." };
    return { ok: false, message: answer.error ?? "That didn't send. Try again in a moment." };
  } catch {
    return { ok: false, message: "That didn't send: check the connection and try again." };
  }
}

export function installReport({ menu, capture }: ReportOptions): void {
  // At the foot of the menu, under the settings: always there, out of the way of Resume and New game.
  const open = make("button", "btn btn-ghost menu-report", "Report a bug");
  open.type = "button";
  open.id = "menu-report";
  const foot = make("div", "menu-foot");
  foot.append(open);
  menu.append(foot);

  const panel = make("form", "report-panel");
  panel.id = "report-panel";
  panel.hidden = true;
  panel.noValidate = true;
  const heading = make("h3", "report-title", "Report a bug");
  heading.id = "report-title";
  const help = make(
    "p",
    "report-help",
    "What happened, and what did you expect? Ideas welcome too. What's on the table right now is sent with it.",
  );
  help.id = "report-help";
  const box = make("textarea", "report-text");
  box.id = "report-text";
  Object.assign(box, { rows: 6, maxLength: TEXT_LIMIT, spellcheck: true });
  box.placeholder = "e.g. I played Web-Shooter but it didn't stop the attack…";
  box.setAttribute("aria-labelledby", "report-title");
  box.setAttribute("aria-describedby", "report-help");
  const status = make("p", "report-status");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const send = make("button", "btn btn-primary", "Send");
  send.type = "submit";
  send.id = "report-send";
  const back = make("button", "btn btn-ghost", "Back");
  back.type = "button";
  back.id = "report-back";
  const buttons = make("div", "report-actions");
  buttons.append(back, send);
  panel.append(heading, help, box, status, buttons);
  menu.append(panel);

  /** The moment, read as the player opened the box: the table can't move under an open menu. */
  let moment: ReportMoment | null = null;
  let sent = false;

  const paint = () => {
    send.disabled = !box.value.trim();
  };
  const show = (reporting: boolean) => {
    menu.toggleAttribute("data-reporting", reporting);
    panel.hidden = !reporting;
    if (reporting) {
      try {
        moment = capture();
      } catch (error) {
        console.error("Report a bug: couldn't read the table", error);
        moment = null;
      }
      sent = false;
      status.textContent = "";
      send.hidden = false;
      back.textContent = "Back";
      paint();
      box.focus();
    } else open.focus({ preventScroll: true });
  };

  open.onclick = () => show(true);
  back.onclick = () => {
    if (sent) menu.close();
    else show(false);
  };
  box.oninput = paint;
  // Ctrl+Enter sends, as in most places people type a message; Enter alone is a new line.
  box.onkeydown = (event) => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      panel.requestSubmit();
    }
  };
  panel.onsubmit = async (event) => {
    event.preventDefault();
    const text = box.value.trim();
    if (!text || send.disabled) return;
    send.disabled = true;
    status.removeAttribute("data-error");
    status.textContent = "Sending…";
    const result = await sendReport(text, moment ?? capture());
    status.textContent = result.message;
    if (result.ok) {
      sent = true;
      box.value = "";
      send.hidden = true;
      back.textContent = "Back to the game";
      back.focus();
    } else {
      status.setAttribute("data-error", "");
      paint();
    }
  };
  // The menu always opens on its own choices; a sent report's thanks doesn't stay for next time.
  menu.addEventListener("close", () => {
    if (!panel.hidden) {
      menu.removeAttribute("data-reporting");
      panel.hidden = true;
    }
    if (sent) status.textContent = "";
  });
}
