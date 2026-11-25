/**
 * The deck builder on its own page (`battle/decks.html`, dev server only): the whole Core Set pool, for checking. The
 * screen itself is `deck-screen.ts`, which the room's bench also lays over the room with only what the 3D table has
 * been checked with.
 */
import "../design.css";
import { createDeckScreen } from "./deck-screen.js";

// Visible first: a hidden page can't take the focus, and keyboard and pad players start from it.
document.body.style.visibility = "visible";
createDeckScreen(document.getElementById("decks")!, { mode: "page" });
