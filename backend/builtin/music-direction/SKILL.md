---
name: Music direction
description: "Plan a score for a drama episode, documentary or edit: decide whether it needs music at all, place cues on the real timeline, and write a prompt per cue for a music model. Use when the person asks for music, a soundtrack, a cue sheet or background music."
metadata:
  version: "1.0.0"
  author: Open-AI-Canvas
  owner: open-ai-canvas
  skillId: "oac-music-direction"
  tag: drama
  sortWeight: 988
  source: 3
---

# Music direction

Music is a set of cues placed on the real timeline, not one track laid under everything. This skill follows the cue-based approach of waoowaoo's music direction: decide first, then place cues, then write one prompt per cue.

## When to use

- The person wants music, a soundtrack or background music for an episode, a documentary or an edit.
- A cut feels flat and you suspect music could carry it.

Planning is free; generating music costs compute. Generate only with the person's approval, following the session's approval rules.

## 1. Decide first

Before placing anything, put a decision to the person with these options and a recommendation:

- **No music**: dialogue-driven scenes, realistic documentary, or when silence is the point. Recommend this whenever music would compete with the voice.
- **Sparse cues**: music only at openings, transitions and peaks. The default for drama.
- **Continuous score**: montage, trailer, music-led edits.

Say why you recommend one, in a sentence.

## 2. Read the real timeline

Build the cue sheet from the actual shot durations, not from guesses:

- On a drama, read the episode (`drama_episode_get`) and add up shot durations to get each scene's start and end.
- On a canvas, read the storyboard or timeline nodes.

Write every time as seconds from the start of the episode.

## 3. Place cues

A cue covers one dramatic unit. For each cue, write:

| Field | Content |
| --- | --- |
| Cue | M1, M2, … |
| Start / end | Seconds on the timeline; the end lands on a cut or a line break. |
| Function | Establish, tension, release, sting, transition, outro. |
| Mood and energy | Two or three words, plus energy 1–5. |
| Instruments | The few instruments that carry it. |
| Tempo | BPM, or "free time". |
| Entry and exit | Fade in, hard in on a cut, button ending, fade under dialogue. |
| Under dialogue? | If yes: sparse, low register, no melody in the voice range. |

Rules:

- Leave space: not every scene gets a cue.
- Start and end cues on cuts or on strong beats of the action, never in the middle of a line.
- Keep one or two motifs per character or theme and vary them, instead of new material every cue.
- Under speech, music sits about 12–18 dB below the voice. Plan for ducking rather than writing quiet music everywhere.

## 4. Write one prompt per cue

Write a prompt a music model can follow:

> Genre and era, instruments, tempo in BPM, key or mode if it matters, mood, how it starts, how it ends, exact length in seconds, "no vocals" unless a song is wanted.

For long cues, split them into sections with their own length and energy (intro, build, peak, outro) so the model can follow the arc.

Ask for exact lengths. A cue that is too long is trimmed at a cut; one that is too short leaves a hole.

## 5. Deliver

Give the person:

1. The decision and why.
2. The cue sheet table.
3. One prompt per cue.

When an audio model is available and the person approves, generate cues one at a time and check each against its length and mood before the next. Mixing: voice on top, music ducked under speech, final loudness around −14 LUFS for online video.
