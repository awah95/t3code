export async function requireJevCredential(): Promise<void> {
  let status: { readonly hasKey: boolean; readonly secureStorageAvailable: boolean } | undefined;
  try {
    status = await window.desktopBridge?.getJevStatus?.();
  } catch {
    throw new Error("Could not verify Jev's selected API credential.");
  }
  if (!status) throw new Error("Could not verify Jev's selected API credential.");
  if (status.hasKey) return;
  throw new Error(
    status.secureStorageAvailable
      ? "Add a key for the selected Jev provider in Settings > General > Jev Auto routing before enabling Jev."
      : "Jev cannot be enabled because secure OS credential storage is unavailable.",
  );
}
