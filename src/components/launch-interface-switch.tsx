import { Button, ButtonGroup, Tooltip } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";
import { useLauncherConfig } from "@/contexts/config";

const LaunchInterfaceSwitch = () => {
  const { t } = useTranslation();
  const { config, update } = useLauncherConfig();
  const current = config.appearance.theme.launchInterface === "b" ? "b" : "a";

  return (
    <ButtonGroup
      size="xs"
      isAttached
      aria-label={t("LaunchInterface.title")}
      data-launch-interface-switch
    >
      {(["a", "b"] as const).map((value) => (
        <Tooltip key={value} label={t(`LaunchInterface.${value}`)}>
          <Button
            aria-label={t(`LaunchInterface.${value}`)}
            aria-pressed={current === value}
            colorScheme={config.appearance.theme.primaryColor}
            variant={current === value ? "solid" : "outline"}
            onClick={() => {
              if (current !== value)
                update("appearance.theme.launchInterface", value);
            }}
          >
            {value.toUpperCase()}
          </Button>
        </Tooltip>
      ))}
    </ButtonGroup>
  );
};

export default LaunchInterfaceSwitch;
