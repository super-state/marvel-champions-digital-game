/**
 * Read the current wording, examine the scan, or look up a card's live state. All three pages share the same
 * controls and the same model. Reading a card during a decision leaves that decision open underneath the reader.
 */
import Phaser from "phaser";
import type { AnyCard, CardId } from "@mc/content";
import { cardOf, getInstance, type InstanceId } from "@mc/engine";
import { cardArt } from "../art/card-art.js";
import type { ArtSource, CardFace } from "../art/art-source.js";
import { gameDeps } from "../content/game-deps.js";
import { currentCardsById } from "../content/pool.js";
import { guidePrefs } from "../guide/guide-store.js";
import { t } from "../i18n/translate.js";
import { onLanguageChange } from "../language-change.js";
import { cardPlaySectionOf, deckInsightsNow, type CardPlaySection } from "../progression/card-play.js";
import { activeReplay } from "../replay/replay-mode.js";
import { appSession } from "../session.js";
import { surface, tabletop, typeRole } from "../tokens.js";
import { drawReadingText, drawReadingDetails, drawReadingScan } from "../ui/card-reader.js";
import { destroyChildren } from "../ui/destroy-children.js";
import { GuideStampGlide } from "../ui/guide-glide-run.js";
import { drawGuideStrip, GUIDE_STRIP_HEIGHT } from "../ui/guide-strip.js";
import type { GlyphHints } from "../ui/glyph-hints.js";
import { McScrollRegion } from "../ui/scroll-region.js";
import { cssOf, textStyle } from "../ui/theme.js";
import { OverlayMotion } from "../ui/transitions.js";
import { McButton, fitText, type McButtonOptions } from "../ui/widgets.js";
import { faceOf } from "../view/board-model.js";
import { emptyCardHistoryLog } from "../view/card-history.js";
import type { ReaderPage } from "../view/card-reading.js";
import { readingLayout } from "../view/inspect-layout.js";
import { cardSideToggle, printedIdentitySide, type CardSideToggle } from "../view/card-side-toggle.js";
import type { GamepadIntent } from "../view/gamepad.js";
import { legalEntriesOf } from "../view/highlights.js";
import {
  cardInspectModel,
  referenceInspectModel,
  inspectModel,
  type InspectModel,
  type InspectPayment,
} from "../view/inspect-model.js";
import { tuckedSiblings } from "../view/inspect-notes.js";
import { formFactorFor, isTabbed, type Rect } from "../view/layout.js";
import { pickedCardOf } from "../view/payment-model.js";
import { POOL_STATS_NAMES } from "../view/player-stats-names.js";
import { PressArm } from "../view/press-arm.js";
import { tableGame } from "../view/table-game.js";
import { VariableListScroll } from "../view/variable-list-scroll.js";
import type { BoardScene } from "./board.js";
import { bindGamepad, bindKeyboard } from "./board/input.js";
import { createHints } from "./campaign/pad-hints.js";
import { SCENES } from "./keys.js";
import type { RulesSceneData } from "./rules.js";

/** What the caller hands over when it launches this overlay. */
export interface InspectData {
  /** A card in play or in hand. Omitted before a game exists. */
  readonly instanceId?: InstanceId;
  /**
   * A card with no game behind it — the Title screen's pickers. The face is
   * explicit because a villain's picture and text live on its stage and a
   * hero's on its hero side.
   */
  readonly card?: { readonly cardId: CardId; readonly face: CardFace };
  /** A scenario's printed rules card (`Scenario.referenceCards`): no card record, no game behind the sheet. */
  readonly reference?: { readonly title: string; readonly text: string; readonly art: ArtSource | null };
  /** Cards the ◂ ▸ keys step through — the hand, when inspect was opened from it. */
  readonly siblings?: readonly InstanceId[];
  /**
   * Set when the sheet was opened from an open decision. The card is then an
   * *answer*, not a card on the table, so the sheet offers that answer directly
   * — which is the whole point of blowing it up on a phone, where the option
   * itself is a thumbnail in a stack.
   */
  readonly choice?: {
    readonly optionId: string;
    /** "Select" or "Deselect": the caller knows which, this scene doesn't. */
    readonly label: string;
  };
  /**
   * Shown where the choice buttons would be, when the card can be read but not
   * chosen — "Captain Marvel is already at the table". The card is still worth
   * opening: reading it is how the player finds out why.
   */
  readonly note?: string;
}

interface ReaderStop {
  id: string;
  rect: Rect;
  inScroll?: boolean;
  run(): void;
}
interface ReaderAction {
  label: string;
  run(): void;
  enabled?: boolean;
  reason?: string;
  guide?: boolean;
}

const PAGES: readonly ReaderPage[] = ["text", "scan", "details"];
const BUTTON_TYPE = { ...typeRole.body, size: 15, weight: 700 } as const;

export class InspectOverlay extends Phaser.Scene {
  #instanceId: InstanceId | null = null;
  #siblings: readonly InstanceId[] = [];
  #choice: InspectData["choice"] = undefined;
  #card: InspectData["card"] = undefined;
  #reference: InspectData["reference"] = undefined;
  #note: string | undefined;
  #page: ReaderPage = "text";
  #actionsOpen = false;
  #sideStep = 0;
  #sheetScroll = new VariableListScroll();
  #sheetRegion: McScrollRegion | null = null;
  #stops: ReaderStop[] = [];
  #focus: string | null = null;
  #ring: Phaser.GameObjects.Graphics | null = null;
  #primaryAction: (() => void) | null = null;
  #dismissArm = new PressArm();
  #motion = new OverlayMotion();
  #hints!: GlyphHints;
  #guidePickInstanceId: InstanceId | null = null;
  #guideStamp = new GuideStampGlide();
  #lastPlayRect: Rect | null = null;

  constructor() {
    super({ key: SCENES.inspect });
  }

  /** "Your play" for this card (#529): what your finished games say about it, once the stats worker has answered. */
  #yourPlay: CardPlaySection | null = null;

  /** The card and hero "Your play" is about: a player card, with its owner's hero in a game. Null for anything else. */
  #playSubject(): { readonly cardId: string; readonly identityCardId: string | null } | null {
    if (this.#reference) return null;
    if (this.#card) return { cardId: this.#card.cardId as string, identityCardId: null };
    const game = tableGame(appSession().store.state.game);
    if (!game || !this.#instanceId) return null;
    const instance = getInstance(game, this.#instanceId);
    if (!instance?.ownerId) return null;
    const owner = game.players.find((player) => player.playerId === instance.ownerId);
    return {
      cardId: instance.cardId as string,
      identityCardId: (owner?.identity.cardId as string | undefined) ?? null,
    };
  }

  /** Reads "Your play" for the card now shown, and draws it in when it arrives (the sheet may have moved on). */
  #loadYourPlay(): void {
    this.#yourPlay = null;
    const subject = this.#playSubject();
    if (!subject) return;
    void deckInsightsNow(() => appSession().store.listSaves()).then(
      (insights) => {
        const now = this.#playSubject();
        if (!this.sys.isActive() || now?.cardId !== subject.cardId) return;
        this.#yourPlay = cardPlaySectionOf(insights, subject.cardId, subject.identityCardId, POOL_STATS_NAMES);
        if (this.#yourPlay) this.#rebuild();
      },
      () => undefined,
    );
  }

  create(data: InspectData): void {
    this.#guideStamp = new GuideStampGlide();
    this.#instanceId = data.instanceId ?? null;
    const game = tableGame(appSession().store.state.game);
    this.#siblings =
      data.siblings ??
      (game && data.instanceId && !data.choice && !data.card ? [...tuckedSiblings(game, data.instanceId)] : []);
    this.#choice = data.choice;
    this.#card = data.card;
    this.#reference = data.reference;
    this.#note = data.note;
    this.#resetCard();
    this.#motion = new OverlayMotion();
    this.#hints = createHints(this);
    const { store } = appSession();
    const rebuild = () => this.#rebuild();
    const offStore = !data.card && !data.reference ? store.subscribe(rebuild) : undefined;
    const offArt = cardArt(this).onArrived(rebuild);
    const offLanguage = onLanguageChange(rebuild);
    this.scale.on("resize", rebuild);
    const binding = {
      blocked: () => this.#motion.leaving,
      onIntent: (intent: GamepadIntent) => this.#onIntent(intent),
      onScroll: (_dx: number, dy: number) => {
        this.#sheetRegion?.scrollByPx(dy);
        this.#drawFocus();
      },
    };
    bindKeyboard(this, binding);
    bindGamepad(this, binding);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off("resize", rebuild);
      offArt();
      offLanguage();
      offStore?.();
      this.#sheetRegion?.destroy();
      this.#sheetRegion = null;
      if (import.meta.env.DEV) delete (window as unknown as { __mcInspectDebug?: unknown }).__mcInspectDebug;
    });
    if (import.meta.env.DEV) {
      (window as unknown as { __mcInspectDebug?: unknown }).__mcInspectDebug = {
        playRect: () => this.#lastPlayRect,
        guidePickInstanceId: () => this.#guidePickInstanceId,
        guideStampRect: () => this.#guideStamp.shownRect(this),
        page: () => this.#page,
        stops: () => this.#stops.map((s) => [s.id, this.#stopRect(s)]),
      };
    }
    this.#loadYourPlay();
    this.#rebuild();
  }

  #resetCard(): void {
    this.#actionsOpen = false;
    this.#page = "text";
    this.#sideStep = 0;
    this.#sheetScroll.reset();
    this.#focus = null;
  }

  #close(): void {
    this.#motion.exit(this, () => this.scene.stop());
  }

  #showPage(page: ReaderPage): void {
    if (this.#page === page && !this.#actionsOpen) return;
    this.#actionsOpen = false;
    this.#page = page;
    this.#focus = this.#focus ? page : null;
    this.#sheetScroll.reset();
    this.#rebuild();
  }

  #stopRect(stop: ReaderStop): Rect {
    return stop.inScroll ? { ...stop.rect, y: stop.rect.y - this.#sheetScroll.offsetPx } : stop.rect;
  }

  #drawFocus(): void {
    const ring = this.#ring;
    if (!ring) return;
    ring.clear();
    const stop = this.#stops.find((s) => s.id === this.#focus);
    if (!stop) return;
    const r = this.#stopRect(stop);
    const view = this.#sheetRegion?.rect;
    if (stop.inScroll && view && (r.y < view.y || r.y + r.height > view.y + view.height)) return;
    ring.lineStyle(3, tabletop.gold).strokeRoundedRect(r.x + 2, r.y + 2, r.width - 4, r.height - 4, 5);
    ring.lineStyle(1, tabletop.shadow).strokeRoundedRect(r.x + 4, r.y + 4, r.width - 8, r.height - 8, 4);
  }

  #cycleFocus(step: number): void {
    const controls = this.#stops;
    if (!controls.length) return;
    const at = controls.findIndex((s) => s.id === this.#focus);
    const target =
      controls[at < 0 ? (step > 0 ? 0 : controls.length - 1) : (at + step + controls.length) % controls.length]!;
    this.#focus = target.id;
    if (target.inScroll && this.#sheetRegion) {
      const r = this.#stopRect(target),
        view = this.#sheetRegion.rect;
      if (r.y < view.y) this.#sheetRegion.scrollByPx(r.y - view.y);
      else if (r.y + r.height > view.y + view.height)
        this.#sheetRegion.scrollByPx(r.y + r.height - view.y - view.height);
    }
    this.#drawFocus();
  }

  #onIntent(intent: GamepadIntent): void {
    switch (intent) {
      case "next":
      case "down":
        this.#cycleFocus(1);
        break;
      case "previous":
      case "up":
        this.#cycleFocus(-1);
        break;
      case "left":
      case "right": {
        const dir = intent === "right" ? 1 : -1;
        if (this.#siblings.length > 1) this.#step(dir);
        else this.#cycleFocus(dir);
        break;
      }
      case "pageNext":
      case "pagePrevious": {
        const offset = intent === "pageNext" ? 1 : -1;
        if (this.#sheetRegion) this.#sheetRegion.scrollByPx(offset * this.#sheetRegion.rect.height * 0.8);
        else this.#cycleFocus(offset);
        this.#drawFocus();
        break;
      }
      case "home":
        this.#sheetRegion?.scrollByPx(-1e6);
        this.#drawFocus();
        break;
      case "end":
        this.#sheetRegion?.scrollByPx(1e6);
        this.#drawFocus();
        break;
      case "activate": {
        const stop = this.#stops.find((s) => s.id === this.#focus);
        if (stop) stop.run();
        else this.#primaryAction?.();
        break;
      }
      case "cancel":
        this.#close();
        break;
      case "inspect":
        if (!this.#model()?.hidden && this.#sideToggle()) this.#stepSide();
        break;
      default:
        break;
    }
  }

  #openCard(id: InstanceId): void {
    if (id === this.#instanceId) return;
    const game = tableGame(appSession().store.state.game);
    if (!this.#siblings.includes(id) && game) this.#siblings = [...tuckedSiblings(game, id)];
    this.#instanceId = id;
    this.#resetCard();
    this.#loadYourPlay();
    this.#rebuild();
  }

  #step(direction: number): void {
    if (this.#siblings.length < 2 || !this.#instanceId) return;
    const idx = this.#siblings.indexOf(this.#instanceId);
    const next = this.#siblings[(idx + direction + this.#siblings.length) % this.#siblings.length];
    if (idx >= 0 && next) this.#openCard(next);
  }

  /** The live Board scene, when one is running underneath — the source of the card-history fold and the open payment, neither of which lives on the store. */
  #boardScene(): BoardScene | null {
    if (!this.scene.isActive(SCENES.board)) return null;
    return this.scene.get(SCENES.board) as BoardScene;
  }

  /** `BoardGuideMount#syncInspectPick`'s own hook (guided mode G7b) — see `#guidePickInstanceId`'s own doc
   * comment. Idempotent; only rebuilds when the value actually changes, same as `ChoiceOverlay#setGuidePick`. */
  setGuidePick(instanceId: InstanceId | null): void {
    if (this.#guidePickInstanceId === instanceId) return;
    this.#guidePickInstanceId = instanceId;
    if (this.scene.isActive(SCENES.inspect)) this.#rebuild();
  }

  #drawGuideStamp(playRect: Rect): void {
    this.#guideStamp.draw(this, "tryThis", playRect, this.#boardScene()?.guideHighlightRect() ?? null);
  }

  /** True while this sheet's own subject is the card the guide wants a `TRY THIS` stamp/strip on. */
  #isGuidePick(): boolean {
    return this.#guidePickInstanceId !== null && this.#instanceId === this.#guidePickInstanceId;
  }

  #button(id: string, opts: McButtonOptions, inScroll = false): McButton {
    const control = new McButton(this, opts);
    if (opts.enabled !== false) this.#stops.push({ id, rect: opts.rect, run: opts.onClick, inScroll });
    return control;
  }

  #rebuild(): void {
    if (this.#motion.leaving) return;
    const model = this.#model();
    if (!model) return;
    // While a decision is open the villain sequence re-raises its choice. The deliberately opened reader wins until closed.
    this.scene.bringToTop(SCENES.inspect);
    this.#sheetRegion?.destroy();
    this.#sheetRegion = null;
    this.#hints.reset();
    destroyChildren(this);
    this.#ring = null;
    this.#stops = [];
    this.#primaryAction = null;
    this.#lastPlayRect = null;
    this.#dismissArm = new PressArm();
    const { width, height } = this.scale.gameSize;
    const guideStrip =
      this.#isGuidePick() && isTabbed(formFactorFor(width, height)) ? this.#boardScene()?.inspectStripContent() : null;
    const actions = this.#actions(model);
    if (actions.length < 2) this.#actionsOpen = false;
    const side = model.hidden ? null : this.#sideToggle();
    const layout = readingLayout(
      width,
      height - (guideStrip ? GUIDE_STRIP_HEIGHT : 0),
      Boolean(actions.length || side),
    );
    const { frame, header, tabs, footer, body } = layout;
    const scrim = this.add.graphics().fillStyle(tabletop.shadow, 0.83).fillRect(0, 0, width, height);
    this.add
      .zone(0, 0, width, height)
      .setOrigin(0)
      .setInteractive()
      .on("pointerdown", () => this.#dismissArm.down())
      .on("pointerup", () => {
        if (this.#dismissArm.up()) this.#close();
      });
    const from = this.children.list.length;
    const g = this.add.graphics();
    g.fillStyle(tabletop.rail).fillRoundedRect(frame.x, frame.y, frame.width, frame.height, layout.compact ? 0 : 10);
    g.fillStyle(tabletop.brass).fillRect(header.x, header.y, header.width, 3);
    this.add.zone(frame.x, frame.y, frame.width, frame.height).setOrigin(0).setInteractive();

    const pad = layout.compact ? 8 : 15;
    const right = header.x + header.width - pad;
    const h = 44,
      cy = header.y + (header.height - h) / 2;
    const close = this.#button("close", {
      kind: "tableAction",
      label: t("reader.close"),
      type: BUTTON_TYPE,
      rect: { x: right - 74, y: cy, width: 74, height: h },
      onClick: () => this.#close(),
    });
    this.#hints.button(close, ["cancel"], "ink", { when: (set) => set === "pad" });
    const stepping =
      this.#siblings.length > 1 && this.#instanceId !== null && this.#siblings.includes(this.#instanceId);
    let titleEnd = close.rect.x - 8;
    if (stepping) {
      const at = this.#siblings.indexOf(this.#instanceId!);
      const count = at + 1 + " / " + this.#siblings.length;
      const countWidth = layout.compact ? 42 : 55;
      const navWidth = layout.compact ? h : 124;
      const navX = titleEnd - navWidth * 2 - countWidth;
      const stepButton = (id: string, word: string, x: number, dir: number) =>
        this.#button(id, {
          kind: "tableAction",
          label: word,
          type: { ...BUTTON_TYPE, size: layout.compact ? 22 : 14 },
          rect: { x, y: cy, width: navWidth, height: h },
          onClick: () => this.#step(dir),
        });
      stepButton("previous", layout.compact ? "‹" : "‹  " + t("reader.previous"), navX, -1);
      this.add
        .text(navX + navWidth + countWidth / 2, cy + h / 2, count, textStyle(BUTTON_TYPE, tabletop.lettering))
        .setOrigin(0.5);
      stepButton("next", layout.compact ? "›" : t("reader.next") + "  ›", navX + navWidth + countWidth, 1);
      titleEnd = navX - 6;
    }
    const title = this.add
      .text(header.x + pad + 5, header.y + header.height / 2, t("reader.title"), {
        ...textStyle(typeRole.barTitle, tabletop.lettering),
        fontSize: layout.compact ? "24px" : "29px",
      })
      .setOrigin(0, 0.5);
    fitText(title, Math.max(1, titleEnd - title.x), layout.compact ? 24 : 29);

    const pages = model.art ? PAGES : PAGES.filter((page) => page !== "scan");
    const tabWidth = tabs.width / pages.length;
    pages.forEach((page, index) => {
      const box = { x: tabs.x + index * tabWidth, y: tabs.y, width: tabWidth, height: tabs.height };
      this.#button(page, {
        kind: "tableAction",
        label: t(`reader.${page}`),
        rect: box,
        type: BUTTON_TYPE,
        selected: this.#page === page,
        onClick: () => this.#showPage(page),
      });
      if (page === this.#page)
        this.add
          .graphics()
          .fillStyle(tabletop.gold)
          .fillRect(box.x + 1, box.y + box.height - 4, box.width - 2, 3);
    });

    const note = this.#note;
    const now = this.#choice ? "" : this.#rightNowSentence(model);
    const settings = appSession().settings;
    const openScan = () => {
      if (model.art) this.#showPage("scan");
    };
    if (this.#actionsOpen && actions.length > 1) {
      this.#drawActionList(body, actions);
    } else if (this.#page === "scan") {
      drawReadingScan(this, model, body);
    } else if (this.#page === "details") {
      const attached = model.attached;
      const links = [
        ...(attached?.host ? [{ heading: t("reader.attachedTo"), cards: [attached.host] }] : []),
        ...(attached?.attachments.length ? [{ heading: t("reader.attached"), cards: attached.attachments }] : []),
      ].map((group) => ({
        heading: group.heading,
        links: group.cards.map((c) => ({ label: c.name, run: () => this.#openCard(c.instanceId) })),
      }));
      this.#sheetRegion = drawReadingDetails(this, layout, model, this.#sheetScroll, {
        now: note || now,
        how: guidePrefs().level === "off" ? null : model.howItWorks,
        yourPlay: model.hidden ? null : this.#yourPlay,
        largeText: settings.largeCardText,
        links,
        openScan,
        onScroll: () => this.#drawFocus(),
        openRules: (id) => this.#openRulesAt(id),
        registerLink: (rect, run) => this.#stops.push({ id: "link" + this.#stops.length, rect, run, inScroll: true }),
      });
    } else {
      const usefulNow = model.status.playable === false || model.priceNote || model.resourceNote ? now : "";
      this.#sheetRegion = drawReadingText(this, layout, model, this.#sheetScroll, {
        largeText: settings.largeCardText,
        smallScan: settings.inspectCard === "sideBySide",
        now: usefulNow,
        note,
        openScan,
        onScroll: () => this.#drawFocus(),
      });
    }

    if (footer.height) {
      const available = {
        x: footer.x + pad,
        y: footer.y + 8,
        width: footer.width - pad * 2,
        height: footer.height - 16,
      };
      const sideWidth = side && actions.length ? Math.min(170, available.width * 0.37) : side ? available.width : 0;
      if (side) {
        const sideBtn = this.#button("flip", {
          kind: "tableAction",
          label: side.label,
          type: BUTTON_TYPE,
          rect: { ...available, x: available.x + available.width - sideWidth, width: sideWidth },
          wrap: true,
          onClick: () => this.#stepSide(),
        });
        this.#hints.button(sideBtn, ["inspect"], "ink", { when: (set) => set === "pad" });
      }
      if (actions.length) {
        const row = { ...available, width: available.width - (sideWidth ? sideWidth + 6 : 0) };
        if (this.#actionsOpen || (actions.length > 1 && row.width / actions.length < 135) || actions.length > 3) {
          const toggle = () => {
            this.#actionsOpen = !this.#actionsOpen;
            this.#focus = null;
            this.#sheetScroll.reset();
            this.#rebuild();
          };
          this.#button("actions", {
            kind: "tableCommit",
            label: t(this.#actionsOpen ? "reader.back" : "reader.actions"),
            type: BUTTON_TYPE,
            rect: row,
            onClick: toggle,
          });
          this.#primaryAction = toggle;
        } else {
          const buttonWidth = (row.width - (actions.length - 1) * 6) / actions.length;
          actions.forEach((action, index) =>
            this.#actionButton(action, index, {
              ...row,
              x: row.x + index * (buttonWidth + 6),
              width: buttonWidth,
            }),
          );
        }
      }
    }
    this.#ring = this.add.graphics();
    this.#drawFocus();
    const panels = this.children.list.slice(from);
    this.#motion.enter(this, { scrim: [scrim], panels });
    if (guideStrip)
      drawGuideStrip(this, { x: 0, y: height - GUIDE_STRIP_HEIGHT, width, height: GUIDE_STRIP_HEIGHT }, guideStrip);
    this.cameras.main.setBackgroundColor(cssOf(surface.void.hex, 0));
  }

  #drawActionList(rect: Rect, actions: readonly ReaderAction[]): void {
    this.add.graphics().fillStyle(surface.paper.hex).fillRect(rect.x, rect.y, rect.width, rect.height);
    const start = this.children.list.length;
    const pad = 16,
      buttonHeight = 48;
    for (const [i, action] of actions.entries())
      this.#actionButton(
        action,
        i,
        {
          x: rect.x + pad,
          y: rect.y + pad + i * (buttonHeight + 8),
          width: rect.width - pad * 2,
          height: buttonHeight,
        },
        true,
      );
    const items = this.children.list.slice(start);
    this.#sheetRegion = new McScrollRegion(this, {
      rect,
      scroll: this.#sheetScroll,
      heights: [2 * pad + actions.length * (buttonHeight + 8)],
      clipInteractive: true,
    });
    this.#sheetRegion.content.add(items);
    this.#sheetRegion.syncInteractivity();
  }

  #actionButton(action: ReaderAction, index: number, rect: Rect, inScroll = false): void {
    this.#button(
      "action" + index,
      {
        kind: index === 0 ? "tableCommit" : "tableAction",
        label: action.label,
        rect,
        type: BUTTON_TYPE,
        wrap: true,
        onClick: action.run,
        ...(action.enabled === false ? { enabled: false } : {}),
        ...(action.reason ? { reason: action.reason } : {}),
      },
      inScroll,
    );
    if (!this.#primaryAction && action.enabled !== false) this.#primaryAction = action.run;
    if (action.guide && this.#isGuidePick()) {
      this.#drawGuideStamp(rect);
      this.#lastPlayRect = rect;
    }
  }

  #actions(model: InspectModel): readonly ReaderAction[] {
    if (this.#note || activeReplay()) return [];
    if (this.#choice) {
      const { optionId, label } = this.#choice;
      return [
        {
          label,
          run: () => {
            this.#close();
            this.game.events.emit("mc-choice-toggle", optionId);
          },
        },
      ];
    }
    if (model.hidden || appSession().store.state.peekSeat !== null) return [];
    if (model.abilities.length) return this.#abilityButtons(model);
    const id = this.#instanceId;
    if (!id) return [];
    const hand = this.#isHandCard();
    const actions: ReaderAction[] = [];
    if (model.status.playable === true || (hand && model.status.playable === false)) {
      const cost = model.currentCost;
      actions.push({
        label: cost === null ? t("reader.play") : t("reader.play") + "   " + cost,
        run: () => {
          this.#close();
          this.game.events.emit("mc-play-card", id);
        },
        enabled: model.status.playable === true,
        reason: model.status.message,
        guide: model.status.playable === true,
      });
    }
    if (hand && model.resourceIcons.length)
      actions.push({
        label: t("reader.use"),
        enabled: model.canPayAsResource,
        reason: t("reader.unpaid"),
        run: () => {
          this.#close();
          this.#boardScene()?.payWithCard(id);
        },
      });
    return actions;
  }

  #openRulesAt(id: string): void {
    this.#close();
    this.scene.launch(SCENES.rules, { initialTab: "glossary", initialQuery: id } satisfies RulesSceneData);
  }
  #model(): InspectModel | null {
    if (this.#reference) return referenceInspectModel(this.#reference);
    if (this.#card)
      return cardInspectModel(
        CARDS_BY_ID.get(this.#card.cardId as string),
        this.#sideToggle()?.face ?? this.#card.face,
      );
    const { store } = appSession();
    const state = store.state;
    if (!state.game || state.perspectiveId === null || !this.#instanceId) return null;
    const board = this.#boardScene();
    const paymentView = board?.paymentView() ?? null;
    const payment: InspectPayment | null = paymentView
      ? {
          subjectInstanceId: paymentView.subject,
          paid: paymentView.paid,
          required: paymentView.required,
          // By instance, not by option (`spendable` is keyed by option id since payment-model.ts's own doc comment
          // on it: several options can share one instance): "is this card usable at all", which every one of its
          // options being spendable still answers the same way.
          spendableInstanceIds: new Set(
            [...paymentView.spendable.values()].map((source) => pickedCardOf(source) ?? source.instanceId),
          ),
          notForInstanceIds: new Set(
            paymentView.tableSources.filter((source) => source.notFor).map((source) => source.instanceId),
          ),
        }
      : null;
    const game = tableGame(state.game)!;
    // An identity stepped to a side it is not on reads that side as printed (issue #532): the live sheet's stats,
    // traits and "Use" buttons are the side in play's, and would read as the other side's.
    const card = cardOf(game, this.#instanceId);
    const printedSide = printedIdentitySide(card, faceOf(game, this.#instanceId), this.#sideStep);
    if (printedSide) return cardInspectModel(card, printedSide);
    return inspectModel(game, this.#instanceId, state.legal?.actions ?? null, state.perspectiveId, gameDeps(), {
      history: board?.cardHistory() ?? emptyCardHistoryLog(),
      payment,
      ...(this.#sideStep > 0 ? this.#steppedFace() : {}),
    });
  }

  /** The side toggle for this sheet's subject (a main scheme stage, a hero identity), or null when it has none. */
  #sideToggle(): CardSideToggle | null {
    if (this.#reference) return null;
    if (this.#card)
      return cardSideToggle(CARDS_BY_ID.get(this.#card.cardId as string), this.#card.face, this.#sideStep);
    const game = tableGame(appSession().store.state.game);
    if (!game || !this.#instanceId) return null;
    return cardSideToggle(cardOf(game, this.#instanceId), faceOf(game, this.#instanceId), this.#sideStep);
  }

  /** The face an in-game card shows once its side is stepped, as `inspectModel`'s `face` option; nothing without a toggle. */
  #steppedFace(): { readonly face?: CardFace } {
    const toggle = this.#sideToggle();
    return toggle ? { face: toggle.face } : {};
  }

  #stepSide(): void {
    this.#sideStep += 1;
    this.#sheetScroll.reset();
    this.#focus = null;
    this.#rebuild();
  }

  #rightNowSentence(model: InspectModel): string {
    const sentence = [
      model.status.message,
      model.priceNote,
      model.resourceNote,
      model.status.targets.length > 0 ? `Legal targets: ${model.status.targets.join(", ")}.` : null,
    ]
      .filter((part): part is string => Boolean(part))
      // Each part ends its own sentence: the engine's reasons are clauses with no full stop of their own.
      .map((part) => (/[.!?]$/.test(part) ? part : `${part}.`))
      .join(" ");
    // The engine's reasons are written as clauses ("this event can only…"); on the sheet they stand as a sentence.
    return sentence.charAt(0).toUpperCase() + sentence.slice(1);
  }

  #abilityButtons(model: InspectModel): readonly { readonly label: string; readonly run: () => void }[] {
    const instanceId = this.#instanceId;
    const actions = appSession().store.state.legal?.actions;
    const playListed =
      instanceId !== null &&
      actions !== undefined &&
      actions !== null &&
      this.#isHandCard() &&
      legalEntriesOf(actions).some(
        (entry) => entry.action.kind === "playCard" && entry.action.instanceId === instanceId,
      );
    const play = {
      label: t("reader.play"),
      run: (): void => {
        this.#close();
        if (instanceId) this.game.events.emit("mc-play-card", instanceId);
      },
    };
    const uses = model.abilities.map((ability) => ({
      label: ability.label,
      run: (): void => {
        this.#close();
        // The identity's "play the top card of this deck" Action, offered on the deck's top card, is used on the identity.
        const source = ability.sourceInstanceId ?? instanceId;
        if (source) this.game.events.emit("mc-use-ability", source, ability.abilityId);
      },
    }));
    return playListed ? [play, ...uses] : uses;
  }

  /**
   * True when the subject is a hand card of the viewer — "dim, don't hide": USE AS RESOURCE stays visible
   * (disabled) even with no payment open for this card, rather than disappearing (D08 shows both buttons whenever
   * the card could ever be paid with, not only mid-payment).
   */
  #isHandCard(): boolean {
    const instanceId = this.#instanceId;
    if (!instanceId) return false;
    const { game, perspectiveId } = appSession().store.state;
    if (!game || perspectiveId === null) return false;
    return game.players.find((player) => player.playerId === perspectiveId)?.hand.includes(instanceId) ?? false;
  }
}

/** Every card by id (the installed packs' included), for the sheets opened before a game exists. */
const CARDS_BY_ID = { get: (id: string): AnyCard | undefined => currentCardsById().get(id) };
