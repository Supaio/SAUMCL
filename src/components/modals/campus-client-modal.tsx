import {
  Alert,
  AlertIcon,
  Box,
  Button,
  HStack,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  ModalProps,
  Progress,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLauncherConfig } from "@/contexts/config";
import { useCowDrop } from "@/contexts/cow-drop";
import { useGlobalDataDispatch } from "@/contexts/global-data";
import { useSharedModals } from "@/contexts/shared-modal";
import { CampusDraft } from "@/models/maintenance";
import { CampusInstallStatus, CampusService } from "@/services/campus";
import { HomeServersService } from "@/services/home-servers";
import { InstanceService } from "@/services/instance";
import { campusClientIdentity, campusInstanceKey } from "@/utils/home-servers";

interface CampusClientModalProps extends Omit<ModalProps, "children"> {
  preferredInstanceId?: string;
}

const CampusClientModal = ({
  preferredInstanceId,
  ...props
}: CampusClientModalProps) => {
  const { t } = useTranslation();
  const { config, getJavaInfos } = useLauncherConfig();
  const { canLaunchGame } = useCowDrop();
  const { setInstanceList } = useGlobalDataDispatch();
  const { openSharedModal } = useSharedModals();
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [profile, setProfile] = useState<CampusDraft | null>(null);
  const [progress, setProgress] = useState<CampusInstallStatus | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const [ready, setReady] = useState<{
    id: string;
    profile: CampusDraft;
  } | null>(null);
  const currentRequest = useRef(requestId);
  currentRequest.current = requestId;
  const started = useRef("");
  const closed = useRef(false);
  const canLaunchRef = useRef(canLaunchGame);
  canLaunchRef.current = canLaunchGame;

  useEffect(() => {
    closed.current = false;
    return () => {
      closed.current = true;
      const operation = currentRequest.current;
      // Strict Mode replays effects without actually closing the modal.
      queueMicrotask(() => {
        if (closed.current)
          void CampusService.cancel(operation).catch(() => {});
      });
    };
  }, []);

  useEffect(() => {
    const poll = async () => {
      try {
        const next = await CampusService.status();
        if (
          !closed.current &&
          currentRequest.current === requestId &&
          next.requestId === requestId
        )
          setProgress(next);
      } catch {
        // The preparation command remains authoritative if a progress poll fails.
      }
    };
    const timer = setInterval(() => void poll(), 500);
    void poll();
    return () => clearInterval(timer);
  }, [requestId]);

  const handleClose = useCallback(() => {
    closed.current = true;
    void CampusService.cancel(currentRequest.current).catch(() => {});
    props.onClose();
  }, [props]);

  const handleJoin = useCallback(
    async (id: string, preparedProfile: CampusDraft, operation: string) => {
      const latest = await HomeServersService.retrieveCampus();
      if (closed.current || currentRequest.current !== operation) return;
      if (
        campusClientIdentity(latest.profile) !==
        campusClientIdentity(preparedProfile)
      )
        throw "CONFIG_CHANGED";
      if (
        !latest.profile.serverAddress ||
        latest.profile.maintenance ||
        latest.profile.roundState === "ended"
      )
        throw "CAMPUS_UNAVAILABLE";
      if (!canLaunchRef.current()) throw "COW_BLOCKED";
      const instances = await InstanceService.retrieveInstanceList();
      if (closed.current || currentRequest.current !== operation) return;
      if (
        instances.status !== "success" ||
        !instances.data.some((instance) => instance.id === id)
      )
        throw "INSTANCE_NOT_READY";
      setInstanceList(instances.data);
      getJavaInfos(true);
      try {
        localStorage.setItem(
          "saumcl.campus.instance",
          JSON.stringify({
            key: campusInstanceKey(latest.profile),
            instanceId: id,
          })
        );
      } catch {
        // The installed receipt still allows discovery after restarting.
      }
      props.onClose();
      openSharedModal("launch", {
        instanceId: id,
        quickPlayMultiplayer: latest.profile.serverAddress,
      });
    },
    [getJavaInfos, openSharedModal, props, setInstanceList]
  );

  useEffect(() => {
    if (started.current === requestId) return;
    started.current = requestId;
    closed.current = false;
    setBusy(true);
    setError("");
    setReady(null);
    setProgress(null);
    const run = async () => {
      try {
        const next = await HomeServersService.retrieveCampus();
        if (closed.current || currentRequest.current !== requestId) return;
        setProfile(next.profile);
        const id = await CampusService.prepare(
          next.profile,
          requestId,
          preferredInstanceId
        );
        if (closed.current || currentRequest.current !== requestId) return;
        setReady({ id, profile: next.profile });
        await handleJoin(id, next.profile, requestId);
      } catch (failure) {
        if (!closed.current && currentRequest.current === requestId)
          setError(String(failure));
      } finally {
        if (!closed.current && currentRequest.current === requestId)
          setBusy(false);
      }
    };
    void run();
  }, [handleJoin, preferredInstanceId, requestId]);

  const handleRetry = () => {
    setRequestId(crypto.randomUUID());
  };
  const handleContinue = async () => {
    if (!ready) return;
    setBusy(true);
    setError("");
    try {
      await handleJoin(ready.id, ready.profile, currentRequest.current);
    } catch (failure) {
      if (!closed.current) setError(String(failure));
    } finally {
      if (!closed.current) setBusy(false);
    }
  };
  const phase = progress?.phase || "preparing";
  const percent = progress?.total
    ? Math.min(100, (progress.current * 100) / progress.total)
    : undefined;
  const size = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MiB`;

  return (
    <Modal
      {...props}
      onClose={handleClose}
      closeOnOverlayClick={false}
      size="lg"
    >
      <ModalOverlay />
      <ModalContent id="campus-client-modal">
        <ModalHeader>{t("CampusClientModal.title")}</ModalHeader>
        <ModalCloseButton />
        <ModalBody>
          <VStack align="stretch" spacing={4}>
            {profile && (
              <Box>
                <Text fontWeight="semibold">{profile.serverName}</Text>
                <Text fontSize="sm" className="secondary-text">
                  {t("CampusClientModal.version", {
                    version: profile.modpackVersion || profile.minecraftVersion,
                  })}
                </Text>
              </Box>
            )}
            <Text fontSize="sm">{t("CampusClientModal.description")}</Text>
            <Box aria-live="polite">
              <HStack justify="space-between" mb={2}>
                <Text fontSize="sm">
                  {t(`CampusClientModal.phases.${phase}`, {
                    defaultValue: t("CampusClientModal.phases.preparing"),
                  })}
                </Text>
                {percent !== undefined && (
                  <Text fontSize="xs">{Math.floor(percent)}%</Text>
                )}
              </HStack>
              <Progress
                isIndeterminate={busy && percent === undefined}
                value={percent ?? (ready ? 100 : 0)}
                borderRadius="md"
                colorScheme={config.appearance.theme.primaryColor}
              />
              {progress && progress.current > 0 && (
                <Text fontSize="xs" mt={1} className="secondary-text">
                  {size(progress.current)}
                  {progress.total ? ` / ${size(progress.total)}` : ""}
                </Text>
              )}
            </Box>
            {error && (
              <Alert status="error" borderRadius="md" alignItems="flex-start">
                <AlertIcon />
                <Text fontSize="sm">
                  {t(`CampusClientModal.errors.${error}`, {
                    defaultValue: t("CampusClientModal.errors.UNKNOWN"),
                  })}
                </Text>
              </Alert>
            )}
            <Text fontSize="xs" className="secondary-text">
              {t("CampusClientModal.preserveData")}
            </Text>
          </VStack>
        </ModalBody>
        <ModalFooter gap={2}>
          <Button size="sm" variant="ghost" onClick={handleClose}>
            {t("General.cancel")}
          </Button>
          {!busy && error && (
            <Button
              size="sm"
              colorScheme={config.appearance.theme.primaryColor}
              onClick={
                error === "COW_BLOCKED" && ready ? handleContinue : handleRetry
              }
            >
              {t(
                error === "COW_BLOCKED" && ready
                  ? "CampusClientModal.continue"
                  : "CampusClientModal.retry"
              )}
            </Button>
          )}
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};

export default CampusClientModal;
