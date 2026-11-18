import Phaser from "phaser";
import type { Rect } from "../view/layout.js";

/**
 * Capture the printed face and its current cost badges once when the mouse picks it up.
 * Only the held card needs a render texture. The static hand and every input target stay in Phaser.
 */
export function liftCardMesh(scene: Phaser.Scene, print: Phaser.GameObjects.Container, face: Rect, scale: number) {
  const textureKey = "mc-held-card";
  if (scene.game.renderer.type !== Phaser.WEBGL || scene.textures.exists(textureKey)) return null;
  const density = Math.min(2, window.devicePixelRatio || 1);
  const width = (face.width + 16) * scale;
  const height = (face.height + 20) * scale;
  const texture = scene.textures.addDynamicTexture(textureKey, Math.ceil(width * density), Math.ceil(height * density));
  if (!texture) return null;
  texture.capture(print, {
    transform: "local",
    x: texture.width / 2,
    y: texture.height / 2,
    angle: 0,
    scaleX: scale * density,
    scaleY: scale * density,
  });
  texture.render();

  const indices: number[] = [];
  for (const top of [0, 1, 3, 4]) indices.push(top, top + 3, top + 1, 0, top + 1, top + 3, top + 4, 0);
  const mesh = scene.add
    .mesh2d(
      0,
      0,
      texture,
      Array.from({ length: 36 }, () => 0),
      indices,
      true,
    )
    .buildOrderedIndices(1, true);
  mesh.setName("Held card");
  mesh.once("destroy", () => scene.textures.remove(textureKey));

  return {
    mesh,
    move(x: number, y: number, dx: number, dy: number): void {
      // Rotate the physical corners about the grip, then project through a camera three card lengths away.
      const yaw = Phaser.Math.Clamp(dx / width, -1, 1) * 0.29;
      const pitch = Phaser.Math.Clamp(-dy / height, -1, 1) * 0.29;
      const cosYaw = Math.cos(yaw);
      const sinYaw = Math.sin(yaw);
      const cosPitch = Math.cos(pitch);
      const sinPitch = Math.sin(pitch);
      const camera = 3 * height;
      const vertices = mesh.vertices;
      let i = 0;
      for (const v of [0, 0.5, 1]) {
        for (const u of [0, 0.5, 1]) {
          const left = (u - 0.5) * width;
          const down = (v - 0.5) * height;
          const z = -left * sinYaw + down * sinPitch * cosYaw;
          const perspective = camera / (camera - z);
          vertices[i++] = (left * cosYaw + down * sinPitch * sinYaw) * perspective;
          vertices[i++] = down * cosPitch * perspective;
          vertices[i++] = u;
          vertices[i++] = v;
        }
      }
      mesh.setPosition(x, y);
    },
  };
}
