---
name: Production review passes
description: "Review a script, storyboard or rendered take the way a studio crew would: separate passes for script, direction, camera, continuity and sound, each with its own checklist, ending in one ranked fix list. Use before rendering an episode or when judging whether a take is approved."
metadata:
  version: "1.0.0"
  author: Open-AI-Canvas
  owner: open-ai-canvas
  skillId: "oac-production-review-passes"
  tag: drama
  sortWeight: 989
  source: 3
---

# Production review passes

Studios split review across roles because one reviewer looking at everything at once misses things. Here the same agent runs the roles one after another, as separate passes, and keeps their findings apart until the end. These passes are not parallel subagents: run them in order, in one session, so nothing is generated twice.

## When to use

- Before rendering an episode or a sequence: review the script and storyboard.
- After rendering: decide whether a take is approved, needs a prompt fix, or needs a new take.
- When the person asks "what is wrong with this?" about a scene.

Reviewing never starts generation. A new take is a recommendation the person approves.

## Inputs to read first

- The script or episode text, and the shot list (on a drama: `drama_episode_get`; on a canvas: the storyboard and text nodes).
- The cast and their notes (`drama_casts`, or the character nodes).
- For takes: the rendered segment or frames, if the session can look at images or video.

## The passes

Run each pass with its checklist. Write findings as "shot or line → problem → fix". Skip a pass only when it has nothing to look at, and say so.

### 1. Script

- Every line of source dialogue is present or deliberately cut (drama episodes include a dialogue check; read it).
- Each scene has a goal, an obstacle and a change; cut scenes that change nothing.
- Lines sound like the character who says them; no exposition a viewer can already see.
- The episode ends on a question, a reveal or a turn.

### 2. Direction

- Each shot has one clear subject and one clear action.
- Emotion is shown through action and framing, not only stated in the prompt.
- Performance notes are concrete (where the eyes go, what the hands do), not adjectives.
- Pacing matches the project's pacing setting; a long dialogue scene has coverage, not one static shot.

### 3. Camera

- Shot sizes vary; no run of three shots at the same size without a reason.
- Camera moves have a motivation (follow, reveal, push for emphasis) and a start and end state.
- Lens and height suit the mood; a dialogue keeps matching heights and the 180° line.

### 4. Continuity

Apply the checklist of the **Segment continuity** skill (`oac-segment-continuity`): relation per boundary, state chain, screen direction, light. Read it with `skill_read_file` when it is installed.

### 5. Sound

- Every spoken line has a speaker and fits the shot duration (about 2.5 words per second for natural speech).
- Moments that need silence, music or a sound effect are marked.
- Voice notes on the cast match the character.

### 6. Take review (rendered segments only)

For each take, check against its shot:

- Subject, action and framing match the shot text.
- Faces and bodies hold together across the segment; no morphing, extra fingers or melting props.
- Costume, props and light match the state chain.
- Lip movement roughly fits the line, when there is one.
- First and last frames work with the neighbouring segments.

Verdict per take: **approve**, **fix prompt** (say what to change), or **new take** (say why a prompt fix is not enough).

On a drama with the MCP tools:

1. Read the episode with `drama_episode_get`; each segment lists its `takes`, newest first, with the one in the cut marked `selected`.
2. Look at a take with `drama_take_frames` (evenly spaced frames). Judge only what the frames show; say so when a problem could sit between frames.
3. Record the verdict with `drama_take_review` (`approve`, `fix_prompt` with a `promptFix`, or `new_take` with the reason in `notes`). This never regenerates anything.
4. When an older take is better, propose it. Call `drama_take_select` only after the person picks it: the episode is re-rendered locally, and the result warns when the next segment was generated from the replaced take's last frame.

## Output

End with one list, ranked by impact on the finished film:

1. Problems that break the story or continuity.
2. Problems a viewer will notice.
3. Polish.

Each item names the shot, the pass that found it, and the fix. When drama edit tools are available, apply text fixes the person agreed to with `drama_shot_update` or `drama_cast_update`, and leave rendering to the person.
