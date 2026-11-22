// Which microphone to record from. The choice is remembered in localStorage;
// an empty id means the system default.

import { createSignal } from "solid-js";

const DEVICE_KEY = "vito.micDeviceId";

function readDeviceId(): string {
  try {
    return localStorage.getItem(DEVICE_KEY) ?? "";
  } catch {
    return "";
  }
}

const [micDeviceId, setMicDeviceIdSignal] = createSignal(readDeviceId());
const [micDevices, setMicDevices] = createSignal<MediaDeviceInfo[]>([]);
export { micDeviceId, micDevices };

export function setMicDeviceId(id: string): void {
  setMicDeviceIdSignal(id);
  try {
    if (id) localStorage.setItem(DEVICE_KEY, id);
    else localStorage.removeItem(DEVICE_KEY);
  } catch {
    // Not persisted; fine.
  }
}

/**
 * Refreshes the list of audio inputs. Labels are blank until the user has
 * granted mic permission once, so those fall back to "Microphone N".
 */
export async function refreshMicDevices(): Promise<void> {
  if (!navigator.mediaDevices?.enumerateDevices) return;
  const all = await navigator.mediaDevices.enumerateDevices();
  // Chrome lists a synthetic "default" entry; we offer our own "System default".
  setMicDevices(all.filter(d => d.kind === "audioinput" && d.deviceId && d.deviceId !== "default"));
}

let watching = false;
/** Keep the list current as devices are plugged in or removed. */
export function watchMicDevices(): void {
  if (watching || !navigator.mediaDevices) return;
  watching = true;
  navigator.mediaDevices.addEventListener("devicechange", () => void refreshMicDevices());
  void refreshMicDevices();
}
