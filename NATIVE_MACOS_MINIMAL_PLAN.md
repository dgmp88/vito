# Native macOS Minimal Plan

## Goal

Build a very small native macOS app that proves the core product loop:

1. User speaks. Presses a button to record, presses again to stop.
2. Local ASR turns speech into text
3. Local LLM turns transcript into a document edit
4. The app updates a document shown in the main window, and shows the transcription.

This first version is intentionally narrow. It is a product spike, not a full rewrite of the current web app.

## Non-Goals

Do not build these in v1:

- menu bar app
- floating recorder pill or overlay
- paste into other apps
- accessibility integration
- global hotkeys
- background recording
- multi-window support
- persistence or database
- cloud APIs
- account/login
- conversation history beyond current in-memory session

## Product Shape

One standard macOS window with three areas:

- bottom bar: record/stop button, clear button
- left - transcript pane: live or recent speech transcript
- right - document pane: generated markdown document

The app only edits its own in-app document. No system-wide dictation behavior.

## Recommended Stack

- App: Swift + SwiftUI
- Build system: Swift Package Manager (`Package.swift`) — see `example_apps/macparakeet/Package.swift` for a clean reference layout with multiple targets
- Platform target: macOS 14+ Apple Silicon
- ASR: Parakeet TDT 0.6B-v3 via FluidAudio/CoreML — see `example_apps/macparakeet` for the full working integration
- LLM:
  - first choice: Ollama over `http://localhost:11434`
  - initial model target: `llama3.2:3b` or `gemma3:4b` — both have better instruction following than older options at this size
- State:
  - in-memory observable state only
- Document format:
  - markdown string in memory for v1

## Why This Scope

This keeps the first build focused on the core unknowns:

- native audio capture
- local ASR latency and quality
- local LLM command-to-document behavior
- basic native document editing UX

It avoids the hardest desktop-specific work until the product loop is proven:

- status bar lifecycle
- focus-safe overlays
- paste automation
- accessibility permissions
- persistence/migrations

## Architecture

Keep the architecture simple but not tangled.

### App Layer

Owns the window and SwiftUI views.

- `VitoApp`
- `ContentView`
- `AppViewModel` — use `@MainActor @Observable` (not `ObservableObject`), consistent with `example_apps/macparakeet`

### Services Layer

Owns side effects and external runtimes.

- `AudioCaptureService`
- `ParakeetService`
- `OllamaLLMService`

### Models Layer

Keep this minimal. All state lives on the ViewModel.

- `AppPhase` — enum: `idle | recording | transcribing | updatingDocument | error(String)`

The ViewModel holds the rest directly:

```swift
@MainActor @Observable
class AppViewModel {
    var phase: AppPhase = .idle
    var transcript: String = ""
    var document: String = ""
}
```

Do not create `DocumentSession`, `DocumentEditRequest`, or `TranscriptSegment` types until there is a concrete reason. A full-document string replacement does not need a data model.

## Suggested Flow

### 1. Recording

- user presses `Record`
- app captures microphone audio via `AVAudioEngine` tap on the input node — see `example_apps/VoiceInk/VoiceInk/CoreAudioRecorder.swift` for a battle-tested reference
- user presses `Stop`
- app finalizes the audio buffer

For the minimal version, use stop-to-transcribe rather than streaming dictation. It is simpler and removes a lot of concurrency complexity.

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

### 3. Document Update

- app builds a prompt from:
  - current document
  - latest transcript
  - a small system instruction
- LLM returns updated markdown
- document pane is replaced with the new markdown

For v1, replacing the whole document is acceptable. Do not design a structured operation system yet.

See `example_apps/VoiceInk/VoiceInk/Services/OllamaService.swift` for a working Ollama integration. The structure maps directly.

### 4. User Feedback

Show only a few states:

- idle
- recording
- transcribing
- updating document
- error

Error states must be present from Phase 2 onward — async operations can fail and the user needs feedback. Do not defer this to polish.

## Prompt Strategy

Keep prompting narrow and deterministic.

System instruction should be roughly:

- you are updating/creating a markdown document from spoken user input
- preserve existing useful content unless the user clearly changes it
- organize information clearly
- return markdown only

Initial request shape:

- current document
- latest spoken transcript
- instruction to return the full updated document

This matches the current prototype behavior while keeping implementation simple.

## File/Module Sketch

Use Swift Package Manager. One package, one app target to start.

```text
native/
  vito-macos/
    Package.swift
    Sources/
      VitoApp/
        VitoApp.swift
        Views/
          ContentView.swift
          TranscriptView.swift
          DocumentView.swift
        ViewModels/
          AppViewModel.swift
        Services/
          AudioCaptureService.swift
          ParakeetService.swift
          OllamaLLMService.swift
        Models/
          AppPhase.swift
```

See `example_apps/macparakeet/Package.swift` for how to structure targets if you want to split out a Core library later.

## Implementation Phases

### Phase 1: App Shell + Audio Capture

Deliverables:

- Swift Package with macOS app target
- single window with placeholder transcript and document panes
- record/stop button wired to `AppPhase` state transitions
- microphone permission handling
- `AVAudioEngine` capture with stop-to-transcribe audio handoff

Reference: `example_apps/VoiceInk/VoiceInk/CoreAudioRecorder.swift` for the audio capture pattern.

Exit criteria:

- app launches reliably
- button state changes work
- can record a short utterance and retain audio in memory or temp file

### Phase 2: ASR Integration

Deliverables:

- integrate Parakeet via FluidAudio (`example_apps/macparakeet/Sources/MacParakeetCore/STT/`)
- first-run model download with progress indicator (~6 GB)
- convert recorded audio into transcript text
- show transcript in UI
- basic error state for ASR failure

Exit criteria:

- user can record and see a local transcript with acceptable latency

### Phase 3: Ollama Integration

Deliverables:

- connect to local Ollama at `http://localhost:11434`
- model name hardcoded in code (no settings UI yet)
- send transcript plus current document and receive updated markdown
- error state for Ollama unreachable or model missing

Reference: `example_apps/VoiceInk/VoiceInk/Services/OllamaService.swift` for a working implementation.

Exit criteria:

- user can speak and see the document update end-to-end

### Phase 4: Basic Polish

Deliverables:

- clear session action
- basic markdown rendering or editable text view

Exit criteria:

- the app feels coherent for short single-user sessions

## Key Technical Choices

### ASR Choice

Use Parakeet via FluidAudio.

The integration is already proven end-to-end in `example_apps/macparakeet`. It targets the same platform (macOS 14+, Apple Silicon), uses the same CoreML/Neural Engine path, and the Swift API is stable. This is not exploratory — the code is already there to reference.

If Parakeet integration is genuinely broken, fall back to Whisper via `example_apps/VoiceInk/VoiceInk/Transcription/Core/Whisper/`. VoiceInk has both backends behind a `TranscriptionService` protocol (`example_apps/VoiceInk/VoiceInk/Transcription/Core/TranscriptionServiceRegistry.swift`) if you need the swap point later.

Do not add an `ASRService` protocol in v1. Implement Parakeet directly and add abstraction only if fallback becomes real.

### LLM Choice

Use Ollama first.

Pros:

- trivial local API boundary
- easy model swapping
- does not couple the app to a bundled LLM runtime yet

Cons:

- requires external runtime installed by the user
- quality depends heavily on chosen small model

Recommendation:

- start with Ollama, hardcode one known-good model during development
- `llama3.2:3b` or `gemma3:4b` are good starting points
- avoid building a provider matrix in v1
- reference `example_apps/VoiceInk/VoiceInk/Services/OllamaService.swift` before writing from scratch

### Document Representation

Use a single in-memory markdown string first.

Pros:

- fastest path to proving the loop
- mirrors current app behavior

Cons:

- full-document rewrites can get unstable as documents grow
- limited undo semantics

Recommendation:

- accept full replacement in v1
- move to structured edit operations only if the simple loop breaks down

## Risks

### 1. Local model quality may be mediocre

Small local models may not be good enough for reliable document updates from messy spoken input.

Mitigation:

- constrain prompts tightly
- keep document tasks simple at first
- test at least one alternative local model early (`llama3.2:3b` vs `gemma3:4b`)

### 2. ASR and LLM latency may stack badly

If ASR is fast but document update is slow, the whole app will feel sluggish.

Mitigation:

- use stop-to-transcribe
- show explicit progress states for each phase
- keep prompts short

### 3. Full-document rewrites may drift

Repeatedly asking the model to rewrite the whole document can slowly damage structure.

Mitigation:

- keep early sessions short
- add a manual clear/reset action
- move to section-level or operation-based edits later if needed

### 4. First-run model download may surprise users

The Parakeet CoreML bundle is ~6 GB. If the app opens and immediately tries to transcribe without downloading, it will fail silently or crash.

Mitigation:

- show an explicit onboarding/download step before first use
- reference `example_apps/macparakeet` for how they handle this in the onboarding flow

## Expand Later

Add these only after the minimal loop feels good:

- persistence with SQLite or SwiftData
- session history and saved documents
- settings UI for model selection
- menu bar mode
- floating recording panel
- global hotkeys
- paste into focused app
- accessibility-based selected-text context
- streaming transcript updates
- structured edit operations instead of full rewrite
- multi-document sessions
- export/share

## First Build Definition of Done

The first build is successful if:

- a user can open the app
- record speech in the app
- get a local transcript
- have a local LLM update an in-app markdown document
- repeat that loop a few times in one session without the app feeling fragile

That is enough to validate the native direction before adding desktop-native complexity.
