import Image from "next/image";
import { useRouter } from "next/router";
import { useTranslation } from "react-i18next";
import {
  LuArrowLeft,
  LuArrowLeftRight,
  LuBox,
  LuChevronRight,
  LuCircleUserRound,
  LuCompass,
  LuLink,
  LuPlay,
  LuSearch,
  LuSettings,
  LuZap,
} from "react-icons/lu";
import { HomeTileBoard } from "@/components/common/home-tile";
import HomeDateQuote from "@/components/home-date-quote";
import HomeRewardsCard from "@/components/home-rewards-card";
import HomeServersCard from "@/components/home-servers-card";
import PlaytimeCalendarCard from "@/components/playtime-calendar-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useLauncherConfig } from "@/contexts/config";
import { useCowDrop } from "@/contexts/cow-drop";
import { useGlobalData } from "@/contexts/global-data";
import { useSharedModals } from "@/contexts/shared-modal";
import { HOME_TILE_DEFINITIONS } from "@/models/home-tiles";

const UiPreviewPage = () => {
  const { t } = useTranslation();
  const router = useRouter();
  const { config, update } = useLauncherConfig();
  const { getInstanceList, selectedInstance, selectedPlayer } = useGlobalData();
  const { isGameLaunchBlocked } = useCowDrop();
  const { openSharedModal } = useSharedModals();
  const instances = getInstanceList() || [];
  const navigation = [
    { icon: LuZap, label: "launch", path: "" },
    { icon: LuBox, label: "instances", path: "/instances" },
    { icon: LuCircleUserRound, label: "accounts", path: "/accounts" },
    ...(config.general.functionality.discoverPage === "on"
      ? [{ icon: LuCompass, label: "discover", path: "/discover" }]
      : []),
    { icon: LuLink, label: "friends", path: "/friends" },
    { icon: LuSettings, label: "settings", path: "/settings" },
  ];

  const handleLaunch = () => {
    if (isGameLaunchBlocked) return;
    if (selectedInstance) {
      openSharedModal("launch", { instanceId: selectedInstance.id });
    } else {
      void router.push("/instances/add-import");
    }
  };

  return (
    <div className="saumcl-ui-preview" data-ui-preview="shadcn">
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
          {navigation.map(({ icon: Icon, label, path }) => (
            <Button
              key={label}
              variant="ghost"
              className="tw:h-10 tw:w-full tw:justify-start tw:gap-3 tw:px-3 tw:font-normal"
              aria-current={label === "launch" ? "page" : undefined}
              title={t(`HeadNavBar.navList.${label}`)}
              onClick={() => path && void router.push(path)}
            >
              <Icon />
              <span className="sp-nav-label">
                {t(`HeadNavBar.navList.${label}`)}
              </span>
            </Button>
          ))}
        </nav>

        <div className="sp-sidebar-footer">
          <Button
            variant="outline"
            className="tw:w-full tw:gap-2 tw:text-xs"
            title={t("ShadcnPreview.back")}
            onClick={() => void router.push("/launch")}
          >
            <LuArrowLeft />
            <span className="sp-nav-label">{t("ShadcnPreview.back")}</span>
          </Button>
          <p>{t("ShadcnPreview.localPreview")}</p>
        </div>
      </aside>

      <main className="sp-main">
        <header className="sp-topbar">
          <div className="sp-breadcrumb">
            <span>SAUMCL</span>
            <LuChevronRight size={12} />
            <strong>{t("HeadNavBar.navList.launch")}</strong>
            <Badge variant="secondary">{t("ShadcnPreview.preview")}</Badge>
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

        <div className="sp-workspace">
          <section className="sp-hero tw:rounded-xl">
            <div>
              <Badge
                variant="outline"
                className="tw:border-white/30 tw:bg-white/10 tw:text-white"
              >
                {t("ShadcnPreview.community")}
              </Badge>
              <h1>{t("ShadcnPreview.greeting")}</h1>
              <p>{t("ShadcnPreview.subtitle")}</p>
            </div>
            <HomeDateQuote />
          </section>

          <div className="sp-section-title">
            <h2>{t("ShadcnPreview.workspace")}</h2>
            <span>{t("ShadcnPreview.tileHint")}</span>
          </div>

          <div className="sp-tiles">
            <HomeTileBoard definitions={HOME_TILE_DEFINITIONS}>
              <HomeServersCard />
              <PlaytimeCalendarCard />
              <HomeRewardsCard />
            </HomeTileBoard>
          </div>

          <Card className="sp-launch-bar">
            <div className="sp-account">
              <div className="sp-account-icon">
                <LuCircleUserRound size={21} />
              </div>
              <div>
                <strong>
                  {selectedPlayer?.name ||
                    t("LaunchPage.Text.noSelectedPlayer")}
                </strong>
                <p>{t("HeadNavBar.navList.accounts")}</p>
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t("ShadcnPreview.switchAccount")}
                title={t("ShadcnPreview.switchAccount")}
                onClick={() => void router.push("/accounts")}
              >
                <LuArrowLeftRight />
              </Button>
            </div>

            <div className="sp-instance-actions">
              <label className="tw:sr-only" htmlFor="preview-instance">
                {t("HeadNavBar.navList.instances")}
              </label>
              <select
                id="preview-instance"
                className="sp-instance-select"
                value={selectedInstance?.id || ""}
                onChange={(event) =>
                  void update(
                    "states.shared.selectedInstanceId",
                    event.target.value
                  )
                }
              >
                <option value="" disabled>
                  {t("LaunchPage.Text.noSelectedGame")}
                </option>
                {instances.map((instance) => (
                  <option key={instance.id} value={instance.id}>
                    {instance.name}
                  </option>
                ))}
              </select>
              <Button
                id="preview-launch-button"
                className="sp-launch-button"
                size="lg"
                disabled={isGameLaunchBlocked}
                title={
                  isGameLaunchBlocked
                    ? t("CowDropGame.launchBlocked")
                    : undefined
                }
                onClick={handleLaunch}
              >
                <LuPlay />
                {t(
                  selectedInstance
                    ? "LaunchPage.button.launch"
                    : "ShadcnPreview.addInstance"
                )}
              </Button>
            </div>
          </Card>
        </div>
      </main>
    </div>
  );
};

export default UiPreviewPage;
