// swift-tools-version: 5.9

import PackageDescription

let package = Package(
    name: "Vito",
    platforms: [
        // SPM can't express macOS 14.x patch versions; the app documents and
        // enforces macOS 14+ Apple Silicon at runtime.
        .macOS(.v14)
    ],
    products: [
        .executable(name: "Vito", targets: ["Vito"])
    ],
    dependencies: [
        // Parakeet TDT STT on CoreML/ANE.
        .package(url: "https://github.com/FluidInference/FluidAudio", exact: "0.13.6")
        // LLM calls go to OpenRouter over a small URLSession client (see
        // DocumentAgent / NOTES.md): MacPaw OpenAI's strict decoder rejects
        // OpenRouter+Gemini's tool-call/finish_reason shapes.
    ],
    targets: [
        .executableTarget(
            name: "Vito",
            dependencies: [
                .product(name: "FluidAudio", package: "FluidAudio")
            ],
            path: "Sources/Vito"
        )
    ]
)
