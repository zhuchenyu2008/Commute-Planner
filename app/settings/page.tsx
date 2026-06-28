import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { readEnv } from "@/lib/env";
import { SettingsForm } from "./settings-form";

export default async function SettingsPage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  const settings = await prisma.userSettings.findUnique({
    where: { userId: user.id },
  });
  const env = readEnv();

  const values = {
    defaultCity: settings?.defaultCity ?? env.defaultCity,
    timezone: settings?.timezone ?? env.defaultTimezone,
    originName: settings?.originName ?? env.defaultOriginName,
    originLngLat: settings?.originLngLat ?? env.defaultOrigin,
    routePreference: settings?.routePreference ?? "balanced",
    telegramChatId: settings?.telegramChatId ?? "",
    emailRecipient: settings?.emailRecipient ?? "",
  };

  return (
    <AppShell active="settings">
      <section className="mx-auto w-full max-w-3xl space-y-6">
        <div className="space-y-2">
          <p className="text-sm font-medium text-on-surface-variant">
            Commute Planner
          </p>
          <h1 className="text-3xl font-semibold text-on-surface">Settings</h1>
        </div>

        <SettingsForm values={values} />
      </section>
    </AppShell>
  );
}
