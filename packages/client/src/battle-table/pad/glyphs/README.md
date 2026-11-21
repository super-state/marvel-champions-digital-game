# Controller button pictures (3D table)

The 3D table's own copy of the old 2D game's `src/ui/pad-glyphs/`, so the table keeps its controller pictures when the
old game goes. One SVG per button and family, read by `../glyph-art.ts`. Files are named by position, not label:
`face-south` is the bottom face button (Xbox A, PlayStation ✕, Switch B), `lb` / `lt` the left bumper and trigger (L1 /
L2, L / ZL), `ls` / `rs` the stick presses, `view` / `menu` the left and right system buttons, and `lstick` / `rstick`
a stick being moved.

All three sets are from Figma Community and licensed CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/):

- `xbox/`: "Xbox Controller Icons Free" by Alric Monteiro,
  https://www.figma.com/community/file/1271153059120916114/xbox-controller-icons-free
- `playstation/`: "PlayStation Controller Icons" by Antoine Plu,
  https://www.figma.com/community/file/968584708653901737/playstation-controller-icons
  (Create is the set's Share icon, the same button renamed on the DualSense; Options is its big Options icon)
- `nintendo/`: "Switch Button Icons [Essential pack]" by Gioele Casazza (the Solid, Duo, dark set),
  https://www.figma.com/community/file/1311838981334678894/switch-button-icons-essential-pack

Changed from the originals: each icon is cut out of its sheet into its own SVG and trimmed to its bounds, layer names
are dropped, and each set's two neutral colors are replaced with the placeholders `BODY` (the button) and `CUT` (the
letter or mark cut into it), which `../glyph-art.ts` fills in (a white button with an ink mark, ringed in ink by
`../pad.css`). The colored Xbox A, B, X and Y discs and the colored PlayStation face symbols keep their original
colors.

The controllers are Microsoft's, Sony's and Nintendo's designs and trademarks. The old game credits these sets on its
Credits screen (`src/content/credits.ts`); a credits page for the 3D table must carry the same line.
