# Native macOS Minimal Plan

## Goal

Build a very small voice in, text out assistant as a native macOS app that:

1. User speaks. Presses a button to record, presses again to stop.
2. Local ASR turns speech into text
3. OpenRouter LLM takes text and choses to either: 
  a) Generate a response in text
  b) Call a 'write_document' tool which creates/edits a document in a side bar

This first version is intentionally narrow. It is a product spike, not a full rewrite of the current web app.

## Product Shape

One standard macOS window with three areas:

- bottom bar: record/stop button, clear button
- left - transcript pane: live speech transcript
- right - document pane: generated markdown document

## Stack

- App: Swift + SwiftUI
- Build system: Swift Package Manager (`Package.swift`) — see `example_apps/macparakeet/Package.swift` for a clean reference layout with multiple targets
- Platform target: macOS 14+ Apple Silicon
- ASR: Parakeet TDT 0.6B-v3 via FluidAudio — see `example_apps/macparakeet` for an example working integration
- LLM:
  - MacPaw OpenAI, hitting openrouter, gemini flash 3.5 
- State:
  - in-memory observable state only
- Document format:
  - markdown string in memory for v1

Stream the transcription if easy and possible, but fall back to transcribe on stop if it causes issues

## Suggested Flow

### 1. Recording

- user presses `Record`
- app captures microphone audio via `AVAudioEngine` tap on the input node — see `example_apps/VoiceInk/VoiceInk/CoreAudioRecorder.swift` for a battle-tested reference
- user presses `Stop`
- app finalizes the audio buffer


### 2. Speech Recognition

- audio buffer goes to Parakeet via FluidAudio
- Parakeet returns transcript text
- transcript is shown in the transcript pane

The FluidAudio API is straightforward and already proven in `example_apps/macparakeet`:

```swift
let models = try await AsrModels.downloadAndLoad(version: .v3)
let manager = AsrManager(config: .default)
try await manager.initialize(models: models)

let result = try await manager.transcribe(audioSamples, source: .system)
// result.text contains the transcription
```

**Note:** Parakeet requires a ~6 GB CoreML model bundle downloaded on first run. This is the most significant first-run UX moment in Phase 2 and needs an explicit loading/progress state.

### 3. Document Update / transcription

- app builds a prompt from:
  - current document
  - latest transcript
  - a tool call that re-writes the whole doc every time 
- LLM returns updated markdown
- document pane is replaced with the new markdown

For v1, replacing the whole document is acceptable. Do not design a structured operation system yet.

### 4. User Feedback

Show only a few states:

- idle
- recording
- transcribing
- updating document
- error

## Prompt Strategy

Keep prompting simple - short prompt for now.
