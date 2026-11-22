import { createSignal, For, onSettled, Show } from "solid-js";
import { chooseMic } from "~/lib/appState";
import { micDeviceId, micDevices, refreshMicDevices, watchMicDevices } from "~/lib/micDevice";

/** Mic icon in the bottom bar; opens a small menu of audio inputs. */
export default function MicPicker() {
  const [open, setOpen] = createSignal(false);
  let root: HTMLDivElement | undefined;

  onSettled(() => {
    watchMicDevices();
    const onPointerDown = (e: PointerEvent) => {
      if (open() && root && !root.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  });

  const toggle = () => {
    const next = !open();
    setOpen(next);
    if (next) void refreshMicDevices();
  };

  const pick = (id: string) => {
    chooseMic(id);
    setOpen(false);
  };

  const options = () => [
    { id: "", label: "System default" },
    ...micDevices().map((d, i) => ({ id: d.deviceId, label: d.label || `Microphone ${i + 1}` })),
  ];
  // A remembered device that's currently unplugged falls back to the default.
  const selectedId = () => (micDevices().some(d => d.deviceId === micDeviceId()) ? micDeviceId() : "");

  return (
    <div class="mic-picker" ref={root}>
      <button
        class={{ "mic-picker__btn": true, "mic-picker__btn--open": open() }}
        // Keep a document highlight from being dropped by focus moving to the button.
        onMouseDown={e => e.preventDefault()}
        onClick={toggle}
        aria-label="Choose microphone"
        aria-haspopup="menu"
        aria-expanded={open() ? "true" : "false"}
        title="Choose microphone"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="9" y="3" width="6" height="11" rx="3" />
          <path d="M5 11a7 7 0 0 0 14 0" />
          <path d="M12 18v3" />
        </svg>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M6 15l6-6 6 6" />
        </svg>
      </button>
      <Show when={open()}>
        <div class="mic-picker__menu" role="menu">
          <div class="mic-picker__title">Microphone</div>
          <For each={options()}>
            {option => (
              <button
                class={{ "mic-picker__item": true, "mic-picker__item--selected": option.id === selectedId() }}
                role="menuitemradio"
                aria-checked={option.id === selectedId() ? "true" : "false"}
                onMouseDown={e => e.preventDefault()}
                onClick={() => pick(option.id)}
              >
                <span class="mic-picker__check">{option.id === selectedId() ? "✓" : ""}</span>
                <span class="mic-picker__label">{option.label}</span>
              </button>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}
