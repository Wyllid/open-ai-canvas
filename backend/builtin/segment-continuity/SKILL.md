---
name: Segment continuity
description: "Make cuts between shots and segments read as one film: decide for every pair whether it continues, match-cuts or re-anchors, carry character and prop state, and check each cut before rendering. Use when planning or reviewing a storyboard, a drama episode or a sequence of video segments."
metadata:
  version: "1.0.0"
  author: Open-AI-Canvas
  owner: open-ai-canvas
  skillId: "oac-segment-continuity"
  tag: drama
  sortWeight: 990
  source: 3
---

# Segment continuity

Video models render each segment on its own. Continuity is planned, not hoped for: every segment must carry enough of the world to stand alone, and every boundary between two segments needs an explicit decision.

## When to use

- Planning a storyboard, a drama episode or a multi-shot sequence before generation.
- Reviewing shots or rendered segments that "jump": a costume changes, a prop disappears, a character faces the wrong way, the light flips.
- Choosing transitions between shots.

Stop at planning when the person only asked for a plan. Do not start generation from this skill; follow the approval rules of the session.

## 1. Make each segment self-contained

Write every shot or segment so it could be rendered with no memory of the previous one:

- **World coordinates**: location, time of day, weather, light direction and quality, dominant palette.
- **Frame coordinates**: who is in frame, where (left, centre, right, foreground, background), facing which way, at what shot size.
- **State**: costume, hair, props in hand, injuries, dirt, wet clothes, anything that changed earlier in the story.
- **Motion in and out**: what is moving at the first frame and where it is heading at the last frame.

Never write "same as before" or "continues"; repeat the facts.

## 2. Decide every boundary

For each pair of consecutive shots, choose exactly one relation and record it in the shot notes:

| Relation | Use when | How to generate |
| --- | --- | --- |
| `continuous` | The camera keeps rolling on the same action: same place, same moment. | Use the last frame of the previous segment as the first frame of the next (first-frame or first-last-frame mode). Keep shot size, lens and light. |
| `match_cut` | A deliberate cut that keeps one element: an action, a shape, a gesture, an eyeline. | New framing, but repeat the matched element's position and direction exactly. Write the matched element in both prompts. |
| `reanchor` | A new scene, a time jump or a change of place. | Start from the character and location references, not from the previous frame. Restate the full world and state. |

Rules, adapted from Toonflow's storyboard workflow:

1. A cut between two segments must change at least one of: the subject, the shot size by two steps (for example wide to close-up), or the camera angle by about 90°. Two near-identical framings in a row read as a jump cut.
2. A match on action stays inside one segment when the model can render it; split it only when the action is longer than one segment can hold, and then use `continuous`.
3. Before a segment inherits state from the previous one, check that the relation is `continuous` or `match_cut`. A `reanchor` inherits only what the story says carried over (a wound, a costume), never the camera.
4. Keep screen direction: if a character exits frame right, they enter the next shot from frame left, unless the shot is a `reanchor` or the camera visibly crosses the line.
5. Eyelines in a dialogue alternate: A looks right to left, B looks left to right, at matching heights.

## 3. Keep a state chain

Keep a short table per character and per important prop, updated shot by shot:

| Shot | Character or prop | Costume / state | Holding | Position and facing | Notes |
| --- | --- | --- | --- | --- | --- |

Read it before writing each prompt. When the story changes a state (she takes off the coat, the cup breaks), write the change in the shot where it happens and in every later prompt.

## 4. Transitions

- In a drama project the transition into a shot is `cut`, `fadeblack` or `fadewhite`. A project-wide transition setting overrides per-shot values.
- Use `cut` by default. Use `fadeblack` for a time jump or the end of a sequence, and `fadewhite` for a flash, a memory or a shock.
- A `continuous` boundary is always a `cut`.

## 5. Check before rendering

For every boundary, answer in one line:

1. Relation: continuous, match_cut or reanchor?
2. Does the cut change subject, shot size by two steps, or angle by about 90°? If not, change one.
3. Do costume, props, injuries and light match the state chain?
4. Is screen direction kept?
5. Is the generation mode right for the relation (first frame for continuous, references for reanchor)?

Report the boundaries that fail and the fix for each. With drama tools available, fix shot text with `drama_shot_update` and add missing shots with `drama_shot_insert`; on a canvas, fix the prompt nodes. Leave rendering to the person.
