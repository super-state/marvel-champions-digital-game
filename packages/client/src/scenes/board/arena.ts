import Phaser from "phaser";
import { coverFit, ensurePictureLoaded } from "../../art/pictures.js";
import rooftopUrl from "../../art/tabletop/rooftop.webp?url";
import { arenaView, type ArenaView, type TablePoint } from "../../view/arena-camera.js";
import type { Rect } from "../../view/layout.js";

const ROOFTOP = { key: "board:rooftop-mat", url: rooftopUrl };
const CANVAS_PRINT = "board:rooftop-canvas";
const MAT_INSET = 0.034;
const MAT_HEIGHT = 0.013;
const CORNER = 0.045;
// Extra rows near each end carry the clipped corners. The other strips keep the perspective-correct texture
// nearly linear within each pair of triangles, even when the player looks across the table.
const ROWS = [0, 0.024, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 0.976, 1];

function perimeter(view: ArenaView, inset: number, y: number): TablePoint[] {
  const x = Math.max(CORNER, view.halfWidth - inset);
  const z = 1 - inset;
  return [
    { x: -x + CORNER, y, z: -z },
    { x: x - CORNER, y, z: -z },
    { x, y, z: -z + CORNER },
    { x, y, z: z - CORNER },
    { x: x - CORNER, y, z },
    { x: -x + CORNER, y, z },
    { x: -x, y, z: z - CORNER },
    { x: -x, y, z: -z + CORNER },
  ];
}

/** The projected left/right edge and source U range for one horizontal slice of the printed mat. */
function matRow(view: ArenaView, t: number) {
  const width = Math.max(CORNER, view.halfWidth - MAT_INSET);
  const length = 1 - MAT_INSET;
  const z = (2 * t - 1) * length;
  const cut = Math.max(0, CORNER - (length - Math.abs(z)));
  const x = width - cut;
  return {
    left: view.project({ x: -x, y: MAT_HEIGHT, z }),
    right: view.project({ x, y: MAT_HEIGHT, z }),
    uInset: cut / (2 * width),
  };
}

function paintBezel(g: Phaser.GameObjects.Graphics, view: ArenaView): void {
  g.clear();
  const project = (point: TablePoint) => new Phaser.Math.Vector2(view.project(point));
  const top = perimeter(view, 0, 0).map(project);
  const underside = perimeter(view, 0, -0.086).map(project);
  g.fillStyle(0x03090f).fillPoints(perimeter(view, -0.012, -0.13).map(project), true);
  // Extruded edge faces, lit from the upper right. The top cap occludes the far faces.
  const edgeColors = [0x243647, 0x465560, 0x394c58, 0x4d5354, 0x273543, 0x1a2935, 0x192b36, 0x263b46];
  top.forEach((point, i) => {
    const j = (i + 1) % top.length;
    g.fillStyle(edgeColors[i]!).fillPoints([point, top[j]!, underside[j]!, underside[i]!], true);
  });
  g.fillStyle(0x364c56).fillPoints(top, true);
  g.lineStyle(1.3, 0x8a9da0, 0.77).strokePoints(top, true, true);
  const brass = perimeter(view, 0.013, 0.007).map(project);
  g.fillStyle(0x84765b).fillPoints(brass, true);
  const well = perimeter(view, 0.019, 0.009).map(project);
  g.fillStyle(0x101e28).fillPoints(well, true);
  const mat = perimeter(view, MAT_INSET, MAT_HEIGHT).map(project);
  g.fillStyle(0x1a343e).fillPoints(mat, true);
  g.lineStyle(1, 0x78959a, 0.62).strokePoints(mat, true, true);
}

/** A single noninteractive display group. The scene detaches it while replacing its interactive frame. */
export class ArenaTable {
  readonly #scene: Phaser.Scene;
  readonly #root: Phaser.GameObjects.Container;
  readonly #metal: Phaser.GameObjects.Graphics;
  readonly #webgl: boolean;
  #rect: Rect | null = null;
  #mesh: Phaser.GameObjects.Mesh2D | null = null;
  #print: Phaser.Textures.CanvasTexture | null = null;
  #image: Phaser.GameObjects.Image | null = null;
  #texture: Phaser.Textures.Texture | null = null;
  #still = true;
  #lookX = 0;
  #lookY = 0;
  #targetX = 0;
  #targetY = 0;

  constructor(scene: Phaser.Scene) {
    this.#scene = scene;
    this.#root = scene.add.container().setName("Rooftop tabletop").setDepth(-100);
    this.#metal = scene.add.graphics();
    this.#root.add(this.#metal);
    this.#webgl = scene.game.renderer.type === Phaser.WEBGL;
    scene.input.on(Phaser.Input.Events.POINTER_MOVE, this.#point);
    scene.input.on(Phaser.Input.Events.GAME_OUT, this.#center);
  }

  detach(): void {
    this.#root.removeFromDisplayList();
  }

  show(rect: Rect, reducedMotion: boolean): void {
    this.#root.addToDisplayList();
    const still = reducedMotion || !this.#webgl;
    const old = this.#rect;
    if (
      this.#texture &&
      old &&
      rect.x === old.x &&
      rect.y === old.y &&
      rect.width === old.width &&
      rect.height === old.height &&
      still === this.#still
    )
      return;
    this.#rect = rect;
    this.#still = still;
    if (still) {
      this.#center();
      this.#lookX = this.#lookY = 0;
    }
    if (!this.#texture && ensurePictureLoaded(this.#scene, ROOFTOP, this.#onLoaded)) this.#onLoaded();
    else this.#draw();
  }

  readonly #onLoaded = (): void => {
    if (!this.#root.scene || this.#texture) return;
    this.#texture = this.#scene.textures.get(ROOFTOP.key);
    if (this.#webgl) {
      const indices: number[] = [];
      for (let row = 0; row < ROWS.length - 1; row++) {
        const a = row * 2;
        indices.push(a, a + 2, a + 1, 0, a + 1, a + 2, a + 3, 0);
      }
      // Phaser uses the vertex count to pair the triangles. Our source coordinates run down the print;
      // its texture V axis runs up.
      const vertices = Array.from({ length: ROWS.length * 2 * 4 }, () => 0);
      this.#mesh = this.#scene.add.mesh2d(0, 0, this.#texture, vertices, indices, true).buildOrderedIndices(1, true);
      this.#root.add(this.#mesh);
    } else {
      this.#print = this.#scene.textures.createCanvas(CANVAS_PRINT, 1, 1);
      if (this.#print) {
        this.#image = this.#scene.add.image(0, 0, this.#print).setOrigin(0);
        this.#root.add(this.#image);
      }
    }
    this.#draw();
  };

  readonly #point = (pointer: Phaser.Input.Pointer): void => {
    const rect = this.#rect;
    if (!rect || this.#still || pointer.wasTouch || pointer.isDown) return;
    const centered = (n: number) => Math.max(-1, Math.min(1, 2 * n - 1));
    this.#targetX = centered((pointer.x - rect.x) / rect.width);
    this.#targetY = centered((pointer.y - rect.y) / rect.height);
  };

  readonly #center = (): void => {
    this.#targetX = this.#targetY = 0;
  };

  update(deltaMs: number): void {
    if (this.#still || (this.#lookX === this.#targetX && this.#lookY === this.#targetY)) return;
    const weight = 1 - Math.exp(-deltaMs / 105);
    const ease = (value: number, target: number) =>
      Math.abs(target - value) < 0.003 ? target : value + (target - value) * weight;
    this.#lookX = ease(this.#lookX, this.#targetX);
    this.#lookY = ease(this.#lookY, this.#targetY);
    this.#draw();
  }

  #draw(): void {
    const rect = this.#rect;
    if (!rect) return;
    const view = arenaView(rect, this.#lookX, this.#lookY);
    paintBezel(this.#metal, view);
    if (!this.#texture) return;
    const source = this.#texture.getSourceImage() as HTMLImageElement | HTMLCanvasElement;
    // A portrait crop keeps the water tower and one quiet half of the playmat in view.
    const fit = coverFit(source, rect, { x: rect.width < rect.height ? 0.18 : 0.5, y: 0.43 });
    if (this.#mesh) {
      const vertices = this.#mesh.vertices;
      vertices.length = 0;
      for (const t of ROWS) {
        const { left, right, uInset } = matRow(view, t);
        const v = (fit.cropY + fit.cropHeight * t) / source.height;
        vertices.push(left.x, left.y, (fit.cropX + uInset * fit.cropWidth) / source.width, v);
        vertices.push(right.x, right.y, (fit.cropX + (1 - uInset) * fit.cropWidth) / source.width, v);
      }
    } else if (this.#print && this.#image) {
      // Canvas has no textured meshes. Its camera stays still, so rasterize the same print in strips once per
      // resize. The horizontal scanlines converge to the same XYZ corners as the WebGL material.
      const scale = Math.min(1, 1440 / rect.width, 1000 / rect.height);
      this.#print.setSize(Math.max(1, Math.ceil(rect.width * scale)), Math.max(1, Math.ceil(rect.height * scale)));
      const ctx = this.#print.context;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, this.#print.width, this.#print.height);
      ctx.setTransform(scale, 0, 0, scale, -rect.x * scale, -rect.y * scale);
      const count = Math.max(1, Math.ceil(this.#print.height / 2));
      let previous = matRow(view, 0);
      for (let i = 0; i < count; i++) {
        const next = matRow(view, (i + 1) / count);
        const sx = fit.cropX + previous.uInset * fit.cropWidth;
        const sw = (1 - 2 * previous.uInset) * fit.cropWidth;
        ctx.drawImage(
          source,
          sx,
          fit.cropY + (fit.cropHeight * i) / count,
          sw,
          fit.cropHeight / count,
          previous.left.x,
          previous.left.y,
          previous.right.x - previous.left.x,
          next.left.y - previous.left.y + 0.5 / scale,
        );
        previous = next;
      }
      this.#print.refresh();
      this.#image.setTexture(CANVAS_PRINT).setPosition(rect.x, rect.y).setDisplaySize(rect.width, rect.height);
    }
  }

  destroy(): void {
    this.#scene.input.off(Phaser.Input.Events.POINTER_MOVE, this.#point);
    this.#scene.input.off(Phaser.Input.Events.GAME_OUT, this.#center);
    this.#root.destroy();
    if (this.#print) this.#scene.textures.remove(CANVAS_PRINT);
  }
}
