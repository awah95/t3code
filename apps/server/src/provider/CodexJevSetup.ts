// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeCrypto from "node:crypto";
import { codexJevRunnerSource, JEV_BROKER_TOKEN, JEV_BROKER_URL } from "./CodexJevHook.ts";

export async function prepareCodexJevHook(
  stateDir: string,
  environment: NodeJS.ProcessEnv,
  launchArgs: string,
  platform: NodeJS.Platform,
  executablePath: string,
) {
  // User-provided session hooks occupy the same config layer; never replace that array.
  if (
    !environment[JEV_BROKER_URL] ||
    !environment[JEV_BROKER_TOKEN] ||
    /\bhooks\b/.test(launchArgs)
  )
    return undefined;
  const endpoint = new URL(environment[JEV_BROKER_URL]);
  if (
    endpoint.protocol !== "http:" ||
    endpoint.hostname !== "127.0.0.1" ||
    endpoint.pathname !== "/subagent-route"
  )
    return undefined;
  const source = codexJevRunnerSource();
  const digest = NodeCrypto.createHash("sha256").update(source).digest("hex").slice(0, 16);
  const directory = NodePath.join(stateDir, "jev");
  await NodeFSP.mkdir(directory, { recursive: true, mode: 0o700 });
  const path = NodePath.join(directory, `codex-subagent-${digest}.mjs`);
  await NodeFSP.writeFile(path, source, { mode: 0o600 });
  const quote = (value: string) =>
    platform === "win32"
      ? `"${value.replaceAll('"', '""')}"`
      : `'${value.replaceAll("'", "'\\''")}'`;
  return { command: `${quote(executablePath)} ${quote(path)}` };
}
