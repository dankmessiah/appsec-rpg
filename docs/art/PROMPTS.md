# AppSec RPG: Art Prompt Set (ChatGPT image generation)

Style locked on 2026-11-07: clean vector / cel-shaded, cyan-on-navy palette, creatures made of code. Reference image: the Deserialization Hydra (`docs/art/reference/hydra.png`).

## How to use

1. Work in **one ChatGPT conversation** for the whole set. Upload the hydra image at the start and say: "This is the house style reference for every image in this conversation."
2. Paste the **Style Block** at the top of every prompt, unchanged, then the subject prompt beneath it.
3. Generate in order: player first (4 poses), then sections 0 through 6, grunt → elite → boss. The hydra is already done (section 1 boss).
4. After each image, if anything drifts (line weight, palette, shading), reply with the correction line from the Fixes section before moving on.
5. Save each file as `public/assets/<id>.png` using the ids below.

## Style Block (paste at the top of every prompt)

> Match the attached reference image exactly in style. Clean vector illustration, cel-shaded: flat colour fills, crisp hard edges, two to three tone shading per surface, no soft gradients, no painterly brushwork, no photorealism. Glow is drawn as flat halos and sharp light shapes, never blurred. Line weight, contrast and level of detail identical to the reference. Palette strictly limited to: deep navy (#070B16) for the darkest body tones, slate blue (#1C3A5E) for mid tones, magenta (#FF3FA4) for energy, eyes and threat accents, cyan (#38E4FF) for circuit traces and secondary light, amber (#FFC14D) only as tiny spark accents. No other hues. Every creature is built from the same materials as the reference: braided cable, circuit-board plating with cyan traces, panels of magenta hex-dump text, fiber-optic strands, jagged data-shard edges. Same lighting direction as the reference (key light from upper left). Full body, three-quarter view, centered, strong readable silhouette that stays clear at 120 px tall. Transparent background (PNG with alpha). No text other than hex-dump texture, no UI, no watermark, no border, no ground shadow, no scenery. Square image, 1024x1024.

## Fixes (reply with one of these if an image drifts)

- "Too soft: remove gradients and blur, use flat cel shading with hard edges like the reference."
- "Wrong colours: restrict to the five palette hexes only, remove any purple, green or orange."
- "Too busy: simplify the silhouette, fewer strands, keep the same detail level as the reference."
- "Background not transparent: regenerate with a true alpha background, no navy fill."
- "Facing wrong way: the creature must face left; the player must face right."

## Player (faces RIGHT, toward the enemy)

Base description for all four poses:

> Subject: the player character, a hooded operator. Slim athletic figure in a dark navy hooded jacket with slate-blue panels, face fully in shadow under the hood except two thin cyan visor lines where the eyes would be. Cyan circuit traces run along the sleeves and hood edge. Fingerless gloves with a small amber spark at each knuckle. Holds a thin blade of solid cyan light with a magenta core line, hilt made of braided cable. Heroic but understated; the enemy should always look larger. Faces RIGHT.

| id | Pose prompt (append to base) |
|---|---|
| `player_idle` | Pose: relaxed ready stance, blade held low at the side, weight on the back foot, hood up. |
| `player_attack` | Pose: mid-swing, blade arcing diagonally upward to the right, body twisted into the strike, a flat cyan light-trail following the blade edge. |
| `player_hurt` | Pose: staggered back, one knee bent, free hand raised defensively, hood slightly thrown back, three magenta glitch fragments breaking off the shoulder, visor lines flickering (drawn as broken dashes). |
| `player_victory` | Pose: standing tall, blade raised vertically overhead, small amber sparks rising around the blade tip. |

## Enemies (all face LEFT, toward the player)

Size guidance to include in each prompt: grunt fills ~60% of the canvas height, elite ~80%, boss ~95%.

### Section 0: Testing types and tooling

| id | Name | Subject prompt |
|---|---|---|
| `s0_grunt` | False Positive Swarm | A loose cluster of seven small moth-like creatures flying in formation, each with a magenta "!" shaped body and cyan circuit wings, trailing short hex-dump streamers. Grunt size. |
| `s0_elite` | Flaky Crawler | A large eight-legged spider whose legs are segmented fiber-optic cables with cyan joints, abdomen a cracked circuit-board shell showing magenta hex-dump beneath, mandibles of data shards. One leg is visibly glitched into dashes. Elite size. |
| `s0_boss` | The Blind Scanner | A hulking cyclops golem of stacked slate server plating with cyan trace seams, a single huge magenta lens-eye in the chest that is cracked and dark on one side, arms ending in scanner-beam emitters drawn as flat cyan fans. Boss size. |

### Section 1: Vulnerability classes

| id | Name | Subject prompt |
|---|---|---|
| `s1_grunt` | Payload Wasp | A wasp with a syringe-like stinger of cyan light, striped abdomen alternating slate and magenta hex-dump bands, wings of thin cyan circuit lattice. Grunt size. |
| `s1_elite` | Reflected Mimic | A chameleon-like lizard whose skin is made of mirror-flat navy panels, half of its body shown "reflecting" a ghosted second copy of itself in magenta outline, tongue a curling strand of cyan script. Elite size. |
| `s1_boss` | Deserialization Hydra | Already generated; use the reference image. Boss size. |

### Section 2: Web, auth and identity

| id | Name | Subject prompt |
|---|---|---|
| `s2_grunt` | Session Leech | A fat leech-slug with a magenta sucker mouth ringed in data-shard teeth, body plated in slate segments with cyan trace seams, a short tether of braided cable trailing from its tail. Grunt size. |
| `s2_elite` | Token Forger | A magpie-like bird with cyan circuit feathers and a magenta eye, clutching a glowing forged key made of hex-dump text in its talons, tail feathers splitting into fiber-optic strands. Elite size. |
| `s2_boss` | The Broken Gatekeeper | A three-headed cerberus hound of slate armour plating, each collar a snapped chain of cable links, cyan traces along the ribs, magenta eyes, one head wearing a cracked padlock as a muzzle. Boss size. |

### Section 3: Standards and frameworks

| id | Name | Subject prompt |
|---|---|---|
| `s3_grunt` | Checklist Imp | A small hunched imp carrying a clipboard made of a circuit board, body of slate plating with cyan traces, magenta tick-mark markings on its skin, a tiny pen-like antenna. Grunt size. |
| `s3_elite` | Compliance Mimic | A treasure-chest mimic shaped like a thick binder, lid open to reveal rows of data-shard teeth and a magenta tongue of hex-dump, cable tentacles spilling from the sides. Elite size. |
| `s3_boss` | The Paper Dragon | A long serpentine dragon whose scales are overlapping slate document sheets edged in cyan, wings of fanned paper with magenta hex-dump columns, a crown of jagged data-shard spines. Boss size. |

### Section 4: Risk scoring and prioritization

| id | Name | Subject prompt |
|---|---|---|
| `s4_grunt` | Severity Gnat | A tiny gnat with an oversized magenta numeral "10" shaped abdomen, cyan wing lattice, a thin stinger. Grunt size. |
| `s4_elite` | Probability Fox | A sleek fox of slate plating with nine fiber-optic tails fading from magenta at the base to cyan tips, eyes two small percent-sign glyphs in cyan, crouched mid-pounce. Elite size. |
| `s4_boss` | KEV Reaper | A hooded reaper figure built from braided cable, face a void with a single magenta glyph, holding a scythe whose blade is a long cyan light-shard etched with hex-dump, cloak hem dissolving into data fragments. Boss size. |

### Section 5: Supply chain and CI/CD

| id | Name | Subject prompt |
|---|---|---|
| `s5_grunt` | Typosquat Rat | A scrawny rat with a slate-plated body, a tail of braided cable, magenta eyes, carrying a tiny package box whose label is scrambled hex-dump. Grunt size. |
| `s5_elite` | Dependency Spider | A spider sitting at the center of a tangled web of cyan cable strands, each strand ending in a small slate package node, body of circuit-board plating, magenta hourglass marking of hex-dump. Elite size. |
| `s5_boss` | The Poisoned Pipeline | A massive segmented worm built from industrial pipe sections and conveyor belts in slate plating, cyan trace seams between segments, magenta hex-dump leaking from the joints, a circular maw of rotating data-shard teeth. Boss size. |

### Section 6: Program and process

| id | Name | Subject prompt |
|---|---|---|
| `s6_grunt` | Backlog Blob | A sagging blob creature made of stacked, overlapping slate ticket cards, magenta hex-dump oozing between them, two small cyan eyes near the top. Grunt size. |
| `s6_elite` | Scope Creep | A long centipede with far too many legs, each body segment a slate plate labelled with a tiny magenta hex-dump tag, cyan antennae, body curving back on itself. Elite size. |
| `s6_boss` | The Legacy Monolith | A towering golem of stacked, mismatched server racks and ancient stone-like slate blocks, cyan traces running like cracks, a magenta core glowing through gaps in the chest, one arm a rusted crane hook of braided cable. Boss size. |

## Optional: UI assets (generate only after the sprites are done)

| id | Prompt (Style Block applies) |
|---|---|
| `icon_s0` … `icon_s6` | A single flat icon, 256x256, for section N: [0 magnifying lens over a circuit board · 1 a cracked shield · 2 a key made of cable · 3 a stacked document stamp · 4 a gauge dial · 5 a package box on a conveyor · 6 a flowchart of three nodes]. Cyan line icon on transparent background, magenta accent on one element, no text. |
| `title_mark` | A game title mark: the words "APPSEC RPG" in a clean monospaced, slightly angular typeface, cyan letters with a magenta glitch offset on the "RPG", transparent background, 1536x512. |

## Asset checklist

- [x] player_idle · player_attack · player_hurt · player_victory
- [x] s0_grunt · s0_elite · s0_boss
- [x] s1_grunt · s1_elite · s1_boss
- [x] s2_grunt · s2_elite · s2_boss
- [x] s3_grunt · s3_elite · s3_boss
- [x] s4_grunt · s4_elite · s4_boss
- [x] s5_grunt · s5_elite · s5_boss
- [x] s6_grunt · s6_elite · s6_boss
- [ ] icon_s0 … icon_s6 (optional)
- [ ] title_mark (optional)
