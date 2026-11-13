import Image from "next/image";
import { useRouter } from "next/router";
import { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  LuBox,
  LuChevronRight,
  LuCircleUserRound,
  LuCompass,
  LuDownload,
  LuLink,
  LuSearch,
  LuSettings,
  LuZap,
} from "react-icons/lu";
import HeadNavBar from "@/components/head-navbar-v2";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useLauncherConfig } from "@/contexts/config";
import { useCowDrop } from "@/contexts/cow-drop";
import { useSharedModals } from "@/contexts/shared-modal";
import { indevLauncherVersionLabel } from "@/utils/launcher-version";

const ApplicationFrame = ({ children }: { children: ReactNode }) => {
  const { t } = useTranslation();
  const router = useRouter();
  const { config, newerVersion } = useLauncherConfig();
  const { cowCount } = useCowDrop();
  const { openSharedModal } = useSharedModals();
  const isB = config.appearance.theme.launchInterface === "b";
  const navigation = [
    { icon: LuZap, key: "launch", path: "/launch" },
    { icon: LuBox, key: "instances", path: "/instances" },
    { icon: LuCircleUserRound, key: "accounts", path: "/accounts" },
    ...(config.general.functionality.discoverPage === "on"
      ? [{ icon: LuCompass, key: "discover", path: "/discover" }]
      : []),
    { icon: LuLink, key: "friends", path: "/friends" },
    { icon: LuDownload, key: "downloads", path: "/downloads" },
    { icon: LuSettings, key: "settings", path: "/settings" },
  ];
  const active = navigation.find(
    (item) =>
      router.pathname === item.path ||
      router.pathname.startsWith(`${item.path}/`)
  );
  const label = (key: string) =>
    t(
      key === "downloads"
        ? "DownloadTasksPage.title"
        : `HeadNavBar.navList.${key}`
    );
  let detail = "";
  if (active?.key === "settings" && router.pathname.split("/")[2]) {
    detail = t(
      `SettingsLayout.settingsDomainList.${router.pathname.split("/")[2]}`
    );
  } else if (active?.key === "discover") {
    const section = router.pathname.split("/")[2];
    const key =
      section === "resource" ? String(router.query.type || "mod") : section;
    if (key) detail = t(`DiscoverLayout.discoverDomainList.${key}`);
  }

  return (
    <div
      className={`saumcl-application-frame${isB ? " saumcl-ui-preview" : ""}`}
      data-launch-interface={isB ? "b" : "a"}
      data-cows={cowCount > 0}
    >
      {isB ? (
        <aside className="sp-sidebar">
          <div className="sp-brand">
            <Image
              src="/images/icons/saumcl.png"
              alt="SAUMCL"
              width={34}
              height={34}
            />
            <div>
              <strong>SAUMCL</strong>
              <span>{t("ShadcnPreview.brand")}</span>
            </div>
          </div>
          <nav className="sp-nav" aria-label={t("ShadcnPreview.navigation")}>
            {navigation.map(({ icon: Icon, key, path }) => (
              <Button
                key={key}
                variant="ghost"
                className="tw:h-10 tw:w-full tw:justify-start tw:gap-3 tw:px-3 tw:font-normal"
                aria-current={active?.key === key ? "page" : undefined}
                title={label(key)}
                onClick={() => void router.push(path)}
              >
                <Icon />
                <span className="sp-nav-label">{label(key)}</span>
                {key === "settings" && newerVersion.version && (
                  <span
                    className="sp-update-dot"
                    aria-label={t("General.new")}
                  />
                )}
              </Button>
            ))}
          </nav>
          <div className="sp-sidebar-footer">
            <p>
              {indevLauncherVersionLabel(config.basicInfo.launcherVersion) ||
                config.basicInfo.launcherVersion}
            </p>
          </div>
        </aside>
      ) : (
        <HeadNavBar />
      )}
      <main className={isB ? "sp-main" : "saumcl-classic-main"}>
        {isB && (
          <header className="sp-topbar">
            <div className="sp-breadcrumb">
              <span>SAUMCL</span>
              <LuChevronRight size={12} />
              <strong>{active ? label(active.key) : "SAUMCL"}</strong>
              {detail && (
                <>
                  <LuChevronRight size={12} />
                  <span className="sp-current-section">{detail}</span>
                </>
              )}
              <Badge variant="secondary">B</Badge>
            </div>
            <div className="sp-toolbar">
              <Button
                variant="outline"
                size="sm"
                onClick={() => openSharedModal("spotlight-search")}
              >
                <LuSearch />
                {t("HeadNavBar.navList.search")}
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t("HeadNavBar.navList.settings")}
                onClick={() => void router.push("/settings/appearance")}
              >
                <LuSettings />
              </Button>
            </div>
          </header>
        )}
        {children}
      </main>
    </div>
  );
};

export default ApplicationFrame;
