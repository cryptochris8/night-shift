# NIGHT SHIFT — Claude Code One-Shot Build Prompt

## Mission

Build a polished, browser-based psychological horror / mystery game with the working title **NIGHT SHIFT**.

This is intended to be a **serious standalone game prototype**, not a Generation Play template and not a lightweight demo.

The goal is to create the most cinematic, unsettling, realistic-looking experience possible **without imported 3D assets**. Everything visual should be produced with code, procedural rendering, CSS, Canvas, SVG, WebGL primitives, shaders, generated textures, lighting, layered 2D/2.5D scenes, or other code-driven techniques.

Do not stop at scaffolding. Do not give me a design document instead of a game.

**Build the playable game.**

---

# 1. Operating Instructions

Work autonomously.

Do not repeatedly ask me questions. If a design decision is ambiguous, make the decision yourself based on the following priorities, in this order:

1. atmosphere
2. immersion
3. visual realism
4. psychological tension
5. gameplay clarity
6. replayability
7. performance
8. technical elegance

Prefer a smaller polished experience over a huge unfinished one.

Do not waste implementation time on unnecessary frameworks, abstractions, backend systems, authentication, databases, accounts, multiplayer, or infrastructure.

Do not overengineer.

Do not create elaborate systems unless they directly improve the player's experience.

If an idea in this prompt would prevent the game from being completed, simplify the implementation while preserving the experience.

The finished result should run locally in a modern browser.

---

# 2. Recommended Technical Approach

Choose the exact stack yourself after inspecting the repository, but use a modern browser-first implementation.

Preferred approach if starting from scratch:

- Vite
- TypeScript
- React only if useful for UI/state
- HTML5 Canvas and/or WebGL for environmental rendering
- CSS for interface, overlays, transitions, lighting, and cinematic presentation
- Web Audio API for procedural audio and spatial ambience

If Three.js would materially improve lighting, particles, camera movement, shader effects, or spatial composition, you may use it.

However:

**Do NOT use imported 3D models.**

If Three.js is used, geometry should be created from primitives and procedural/code-generated materials.

Avoid large dependency trees.

Do not introduce a game engine unless it provides a clear advantage.

---

# 3. Core Game Concept

The game takes place during one late-night shift in a hospital.

The player does not control a single protagonist.

Instead, the player observes and experiences the same unfolding event from several people's perspectives.

The three primary characters are:

## JOHN — Patient

John is waiting to be evaluated.

He has limited access to the hospital.

He may be tired, anxious, medicated, in pain, or cognitively altered.

His perception is sometimes unreliable.

Some things John sees may be:

- medication effects
- stress
- hallucinations
- misinterpretations
- genuine supernatural events

The player should never immediately know which explanation is correct.

John's vulnerability is part of his gameplay.

---

## SUSIE — Nurse

Susie was called in unexpectedly for the night shift.

She can access:

- exam rooms
- treatment rooms
- nursing stations
- medication areas
- patient charts
- staff corridors
- clinical equipment

She has more information than John but is expected to respond when something goes wrong.

Susie's perspective should feel more grounded and clinical at first.

As events escalate, her professional explanation for events should become harder to maintain.

---

## PAUL — Janitor / Environmental Services

Paul knows the hospital's physical layout better than almost anyone.

He can access:

- service corridors
- utility rooms
- supply closets
- maintenance passages
- electrical areas
- generator access
- mechanical spaces

He may discover environmental evidence that contradicts what others believe is happening.

He can interact with infrastructure.

Paul should become especially important after the power failure.

---

# 4. Central Gameplay Mechanic — Perspective Switching

The defining mechanic is the ability to switch between characters who are experiencing the SAME timeline.

The game should continuously track the shared timeline.

The player may jump between:

- John
- Susie
- Paul
- CCTV / security feeds when available
- specific monitoring interfaces when narratively appropriate

Switching perspective should not simply change the camera.

It changes:

- what the player can access
- what the player knows
- what they can interact with
- what dangers they face
- what they hear
- what they believe they see

Each character should have meaningful limitations.

A situation that is impossible for John may be solvable by Paul.

A clue available to Susie may explain something John saw earlier.

A CCTV camera may show that both characters were wrong.

Or the camera itself may be unreliable.

---

# 5. Shared Timeline

The events occur during a single continuous night.

Suggested time span:

**10:45 PM — 1:45 AM**

The exact time can be changed if a different duration works better.

Use an in-game clock.

Major events should happen along the same shared timeline even when the player is controlling someone else.

This creates important decisions:

- Which perspective should I watch?
- What might I be missing?
- Is someone currently in danger?
- Do I investigate this anomaly or switch to someone else?
- What happened while I was away?

Some events should occur whether or not the player witnesses them.

The player may later discover consequences.

---

# 6. Perspective Switching Interface

Create a polished interface for switching perspectives.

Possible presentation:

- small hospital floor diagram
- portraits / names
- current location
- character status
- clock
- subtle warning indicators

Do not make the UI look like a strategy game.

It should feel like part of a dark surveillance / hospital system.

Transitions between characters should feel cinematic.

Examples:

- quick fade through CCTV static
- audio crossfade
- fluorescent flicker
- intercom click
- camera whip
- monitor power-on effect

Keep transition times short enough that switching remains enjoyable.

---

# 7. Camera / Surveillance System

Security cameras are an additional tool, NOT the entire game.

CCTV views can help the player:

- confirm movement
- inspect hallways
- watch doors
- monitor characters
- investigate suspicious events
- compare what someone believes they saw against recorded footage

Camera feeds can degrade as the night progresses.

Possible effects:

- compression artifacts
- frame skipping
- timestamp glitches
- static
- missing frames
- delayed feeds
- brief impossible images

Never overuse glitch effects.

Subtlety is scarier.

---

# 8. Hospital Environment

Keep the environment compact.

A single hospital wing is enough.

Suggested locations:

- exterior / ambulance entrance glimpse
- emergency waiting room
- triage area
- nurse station
- patient hallway
- 3–5 exam rooms
- medication room
- staff break room
- restroom
- supply room
- service hallway
- electrical room
- generator / maintenance area

Not every location must be fully explorable by every character.

Use occlusion, locked doors, staff-only areas, curtains, glass, shadows, and distance to create depth.

---

# 9. Visual Direction

The visual target is:

**grounded cinematic realism created entirely through code.**

Avoid:

- cartoon styling
- bright game-like colors
- toy-like proportions
- low-effort rectangles with labels
- generic pixel art
- cheerful UI
- obvious placeholder visuals

Favor:

- realistic proportions
- dim lighting
- subdued materials
- reflective floors
- realistic hospital color temperatures
- fluorescent lighting
- subtle grime
- worn corners
- soft shadows
- emergency lighting
- depth through layered geometry
- atmospheric perspective
- restrained visual effects

Possible rendering techniques:

- procedural gradients
- generated wall/floor textures
- SVG details
- canvas texture synthesis
- layered parallax
- shadow masks
- volumetric-looking light cones
- bloom-like CSS effects
- procedural reflections
- vignette
- subtle grain
- depth blur
- fog
- light flicker

If WebGL is used, prioritize lighting and mood over geometric complexity.

---

# 10. Character Representation

No imported character models.

Use one of these approaches or a smart combination:

- procedurally constructed 2D figures
- layered vector silhouettes
- code-generated skeletal figures
- realistic proportion sprites generated from SVG/canvas shapes
- limited animation with lighting and occlusion doing much of the realism work
- first-person or over-the-shoulder framing where detailed full-body animation is unnecessary

Do not create goofy-looking humanoids.

If highly realistic full-body procedural characters are not achievable, hide limitations intelligently through:

- framing
- darkness
- distance
- silhouettes
- partial body views
- reflections
- curtains
- doorways
- security cameras

Horror benefits from incomplete visibility.

---

# 11. Audio — Extremely Important

Audio should carry a large part of the horror.

Use browser audio techniques and procedural sound where possible.

Create a layered ambient system.

Hospital baseline sounds:

- HVAC
- fluorescent hum
- ventilation
- distant monitors
- rolling carts
- rubber shoes on tile
- distant doors
- muffled voices
- occasional elevator tone
- medical equipment
- intercom clicks
- distant coughing
- plumbing
- vending machine hum

As tension increases:

- unexplained footsteps
- distant dragging
- equipment turning on by itself
- barely audible voices
- movement behind walls
- abnormal monitor rhythms
- low-frequency generator vibrations
- strange intercom fragments

Avoid constant loud jump-scare audio.

Silence should sometimes be the scariest state.

Use spatial stereo positioning where practical.

---

# 12. Horror Escalation

The hospital should begin convincingly normal.

Do not begin with obvious monsters.

## Phase 1 — Normal

Everything seems routine.

There are small details and ordinary interactions.

Allow the player to settle into the environment.

## Phase 2 — Unease

Introduce minor inconsistencies:

- footsteps with no visible source
- patient repeatedly appearing in unexpected locations
- room light turns on
- elevator opens but nobody exits
- an empty wheelchair changes position
- chart information seems wrong
- someone hears their name from an empty room

## Phase 3 — Contradictions

Perspectives stop agreeing.

Example:

John sees someone standing at the end of the hallway.

Switch to Susie.

Nobody is there.

Switch to CCTV.

The feed shows a figure — but only for two frames.

Did John hallucinate it?

Did Susie arrive too late?

Did the camera malfunction?

Do not answer immediately.

## Phase 4 — Power Failure

At a major narrative moment:

**the hospital loses primary power.**

The blackout should be dramatic.

For several seconds:

- screens die
- lights vanish
- monitors stop
- audio changes
- characters react differently

Then:

**backup generator power starts.**

Emergency lighting activates.

Not everything returns.

Some cameras remain offline.

Some doors behave differently.

The hospital is now darker.

This is the moment the game should become significantly more frightening.

## Phase 5 — Generator Night

After backup power:

- lighting becomes harsher
- hallways become more dangerous
- strange events increase
- certain areas become inaccessible
- Paul may need to inspect infrastructure
- Susie may respond to patients
- John may become isolated
- CCTV reliability decreases

## Phase 6 — Crisis

A genuine threat becomes possible.

Do not make the threat constantly visible.

The player should often hear or infer danger before seeing it.

## Phase 7 — Resolution

The player's discoveries and decisions determine the ending.

---

# 13. Unreliable Reality System

Build an underlying system that allows each character's perception to differ.

This should not simply be random screen distortion.

Possible per-character perception state:

- anxiety
- fatigue
- medication
- fear
- injury
- stress
- environmental exposure

The same event can have multiple presentations.

Example:

Reality state:
A staff member crosses the hallway.

John sees:
The person walks unnaturally slowly with an abnormal gait.

Susie sees:
A tired employee limping.

CCTV sees:
A partially corrupted silhouette.

Later evidence might suggest one version was closer to reality.

---

# 14. Replay / Alternate Reality System

The game should support repeat playthroughs.

At the beginning of each run, generate or select a hidden **Night Seed**.

The Night Seed influences:

- anomalies
- event ordering
- clue locations
- character perception
- true/false supernatural events
- environmental changes
- danger states
- ending possibilities

Do not make everything random.

Preserve a coherent story framework.

Variation should feel authored rather than chaotic.

Possible hidden scenario types:

### Scenario A — Mostly Grounded
Most events have plausible explanations.

### Scenario B — Psychological
Perception differences are dominant.

### Scenario C — Supernatural
Some impossible events are objectively real.

### Scenario D — Mixed
Truth remains ambiguous.

Do NOT tell the player which scenario was selected.

---

# 15. Anomaly/Event Pool

Create a reusable event system.

Examples:

- empty wheelchair moves
- patient appears on wrong camera
- person walks with subtly impossible gait
- elevator arrives at floor not selected
- call light activates in empty room
- shadow moves differently from person
- chart shows a patient who supposedly died years ago
- vending machine drops item without payment
- figure stands outside locked window
- someone enters a room but is not inside
- hospital bed appears moved
- mirror reflection lags briefly
- intercom says a character's name
- monitor displays impossible vital signs
- footsteps travel against hallway geometry
- lights turn off sequentially toward character
- wet footprints appear with no source
- child laughter from closed wing
- room temperature visually changes through condensation
- camera timestamp jumps
- two cameras briefly show the same person in different places

Create more if useful.

Prioritize subtle events first.

---

# 16. Character-Specific Mechanics

## JOHN

Possible interactions:

- observe nearby people
- walk limited areas
- speak to staff
- check phone
- use vending machine
- look through windows
- listen to conversations
- inspect paperwork
- decide whether to tell someone what he saw

Possible status effects:

- medication blur
- tunnel vision
- elevated pulse
- auditory distortion

His perception effects should be subtle, not annoying.

---

## SUSIE

Possible interactions:

- open charts
- check rooms
- use nurse station terminals
- respond to call lights
- interact with equipment
- evaluate patient status
- use badge-access doors
- contact staff
- check security information
- administer limited context-appropriate care where narratively useful

Avoid making this a medical simulator.

Clinical interactions exist to support the horror story.

---

## PAUL

Possible interactions:

- unlock service areas
- inspect breaker panels
- restore circuits
- move through service corridors
- check generator systems
- use flashlight
- move equipment
- inspect unusual physical evidence
- access spaces other characters cannot

Paul should have the strongest exploration role after the blackout.

---

# 17. Character Danger

Characters can enter danger independently.

The player should sometimes switch perspectives because someone may need attention.

Possible signals:

- heartbeat
- camera signal loss
- radio message
- sudden silence
- warning light
- location indicator changes
- character portrait distortion

Do not reveal exactly what is happening.

The player must decide whether to switch.

Missing an event can have consequences.

---

# 18. Choice and Consequence

Include meaningful decisions.

Examples:

- investigate a sound or stay with a patient
- restore a circuit or follow footsteps
- tell staff about an impossible sighting
- trust one character's perception
- unlock a restricted area
- switch perspectives at a critical moment
- leave someone alone
- use CCTV instead of physically investigating

Track important choices.

Do not create hundreds.

A small set of meaningful decisions is better.

---

# 19. Endings

Create at least 3 endings, preferably 4.

Possible categories:

## Ending 1 — Morning Comes
Most characters survive, but the mystery remains unresolved.

## Ending 2 — Someone Missing
The shift ends, but one character cannot be accounted for.

## Ending 3 — Rational Explanation
Evidence suggests a mostly plausible explanation — but leave one impossible detail.

## Ending 4 — Something Came Through
The player discovers evidence that the phenomenon was real.

Avoid giant text dumps.

Use visuals, audio, short scenes, CCTV footage, objects, or dialogue to communicate endings.

---

# 20. Opening Sequence

Create a cinematic opening.

Example structure:

Exterior hospital at night.

Rain or distant traffic if performance allows.

Hospital sign.

Ambulance entrance.

Cut to waiting room.

Digital clock.

10:47 PM.

John waits.

Susie receives a call asking her to cover.

Paul pushes a cleaning cart down a service hallway.

These scenes overlap.

Then control begins.

Keep it concise.

---

# 21. Pacing

Target a prototype run of approximately:

**20–40 minutes**

depending on exploration.

Do not make the player wander without purpose.

Provide subtle direction through:

- sound
- lighting
- character goals
- messages
- environmental cues
- timers
- events

Avoid explicit giant quest arrows whenever possible.

---

# 22. UI

UI should feel integrated into the hospital atmosphere.

Use restrained typography.

Possible HUD elements:

- time
- character name
- location
- subtle health/stress/perception status
- switch-perspective control
- contextual interaction prompts

Avoid clutter.

Menus should be polished.

Create:

- title screen
- New Shift
- Resume if feasible
- Settings
- Audio controls
- controls screen
- credits
- restart / new night option

---

# 23. Controls

Support:

## Keyboard / Mouse

Suggested:

- WASD / arrows = movement when movement applies
- mouse = look / inspect
- E = interact
- Tab or Q = perspective interface
- 1 / 2 / 3 = quick character switching if appropriate
- Esc = pause

## Gamepad

Add controller support if reasonably achievable.

At minimum:

- movement
- interact
- perspective switch
- pause

Do not sacrifice the core build if controller integration becomes expensive.

---

# 24. Accessibility / Comfort

Include:

- master volume
- music volume
- effects volume
- motion effects toggle
- film grain toggle if used heavily
- reduced flicker option

Do not use extreme strobing.

---

# 25. Procedural Texture and Environment Generation

Because no imported 3D assets are allowed, put real effort into code-generated detail.

Create utilities for procedural:

- tile floors
- painted walls
- ceiling panels
- doors
- windows
- hospital signs
- carts
- desks
- chairs
- privacy curtains
- equipment silhouettes
- vents
- pipes
- electrical panels
- monitors
- beds
- wheelchairs
- clocks
- exit signs
- emergency lights

These do not need physically accurate 3D models.

They need to look convincing in the chosen camera style.

Reusable procedural scene components are encouraged.

---

# 26. Lighting System

Lighting is one of the most important technical features.

Support:

- normal fluorescent state
- flickering fixture state
- partial outage state
- total blackout
- emergency generator state
- flashlight / focused light
- monitor glow
- exit sign glow

During normal power, the hospital should feel cold and clinical.

After generator power, the lighting should feel dramatically different.

Use darker areas intentionally.

Do not make the entire screen so dark that gameplay becomes frustrating.

---

# 27. Sound-State System

Audio should change dynamically.

Suggested global states:

1. NORMAL
2. UNEASY
3. PRE_OUTAGE
4. BLACKOUT
5. GENERATOR
6. THREAT
7. RESOLUTION

Transitions between states should modify:

- ambience
- hum
- reverb
- music
- frequency balance
- random event sounds
- silence probability

---

# 28. Internal Story State

Create a coherent internal state model.

Suggested concepts:

- currentTime
- activeCharacter
- characterLocations
- characterStress
- characterPerception
- witnessedEvents
- missedEvents
- cluesFound
- anomalyState
- powerState
- dangerState
- scenarioSeed
- endingFlags

Keep this organized.

Do not scatter major game-state logic across dozens of unrelated components.

---

# 29. Event Scheduler

Create a central event scheduling system that makes the shared timeline possible.

Each event should be able to define:

- time window
- eligible scenario types
- location
- relevant characters
- whether it happens offscreen
- visual effect
- audio effect
- clues generated
- consequences
- alternate presentation by perspective

This is one of the most important architectural pieces.

---

# 30. Save Scope

A full save system is optional.

If easily achievable, support saving the current run to localStorage.

However, do NOT spend significant implementation effort on save infrastructure.

Replay from the beginning is acceptable for this prototype.

---

# 31. Performance

Target modern desktop browsers first.

Maintain smooth rendering.

Avoid unnecessarily expensive particle systems or shaders.

Gracefully reduce visual intensity if performance drops.

---

# 32. Testing Requirements

Before considering the build complete:

- run the app
- resolve compile errors
- resolve obvious console errors
- test title → gameplay → perspective switch → outage → ending
- verify restarting works
- verify the main timeline continues properly
- verify no major character can become permanently stuck
- verify important interactions are discoverable
- verify audio does not autoplay in a way blocked by browser policy; initialize after player interaction
- verify mobile layout does not completely break even if desktop is primary

---

# 33. Token / Credit Discipline

This build is being made during a limited Claude Code credit window.

Use the credits on IMPLEMENTATION, not excessive narration.

Do not spend large amounts of output explaining every file you create.

Do not write a 5,000-word design analysis before coding.

Inspect the repository, form a concise internal plan, and start building.

When you encounter a problem:

1. diagnose it
2. fix it
3. continue

Do not stop to ask me for permission unless there is a truly blocking requirement that cannot reasonably be inferred.

Make sensible assumptions.

---

# 34. Completion Standard

A successful result is NOT:

- a menu with placeholders
- a room with text boxes
- a design mockup
- an architecture skeleton
- TODO comments
- empty components
- "future feature" lists

A successful result is:

- playable
- atmospheric
- visually convincing
- creepy
- coherent
- replayable
- technically stable
- able to demonstrate the perspective-switching concept within minutes

I should be able to launch it and immediately understand why this concept could become a full commercial horror game.

---

# 35. Priority Order If Time / Credits Become Limited

If you need to reduce scope, preserve features in this exact order:

1. cinematic hospital atmosphere
2. John / Susie / Paul perspective switching
3. shared timeline
4. power outage + generator transformation
5. different perception of shared events
6. strong audio
7. escalating anomaly system
8. one complete beginning-to-ending run
9. alternate endings
10. replay variation
11. controller support
12. optional polish systems

Never sacrifice the core experience in order to add peripheral features.

---

# 36. Final Implementation Directive

Start by inspecting the current repository.

If there is no useful existing structure, initialize the project cleanly.

Then build NIGHT SHIFT from beginning to end.

Do not merely tell me how you would build it.

**Implement it.**

Use creative judgment.

Make the opening grounded enough that the player believes they are in a normal hospital.

Then slowly make them question what they saw.

By the time the backup generator turns on, the player should feel that the rules of the hospital have changed.

The most important question throughout the game should be:

> **“Did that actually happen?”**

Build the game around that feeling.
