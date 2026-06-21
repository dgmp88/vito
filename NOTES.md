# Implementation notes & open questions

Status of the initial spike against `NATIVE_MACOS_MINIMAL_PLAN.md`. Everything
in the plan is implemented and the package **builds clean** (`swift build`).
What I haven't been able to do is a full **runtime** pass — that needs the ~6 GB
model download, a microphone, and a real OpenRouter key on the machine. Flagging
the things worth a second look below.

## Decisions I made (please confirm)

1. **Model slug.** The plan says "gemini flash 3.5", which isn't a real
   OpenRouter slug. I defaulted to `google/gemini-2.5-flash` (configurable in
   Settings). Confirm the intended model.

2. **MacPaw OpenAI → dropped for a raw URLSession client.** Started with
   MacPaw/OpenAI `0.5.0` per the plan, but it failed at runtime against
   OpenRouter + Gemini with "The data couldn't be read because it isn't in the
   correct format." Two incompatibilities, neither fixable from outside the
   SDK's types: (a) Gemini returns tool-call `arguments` as a JSON **object**,
   while MacPaw requires the OpenAI-spec stringified JSON; (b) `finish_reason`
   can be null/absent, while MacPaw's `Choice.finishReason` is a non-optional
   `String`. `DocumentAgent` now calls OpenRouter's `/chat/completions`
   directly and parses leniently with `JSONSerialization` (handles arguments as
   string **or** object). The MacPaw dependency was removed. **Question:** OK to
   stay on the raw client, or do you specifically want an SDK?

3. **Transcribe-on-stop, not streaming.** The plan allowed either; I took the
   simpler fallback. Record → temp `.caf` file → transcribe whole file on stop.
   FluidAudio resamples to 16 kHz internally, so no manual conversion.

4. **AVAudioEngine tap → file.** The plan suggested an `AVAudioEngine` tap
   (and pointed at VoiceInk's Core Audio recorder as a reference). I used the
   simpler `AVAudioEngine` tap writing to a temp file rather than the AUHAL
   recorder, since we don't need device-switching or live metering yet.

5. **Where text replies go.** The plan's transcript pane is "live speech
   transcript". When the LLM answers in text instead of writing a document, I
   append it to the transcript pane labelled "Assistant". Confirm that's the
   desired place (vs. a separate chat area / TTS).

6. **Whole-document rewrite.** Per the plan, `write_document` returns the entire
   markdown and replaces the pane each time. No structured ops.

7. **API key storage.** Read from `OPENROUTER_API_KEY` env var first, else
   `UserDefaults`. UserDefaults is **not** secure storage — Keychain would be
   the production choice. Fine for a spike?

## Things to verify at runtime (couldn't test headless)

- **Microphone permission** actually prompts and that `AVAudioEngine` input
  works once granted, when launched via `scripts/run.sh` (ad-hoc signed bundle).
  Bare `swift run` will likely fail the TCC prompt — hence the bundle script.
- **First-run model download** (~6 GB): progress banner copy, and that
  `AsrModels.downloadAndLoad(version: .v3, ...)` succeeds + caches.
- **Tool-call round trip** with Gemini on OpenRouter — that it reliably calls
  `write_document` for "write/draft/edit" phrasing vs. replying in text. The
  system prompt nudges this but may need tuning.
- **Markdown rendering**: `MarkdownView` is a minimal block renderer (headings,
  bullets, paragraphs, inline emphasis). Tables/code blocks/nested lists aren't
  handled. Good enough for v1? If not, consider a real markdown library.

## Known limitations / deferred

- No streaming transcription or partial results.
- No audio level meter / waveform during recording.
- No persistence — transcript and document are in-memory and cleared on quit.
- No automated tests yet (logic is thin; the recorder/STT/LLM are I/O-bound).
- App icon, notarization, and distribution are out of scope.
- Error states are surfaced as a single status string in the bottom bar; no
  retry affordance beyond pressing Record again.

## Org naming

Per org guidance the product/company is referred to as **Fault Line**; the
bundle id uses `com.faultline.vito`.
