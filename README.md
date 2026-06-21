# Vito (native macOS spike)

A tiny **voice-in, text/document-out** assistant for macOS. You speak, it
transcribes on-device, and an LLM either replies in text or rewrites a markdown
document in the side pane.


## What it does

1. Press **Record**, speak, press **Stop**.
2. Local ASR (Parakeet TDT 0.6B-v3 via FluidAudio) turns speech into text.
3. An OpenRouter LLM (default `google/gemini-2.5-flash`) either:
   - replies in text (shown in the transcript pane), or
   - calls the `write_document` tool to create/replace the markdown document.

## Stack

- Swift + SwiftUI, Swift Package Manager
- macOS 14+ Apple Silicon
- ASR: [FluidAudio](https://github.com/FluidInference/FluidAudio) `0.13.6` (Parakeet TDT, CoreML/ANE)
- LLM: raw URLSession client to OpenRouter (`/chat/completions`), multi-turn
- State: chats persisted with **SwiftData**; conversation history drives the transcript and document

## Running

```bash
# Build an .app bundle, ad-hoc sign it, and launch
scripts/run.sh
```

Add your OpenRouter API key in the in-app **Settings** (⌘,) on first launch;
it's stored locally in `UserDefaults`. Get a key at openrouter.ai/keys.

`scripts/run.sh` assembles a real `.app` bundle because the microphone TCC
prompt and FluidAudio's model download don't behave reliably from a bare
`swift run` binary.

> **First run downloads a ~6 GB CoreML model bundle.** The window shows a
> progress banner while it downloads and compiles; Record stays disabled until
> the model is ready.

You can also open it in Xcode with `open Package.swift` (select the `Vito`
scheme), though you may need to add the microphone usage string to the scheme's
generated bundle for the permission prompt.

## Layout

```
Sources/Vito/
  VitoApp.swift          # @main SwiftUI App; SwiftData container + mic/model warm-up
  AppState.swift         # @Observable orchestrator; selected conversation + the flow
  Models/Conversation.swift   # SwiftData Conversation/Message + OpenAI-shaped ChatMessage
  Config/AppConfig.swift # OpenRouter key + model resolution
  Audio/AudioRecorder.swift   # AVAudioEngine tap → temp file
  STT/Transcriber.swift       # FluidAudio Parakeet wrapper
  LLM/DocumentAgent.swift      # OpenRouter multi-turn chat + write_document tool
  Views/                       # ContentView, sidebar, panes, bottom bar, settings
Resources/Info.plist     # bundle id + NSMicrophoneUsageDescription
scripts/run.sh           # build → bundle → sign → launch
```

See [`NOTES.md`](NOTES.md) for open questions to revisit.
