import {
  Badge,
  Box,
  Button,
  Divider,
  HStack,
  Icon,
  Select,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { LuBox, LuPlay, LuServer } from "react-icons/lu";
import { CommonIconButton } from "@/components/common/common-icon-button";
import { HomeTile } from "@/components/common/home-tile";
import { useCowDrop } from "@/contexts/cow-drop";
import { useGlobalData } from "@/contexts/global-data";
import { useSharedModals } from "@/contexts/shared-modal";
import { useToast } from "@/contexts/toast";
import {
  CampusObservation,
  HomeServer,
  InstanceServers,
} from "@/models/home-servers";
import { GameServerInfo } from "@/models/instance/misc";
import { CampusDraft } from "@/models/maintenance";
import { HomeServersService } from "@/services/home-servers";
import { CAMPUS_PREVIEW_CHANGED_EVENT } from "@/services/maintenance";
import {
  buildHomeServers,
  campusInstanceCandidates,
  campusInstanceKey,
  campusRoundEnded,
  normalizeServerAddress,
  observeCampus,
  selectCampusInstance,
} from "@/utils/home-servers";

const OBSERVATION_KEY = "saumcl.campus.observation";
const INSTANCE_KEY = "saumcl.campus.instance";

const HomeServersCard = () => {
  const { t } = useTranslation();
  const toast = useToast();
  const { getInstanceList, selectedInstance } = useGlobalData();
  const { isGameLaunchBlocked } = useCowDrop();
  const { openSharedModal } = useSharedModals();
  const instanceList = getInstanceList();
  const instances = useMemo(
    () =>
      (instanceList || []).map(({ id, name, version }) => ({
        id,
        name,
        version,
      })),
    [instanceList]
  );
  const [profile, setProfile] = useState<CampusDraft | null>(null);
  const [groups, setGroups] = useState<InstanceServers[]>([]);
  const [pings, setPings] = useState<Record<string, GameServerInfo>>({});
  const [observation, setObservation] = useState<CampusObservation | null>(
    null
  );
  const [now, setNow] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [failed, setFailed] = useState(false);
  const [preview, setPreview] = useState(false);
  const [previewRevision, setPreviewRevision] = useState(0);
  const [stale, setStale] = useState(false);
  const [incomplete, setIncomplete] = useState(false);
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [campusPick, setCampusPick] = useState<{
    key: string;
    instanceId: string;
  } | null>(null);
  const refreshRef = useRef<(() => Promise<void>) | null>(null);
  const observationRef = useRef<CampusObservation | null>(null);

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(INSTANCE_KEY) || "null");
      if (
        stored &&
        typeof stored.key === "string" &&
        typeof stored.instanceId === "string"
      ) {
        setCampusPick(stored);
      }
    } catch {
      // Select from installed instances if no saved campus choice is available.
    }
  }, []);

  useEffect(() => {
    let active = true;
    let pending = false;
    try {
      observationRef.current = JSON.parse(
        localStorage.getItem(OBSERVATION_KEY) || "null"
      );
    } catch {
      observationRef.current = null;
    }
    const refresh = async () => {
      if (pending || document.visibilityState === "hidden") return;
      pending = true;
      setRefreshing(true);
      try {
        const [campus, local] = await Promise.all([
          HomeServersService.retrieveCampus(),
          HomeServersService.retrieveLocal(instances),
        ]);
        if (!active) return;
        setProfile(campus.profile);
        setPreview(campus.preview);
        setStale(campus.stale);
        setGroups(local.groups);
        setIncomplete(local.incomplete);
        const rows = buildHomeServers(campus.profile, local.groups);
        const results = await HomeServersService.queryAddresses(
          rows.map(({ address }) => address).filter(Boolean)
        );
        if (!active) return;
        const nextPings = Object.fromEntries(
          results.map((ping) => [normalizeServerAddress(ping.ip), ping])
        );
        setPings(nextPings);
        const timestamp = Date.now();
        setNow(timestamp);
        const campusPing =
          nextPings[normalizeServerAddress(campus.profile.serverAddress)];
        if (campus.profile.serverAddress.trim() && campusPing?.isQueried) {
          const nextObservation = observeCampus(
            campus.profile,
            observationRef.current,
            campusPing.online,
            timestamp
          );
          observationRef.current = nextObservation;
          setObservation(nextObservation);
          try {
            localStorage.setItem(
              OBSERVATION_KEY,
              JSON.stringify(nextObservation)
            );
          } catch {
            // Keep the current session's observations if storage is unavailable.
          }
        }
        setFailed(false);
      } catch {
        if (active) setFailed(true);
      } finally {
        pending = false;
        if (active) setRefreshing(false);
      }
    };
    refreshRef.current = refresh;
    void refresh();
    const timer = setInterval(() => void refresh(), 60000);
    const handleVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const handlePreviewChanged = () => {
      active = false;
      setProfile(null);
      setPreview(false);
      setPreviewRevision((revision) => revision + 1);
    };
    document.addEventListener("visibilitychange", handleVisible);
    window.addEventListener(CAMPUS_PREVIEW_CHANGED_EVENT, handlePreviewChanged);
    return () => {
      active = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisible);
      window.removeEventListener(
        CAMPUS_PREVIEW_CHANGED_EVENT,
        handlePreviewChanged
      );
      if (refreshRef.current === refresh) refreshRef.current = null;
    };
  }, [instances, previewRevision]);

  const rows = profile ? buildHomeServers(profile, groups) : [];
  const campusCandidates = profile
    ? campusInstanceCandidates(profile, instanceList || [])
    : [];
  const campusInstance = selectCampusInstance(
    campusCandidates,
    profile && campusPick?.key === campusInstanceKey(profile)
      ? campusPick.instanceId
      : undefined,
    selectedInstance?.id
  );
  const ended = profile
    ? campusRoundEnded(
        profile,
        pings[normalizeServerAddress(profile.serverAddress)]?.online,
        observation,
        now
      )
    : false;

  const handleCopy = async (address: string) => {
    try {
      await writeText(address);
      toast({ title: t("HomeServersCard.copied"), status: "success" });
    } catch {
      toast({ title: t("HomeServersCard.copyFailed"), status: "error" });
    }
  };

  const selectedFor = (row: HomeServer) =>
    row.campus
      ? campusInstance
      : row.instances.find(({ id }) => id === picks[row.id]) ||
        row.instances.find(({ id }) => id === selectedInstance?.id) ||
        row.instances[0];

  const handlePickCampusInstance = (instanceId: string) => {
    if (!profile) return;
    const choice = { key: campusInstanceKey(profile), instanceId };
    setCampusPick(choice);
    try {
      localStorage.setItem(INSTANCE_KEY, JSON.stringify(choice));
    } catch {
      // Keep the current session's campus choice.
    }
  };

  const handleLaunch = (row: HomeServer) => {
    const instance = selectedFor(row);
    if (
      !row.address ||
      isGameLaunchBlocked ||
      (row.campus && (ended || profile?.maintenance))
    ) {
      return;
    }
    if (row.campus && profile?.modpackUrl.trim()) {
      openSharedModal("campus-client", { preferredInstanceId: instance?.id });
      return;
    }
    if (!instance) return;
    if (row.campus) handlePickCampusInstance(instance.id);
    openSharedModal("launch", {
      instanceId: instance.id,
      quickPlayMultiplayer: row.address,
    });
  };

  return (
    <HomeTile
      tileId="home-servers"
      title={t("HomeServersCard.title")}
      icon={LuServer}
      headerExtra={preview && <Badge>{t("HomeServersCard.preview")}</Badge>}
      actions={
        <HStack>
          {refreshing && <Spinner size="xs" />}
          <CommonIconButton
            icon="refresh"
            size="xs"
            variant="ghost"
            isDisabled={refreshing}
            onClick={() => void refreshRef.current?.()}
          />
        </HStack>
      }
    >
      <VStack align="stretch" spacing={3}>
        {rows.map((row, index) => {
          const candidates = row.campus ? campusCandidates : row.instances;
          const ping = pings[normalizeServerAddress(row.address)];
          const current = selectedFor(row);
          const status =
            row.campus && ended
              ? "ended"
              : !row.address
                ? "pending"
                : !ping?.isQueried
                  ? "checking"
                  : ping.online
                    ? "online"
                    : "offline";
          const launchDisabled =
            (!current &&
              !(
                row.campus &&
                profile?.modpackUrl.trim() &&
                profile.modpackVersion.trim()
              )) ||
            (row.campus && !instanceList) ||
            (row.campus &&
              Boolean(profile?.modpackUrl.trim()) &&
              !profile?.modpackVersion.trim()) ||
            !row.address ||
            isGameLaunchBlocked ||
            (row.campus && (ended || profile?.maintenance));
          const campusHint = !row.address
            ? t("HomeServersCard.addressPending")
            : ended
              ? t("HomeServersCard.status.ended")
              : profile?.maintenance
                ? t("HomeServersCard.maintenance")
                : isGameLaunchBlocked
                  ? t("CowDropGame.launchBlocked")
                  : !instanceList
                    ? t("HomeServersCard.loading")
                    : profile?.modpackUrl.trim() &&
                        !profile.modpackVersion.trim()
                      ? t("HomeServersCard.packVersionRequired")
                      : profile?.modpackUrl.trim()
                        ? t("HomeServersCard.autoPrepare")
                        : !candidates.length
                          ? t("HomeServersCard.noCampusInstance")
                          : !current
                            ? t("HomeServersCard.chooseCampusInstance")
                            : t("HomeServersCard.join");
          return (
            <Box key={row.id}>
              {index === 1 && <Divider mb={3} />}
              <HStack align="flex-start" spacing={3}>
                <Box position="relative" mt={0.5} flexShrink={0}>
                  <Box p={2} borderRadius="md" bg="blackAlpha.100">
                    <Icon as={LuBox} boxSize={6} color="blue.400" />
                  </Box>
                  <Box
                    position="absolute"
                    right={-0.5}
                    bottom={-0.5}
                    boxSize={2.5}
                    borderRadius="full"
                    bg={
                      ping?.online
                        ? "green.400"
                        : status === "offline"
                          ? "orange.400"
                          : "gray.400"
                    }
                  />
                </Box>
                <VStack flex={1} minW={0} align="stretch" spacing={1}>
                  <HStack spacing={2} flexWrap="wrap">
                    <Text fontSize="sm" fontWeight="bold" noOfLines={1}>
                      {row.name}
                    </Text>
                    {row.campus && (
                      <Badge colorScheme="blue">
                        {t("HomeServersCard.pinned")}
                      </Badge>
                    )}
                  </HStack>
                  <Text
                    fontSize="xs"
                    className="secondary-text"
                    overflowWrap="anywhere"
                  >
                    {row.address || t("HomeServersCard.addressPending")}
                  </Text>
                  <HStack spacing={2} flexWrap="wrap">
                    <Text
                      fontSize="xs"
                      fontWeight={status === "ended" ? "bold" : "normal"}
                    >
                      {t(`HomeServersCard.status.${status}`)}
                    </Text>
                    {ping?.online && (
                      <Text fontSize="xs" className="secondary-text">
                        {t("HomeServersCard.players", {
                          online: ping.playersOnline ?? 0,
                          max: ping.playersMax ?? "?",
                        })}
                        {ping.latency != null && ` · ${ping.latency} ms`}
                      </Text>
                    )}
                    {row.campus && profile?.maintenance && !ended && (
                      <Badge colorScheme="orange">
                        {t("HomeServersCard.maintenance")}
                      </Badge>
                    )}
                  </HStack>
                  {row.campus && profile && (
                    <HStack spacing={2} flexWrap="wrap">
                      {profile.currentRound != null && (
                        <Text fontSize="xs" className="secondary-text">
                          {t("HomeServersCard.currentRound", {
                            round: profile.currentRound,
                          })}
                        </Text>
                      )}
                      {profile.nextRound != null && (
                        <Text fontSize="xs" color="blue.400">
                          {t("HomeServersCard.nextRound", {
                            round: profile.nextRound,
                          })}
                        </Text>
                      )}
                    </HStack>
                  )}
                  {row.campus && profile?.announcement && (
                    <Text fontSize="xs" whiteSpace="pre-wrap">
                      {profile.announcement}
                    </Text>
                  )}
                  {candidates.length > 1 ? (
                    <Select
                      id={row.campus ? "campus-instance-select" : undefined}
                      size="xs"
                      maxW="100%"
                      aria-label={t("HomeServersCard.chooseInstance")}
                      value={current?.id ?? ""}
                      placeholder={
                        !current
                          ? t("HomeServersCard.chooseCampusInstance")
                          : undefined
                      }
                      onChange={(event) => {
                        if (row.campus) {
                          handlePickCampusInstance(event.target.value);
                        } else {
                          setPicks((previous) => ({
                            ...previous,
                            [row.id]: event.target.value,
                          }));
                        }
                      }}
                    >
                      {candidates.map((instance) => (
                        <option key={instance.id} value={instance.id}>
                          {instance.name} · {instance.version}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    current && (
                      <Text fontSize="xs" className="secondary-text">
                        {t(
                          row.campus
                            ? "HomeServersCard.campusInstance"
                            : "HomeServersCard.instance",
                          {
                            name: current.name,
                            version: current.version,
                          }
                        )}
                      </Text>
                    )
                  )}
                  {row.campus && row.address && !current && (
                    <Text fontSize="xs" className="secondary-text">
                      {campusHint}
                    </Text>
                  )}
                </VStack>
                <VStack spacing={0} align="flex-end">
                  <CommonIconButton
                    icon="copy"
                    size="xs"
                    variant="ghost"
                    isDisabled={!row.address}
                    onClick={() => void handleCopy(row.address)}
                  />
                  {row.campus ? (
                    <Button
                      id="campus-server-button"
                      size="xs"
                      w="fit-content"
                      minW={0}
                      px={2}
                      colorScheme={launchDisabled ? "gray" : "blue"}
                      leftIcon={<LuPlay />}
                      isDisabled={Boolean(launchDisabled)}
                      title={campusHint}
                      onClick={() => handleLaunch(row)}
                    >
                      {t("LaunchPage.button.joinCampusServer")}
                    </Button>
                  ) : (
                    <CommonIconButton
                      icon="launch"
                      label={t("HomeServersCard.join")}
                      size="xs"
                      variant="ghost"
                      isDisabled={Boolean(launchDisabled)}
                      onClick={() => handleLaunch(row)}
                    />
                  )}
                </VStack>
              </HStack>
            </Box>
          );
        })}
        {!profile && (
          <Text fontSize="sm" className="secondary-text">
            {t(
              failed ? "HomeServersCard.loadFailed" : "HomeServersCard.loading"
            )}
          </Text>
        )}
        {profile && rows.length === 1 && (
          <Text fontSize="xs" className="secondary-text">
            {t("HomeServersCard.noLocalServers")}
          </Text>
        )}
        {(failed || stale || incomplete) && profile && (
          <Text fontSize="xs" color="orange.400">
            {t(
              incomplete
                ? "HomeServersCard.incomplete"
                : "HomeServersCard.refreshFailed"
            )}
          </Text>
        )}
      </VStack>
    </HomeTile>
  );
};

export default HomeServersCard;
