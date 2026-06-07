OPTIONAL BOW SPRITES
====================

The game draws every bow procedurally (pure vector + canvas), so it needs no
image files to run. But if you want a bow to look EXACTLY like a piece of art
(e.g. the Dragon Bow poster), you can drop a PNG in here and the game will use
it automatically — falling back to the procedural art if the file is missing.

How to use
----------
1. Save your bow art as a PNG with a TRANSPARENT background, drawn vertically:
      - the bow standing upright (limbs top & bottom),
      - the string on the RIGHT side,
      - the grip roughly centered.
   For the Dragon Bow, that's exactly how the poster's right-hand bow is posed.

2. Name it after the bow id and put it in this folder:
      assets/bow_dragon.png      (Dragon Bow)
      assets/bow_composite.png   (Composite Bow)
      assets/bow_recurve.png     (Recurve Bow)
      assets/bow_hunter.png      (Hunter Bow)
      assets/bow_training.png    (Training Bow)

3. Reload the game. The shop preview and the in-hand bow will use your PNG.
   No code changes needed.

Notes
-----
- Only the Dragon tier is wired to look for a sprite right now (the others use
  their procedural look); ask to enable sprites for the other tiers too.
- If the in-hand sprite ends up rotated/mirrored once you add the file, tell me
  and I'll flip the orientation in drawBowSprite() (js/stickman.js) — the exact
  flip depends on how your PNG is drawn.
- Recommended size: ~512 px tall. Keep it a clean silhouette so it reads small.
