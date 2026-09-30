import { createFileRoute } from "@tanstack/react-router";
import { DiviWorkspacesSettings } from "../components/settings/DiviWorkspacesSettings";

export const Route = createFileRoute("/settings/divi-workspaces")({
  component: DiviWorkspacesSettings,
});
