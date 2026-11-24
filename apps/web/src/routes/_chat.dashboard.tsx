import { createFileRoute } from "@tanstack/react-router";

import { DashboardPage } from "../cabinet/dashboard/DashboardPage";

export const Route = createFileRoute("/_chat/dashboard")({
  component: DashboardPage,
});
