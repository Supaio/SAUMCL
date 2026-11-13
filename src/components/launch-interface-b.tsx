import { useRouter } from "next/router";
import { useTranslation } from "react-i18next";
import { LuArrowLeftRight, LuCircleUserRound, LuPlay } from "react-icons/lu";
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

const LaunchInterfaceB = () => {
  const { t } = useTranslation();
  const router = useRouter();
  const { update } = useLauncherConfig();
  const { getInstanceList, selectedInstance, selectedPlayer } = useGlobalData();
  const { isGameLaunchBlocked } = useCowDrop();
  const { openSharedModal } = useSharedModals();
  const instances = getInstanceList() || [];
  const handleLaunch = () => {
    if (isGameLaunchBlocked) return;
    if (selectedInstance) {
      openSharedModal("launch", { instanceId: selectedInstance.id });
    } else {
      void router.push("/instances/add-import");
    }
  };

  return (
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

      <Card className="sp-launch-bar" data-cow-obstacle>
        <div className="sp-account">
          <div className="sp-account-icon">
            <LuCircleUserRound size={21} />
          </div>
          <div>
            <strong>
              {selectedPlayer?.name || t("LaunchPage.Text.noSelectedPlayer")}
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
          <label className="tw:sr-only" htmlFor="launch-b-instance">
            {t("HeadNavBar.navList.instances")}
          </label>
          <select
            id="launch-b-instance"
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
            id="main-launch-button"
            className="sp-launch-button"
            size="lg"
            disabled={isGameLaunchBlocked}
            title={
              isGameLaunchBlocked ? t("CowDropGame.launchBlocked") : undefined
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
  );
};

export default LaunchInterfaceB;
