/*
 * The production guide Claude reads before scripting and editing (production_guide tool):
 * measured, concrete rules for short vertical video, condensed from HyperFrames' motion, caption,
 * sound and review references (frame-by-frame measurements of produced films), short-form
 * scripting practice (the WATCH framework) and platform specs. Numbers are defaults: a reference,
 * a format or the user wins for its own beat.
 */

export const GUIDE: Record<string, { title: string; text: string }> = {
  script: {
    title: 'Script and hook',
    text: `- Watch-through decides reach. The script's only job is to be unskippable: cut every line that does not hook, teach or set up the payoff.
- Frame 0 is the thumbnail and the hook: a face, the result, or one bold line already on screen. Never black, a logo or "hi guys".
- Layer the hook: picture + on-screen text + spoken line saying the same thing. Write 3–5 hook variants and pick the sharpest.
- Write the muted version first: most watch without sound, so on-screen text must carry the story; the voice adds to it.
- Shape: hook (0–1 s) → promise (by 3 s) → body with an open loop or numbered points → payoff → ≈2 s CTA tied to the value, or a last frame that cuts cleanly back to the first (a loop is a choice, not a default).
- Keep the promise the hook makes: an over-promise makes a mid-video drop-off.
- Length: 15–35 s is the sweet spot for most formats; ~2.5 spoken words a second (≈75 words for 30 s).
- Never invent statistics or results; mark AI voices and visuals when the platform asks.`,
  },
  pacing: {
    title: 'Pacing and cuts',
    text: `- Vertical: shots of 1–2 s, a new beat every 2–4 s; nothing static for more than 3 s (a cut, a punch-in of 1.1–1.2, a text change or a motion item counts; captions alone do not).
- Contrast speeds: montages cut every 0.13–0.8 s; a demo can hold one framing 7–10 s while something acts inside it.
- Hold 0.3–0.75 s before the payoff, then play it at normal speed.
- Cut at the fastest frame of a move, with matching direction on both sides; cut on the beat, change the layout on the bar (get_composition lists the beats; {op:"cutToBeats"} lands the cuts).
- Talking heads: punch in on emphasis, cut B-roll on the sentence, never cover the face.`,
  },
  captions: {
    title: 'Captions',
    text: `- Speech is always captioned (add_captions). Groups of 2–3 words for high energy, 3–5 conversational; break at a sentence end or a pause of 150 ms+.
- One group on screen at a time; the first appears 0.1–0.3 s in, never exactly at 0.
- Place them above the apps' own UI: y ≈ 0.60–0.65 on 9:16 (the default 0.63). Never over the speaker's face.
- Big and high-contrast; nothing read under 28 px on 1920. Cut words rather than shrink the font; ≤5 words a line.
- One highlighted word per group in the accent colour, and only when it carries meaning.
- Whisper invents "Thank you." over silence and repeats lines in silent tails: read the transcript and drop those words.`,
  },
  motion: {
    title: 'Motion design',
    text: `- Pick one motion personality per video and keep it: Energetic (0.1–0.25 s, expo.out, 15–30% overshoot), Playful (0.15–0.3 s, back.out), Premium (0.35–0.6 s, no overshoot), Corporate (0.2–0.4 s). One signature ease for most moves, three durations (quick / standard / slow).
- Moves take 0.3–0.6 s. Ease by role: arrivals land on a long tail (expo.out, power4.out); camera moves and colour floods ease both ways (power2.inOut); zoom-throughs and exits accelerate (power3.in). The same power2.out 0.5 s on everything reads as generated.
- Exits are 40–50% shorter than entrances and one smooth motion. Overlap: the next element starts when the previous is 30–50% done. Stagger: letters a frame apart, words 60–120 ms, list items 40–80 ms.
- Springs: damping 0.7–0.85 premium, 0.4–0.6 playful; position and size may bounce, opacity and colour never.
- Titles land, then stay dead still; the motion moves to the next element or the background. Hold a line 0.5 s + 0.3 s a word (last line ≥ 2 s). Size 4–9% of the frame height; one accent word. Vary the entrance (per-word blur-in 6 px → 0 in 0.13 s, 0.067 s apart; grey-to-ink per word; per-letter for a name), not fade-and-slide-up for every title.
- Transitions need a cause on screen: 3–5 kinds per video (zoom through an object, an object becoming the next scene, morph, colour flood, whip 0.13–0.3 s with blur, iris from a click, dip cut). At most a third of the seams between beats are hard cuts; worlds never crossfade.
- Looks generated (avoid): floating, breathing or pulsing loops on titles; titles that keep sliding after they land; slow creeping scale; bounce on UI; click rings; every scene entering the same way.
- Before hand-building an effect, search the HyperFrames registry (search_motion_blocks): ~450 transitions, titles, kinetic type, caption styles, overlays, camera moves. Recompose 1920×1080 blocks for the frame, keep the brand's colours and fonts.`,
  },
  sound: {
    title: 'Sound',
    text: `- A video over ~15 s that tells something gets a music bed, unless it is meant to play muted. Choose by feel and tempo, not subject (find_music, search_music_online). Enter at the track's strongest bar, not its quiet intro; end on a bar line with a short fade.
- A voice is the clock: text lands on the word that says it. Music under a voice: duck:true or volume 0.3–0.4.
- Effects are few and exact, each with a cause on screen: whoosh on a cut or a fast move, pop on a badge or number landing, a soft tick on typed text, one riser into the payoff. Rotate 2–3 takes of a repeated sound; the same whoosh on every cut is a tell. Place the hit one frame after its picture; 3–6 dB over the bed. Effects: search_music_online with sound_effects:true.
- A bed with its energy below 150 Hz is nothing on a phone speaker.
- Levels: the render normalises to −14 LUFS integrated with true peak ≤ −1 dBTP; review_composition measures the last render.`,
  },
  vertical: {
    title: 'Vertical frame (9:16)',
    text: `- 1080×1920. The apps draw over the frame: nothing readable in the top 168 px; words and the subject between 168 and 1330 px; below that only texture; keep ~140 px clear on the right for the buttons. (Conservative across TikTok, Reels and Shorts; the editor's "Safe zones" overlay shows it.)
- One subject, centred; recompose landscape layouts as a vertical sequence.
- Type ~1.35× larger than for landscape; nothing read under 28 px.
- Export clean: no watermark of another platform; trending sounds are added in the app when posting.`,
  },
  review: {
    title: 'Review before rendering',
    text: `- Run review_composition after every structural edit and before the final render. Fix every P0, then the P1s worth it: text first, then timing, then detail. A note kept on purpose: say why.
- Render a draft, then look at frames of the render (get_frames on its asset) just before and after each cut and at the payoff: describe each beat frame in one sentence as a stranger would; anything you would have to explain is a problem.
- With the words covered, the frames should still tell the story. With the sound off, the text should.
- Busy? Remove a third of the motion and keep the moves that lead the eye.
- Say what was measured (review, loudness) and what nobody checked (how it sounds).`,
  },
}

export const GUIDE_TOPICS = Object.keys(GUIDE)

export function guideText(topic?: string) {
  if (topic && GUIDE[topic]) return `# ${GUIDE[topic].title}\n${GUIDE[topic].text}`
  return Object.values(GUIDE)
    .map((g) => `# ${g.title}\n${g.text}`)
    .join('\n\n')
}
