import {
  Alert,
  AlertIcon,
  Badge,
  Box,
  Button,
  Card,
  FormControl,
  FormLabel,
  HStack,
  Heading,
  Icon,
  Input,
  Select,
  SimpleGrid,
  Skeleton,
  Switch,
  Tab,
  TabList,
  TabPanel,
  TabPanels,
  Tabs,
  Text,
  Textarea,
  VStack,
} from "@chakra-ui/react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { open, save } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import router from "next/router";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { LuKeyRound, LuShieldCheck } from "react-icons/lu";
import MaintenanceCommunityPanel from "@/components/maintenance-community-panel";
import { useLauncherConfig } from "@/contexts/config";
import { useToast } from "@/contexts/toast";
import { CampusDraft, MaintenanceStatus } from "@/models/maintenance";
import { CAMPUS_CONFIG_URLS } from "@/services/home-servers";
import { MaintenanceService } from "@/services/maintenance";

const MaintenanceWorkspace = () => {
  const { t } = useTranslation();
  const toast = useToast();
  const { config } = useLauncherConfig();
  const primaryColor = config.appearance.theme.primaryColor;
  const [status, setStatus] = useState<MaintenanceStatus | null>(null);
  const [draft, setDraft] = useState<CampusDraft | null>(null);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [verificationFailed, setVerificationFailed] = useState(false);

  const handleError = useCallback(
    (error: unknown) => {
      toast({
        title: t("MaintenanceSettingsPage.errorTitle"),
        description: t(`MaintenanceSettingsPage.errors.${String(error)}`, {
          defaultValue: t("MaintenanceSettingsPage.errors.unknown"),
        }),
        status: "error",
      });
      if (error === "UNAUTHORIZED") {
        setStatus((current) =>
          current ? { ...current, identity: null, invalidSavedKey: true } : null
        );
        setDraft(null);
      }
    },
    [t, toast]
  );

  const handleLoad = useCallback(async () => {
    setLoading(true);
    setVerificationFailed(false);
    try {
      const nextStatus = await MaintenanceService.retrieveStatus();
      setStatus(nextStatus);
      if (nextStatus.identity) {
        setDraft(await MaintenanceService.retrieveDraft());
        setDirty(false);
      } else {
        setDraft(null);
      }
    } catch (error) {
      setStatus(null);
      setDraft(null);
      setVerificationFailed(error === "MICROSOFT_VERIFICATION_FAILED");
      handleError(error);
    } finally {
      setLoading(false);
    }
  }, [handleError]);

  useEffect(() => {
    void handleLoad();
  }, [handleLoad]);

  const handleActivate = async (fromFile = false) => {
    setBusy(true);
    try {
      if (fromFile) {
        const path = await open({
          multiple: false,
          filters: [{ name: "SAUMCL Key", extensions: ["saumclkey"] }],
        });
        if (!path || typeof path !== "string") return;
        await MaintenanceService.importKey(path);
      } else {
        await MaintenanceService.activateKey(key.trim());
      }
      setKey("");
      await handleLoad();
    } catch (error) {
      handleError(error);
    } finally {
      setBusy(false);
    }
  };

  const handleDeactivate = async () => {
    setBusy(true);
    try {
      await MaintenanceService.deactivate();
      setDraft(null);
      setDirty(false);
      setKey("");
      setStatus((current) =>
        current ? { ...current, identity: null, invalidSavedKey: false } : null
      );
    } catch (error) {
      handleError(error);
    } finally {
      setBusy(false);
    }
  };

  const handleDraftChange = <K extends keyof CampusDraft>(
    field: K,
    value: CampusDraft[K]
  ) => {
    setDraft((current) => (current ? { ...current, [field]: value } : null));
    setDirty(true);
  };

  const handleSave = async () => {
    if (!draft) return;
    setBusy(true);
    try {
      await MaintenanceService.saveDraft(draft);
      setDirty(false);
      toast({ title: t("MaintenanceSettingsPage.saved"), status: "success" });
    } catch (error) {
      handleError(error);
    } finally {
      setBusy(false);
    }
  };

  const handleExport = async () => {
    if (!draft) return;
    setBusy(true);
    try {
      const path = await save({
        defaultPath: "campus-server.json",
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!path) return;
      await MaintenanceService.exportDraft(draft, path);
      toast({
        title: t("MaintenanceSettingsPage.exported"),
        status: "success",
      });
    } catch (error) {
      handleError(error);
    } finally {
      setBusy(false);
    }
  };

  const handlePreview = async () => {
    if (!draft) return;
    setBusy(true);
    try {
      await MaintenanceService.saveDraft(draft);
      await MaintenanceService.applyPreview(draft);
      setDirty(false);
      toast({
        title: t("MaintenanceSettingsPage.previewApplied"),
        status: "success",
      });
    } catch (error) {
      handleError(error);
    } finally {
      setBusy(false);
    }
  };

  const handleInspectPack = async () => {
    setBusy(true);
    try {
      const path = await open({
        multiple: false,
        filters: [{ name: "Modpack", extensions: ["zip", "mrpack"] }],
      });
      if (!path || typeof path !== "string") return;
      const info = await MaintenanceService.inspectModpack(path);
      const loaders: Record<string, CampusDraft["loader"]> = {
        Unknown: "none",
        Fabric: "fabric",
        Forge: "forge",
        LegacyForge: "forge",
        Cleanroom: "forge",
        NeoForge: "neoforge",
        Quilt: "quilt",
      };
      const loader = loaders[info.metadata.modLoader?.loaderType || "Unknown"];
      if (!loader) throw "PACK_FORMAT_UNSUPPORTED";
      setDraft((current) =>
        current
          ? {
              ...current,
              minecraftVersion: info.metadata.clientVersion,
              loader,
              loaderVersion: info.metadata.modLoader?.version || "",
              modpackVersion:
                current.modpackVersion || info.metadata.version || "",
              modpackSha256: info.sha256,
            }
          : current
      );
      setDirty(true);
      toast({
        title: t("MaintenanceSettingsPage.packInspected"),
        status: "success",
      });
    } catch (error) {
      handleError(error);
    } finally {
      setBusy(false);
    }
  };

  const handleCopyConfigUrl = async () => {
    try {
      await writeText(CAMPUS_CONFIG_URLS.join("\n"));
      toast({
        title: t("MaintenanceSettingsPage.configUrlCopied"),
        status: "success",
      });
    } catch (error) {
      handleError(error);
    }
  };

  const handleOpenConfigPage = async () => {
    try {
      await openUrl(
        "https://gitlab.com/Supaio/saumcl/-/edit/main/public/campus-server.json"
      );
    } catch (error) {
      handleError(error);
    }
  };

  const textField = (
    field:
      | "serverName"
      | "serverAddress"
      | "minecraftVersion"
      | "loaderVersion"
      | "modpackVersion"
      | "modpackUrl"
      | "modpackSha256",
    maxLength: number,
    placeholder?: string
  ) => (
    <FormControl>
      <FormLabel fontSize="sm" htmlFor={`campus-${field}`}>
        {t(`MaintenanceSettingsPage.fields.${field}`)}
      </FormLabel>
      <Input
        id={`campus-${field}`}
        size="sm"
        value={draft?.[field] ?? ""}
        maxLength={maxLength}
        placeholder={placeholder}
        isDisabled={busy}
        onChange={(event) => handleDraftChange(field, event.target.value)}
      />
    </FormControl>
  );

  return (
    <>
      <Heading size="xs">{t("MaintenanceSettingsPage.title")}</Heading>
      <Card p={4}>
        <VStack align="stretch" spacing={4}>
          <HStack justify="space-between" flexWrap="wrap" gap={2}>
            <HStack>
              <Icon as={status?.identity ? LuShieldCheck : LuKeyRound} />
              <Text fontWeight="medium">
                {t(
                  status?.identity
                    ? "MaintenanceSettingsPage.unlocked"
                    : "MaintenanceSettingsPage.locked"
                )}
              </Text>
            </HStack>
            {status?.identity && (
              <Button
                size="xs"
                variant="outline"
                isDisabled={busy || loading}
                onClick={handleDeactivate}
              >
                {t("MaintenanceSettingsPage.exit")}
              </Button>
            )}
          </HStack>
          <Skeleton isLoaded={!loading}>
            <Text fontSize="sm" className="secondary-text">
              {status?.identity
                ? t("MaintenanceSettingsPage.identity", {
                    name: status.identity.name,
                  })
                : t("MaintenanceSettingsPage.introduction")}
            </Text>
          </Skeleton>
          {!loading && status?.identity && (
            <HStack>
              <Badge colorScheme="green">
                {t("MaintenanceSettingsPage.permanent")}
              </Badge>
              <Text fontSize="xs" className="secondary-text">
                {t("MaintenanceSettingsPage.permanentDescription")}
              </Text>
            </HStack>
          )}
          {!loading && status && !status.identity && (
            <>
              {(!status.configured || status.invalidSavedKey) && (
                <Alert status="warning" borderRadius="md" fontSize="sm">
                  <AlertIcon />
                  {t(
                    !status.configured
                      ? "MaintenanceSettingsPage.notConfigured"
                      : "MaintenanceSettingsPage.invalidSavedKey"
                  )}
                </Alert>
              )}
            </>
          )}
          {!loading && status?.accountUuid && !status.identity && (
            <Box
              as="form"
              onSubmit={(event: FormEvent<HTMLFormElement>) => {
                event.preventDefault();
                if (!busy && status.configured && key.trim()) {
                  void handleActivate();
                }
              }}
            >
              <FormControl>
                <FormLabel fontSize="sm" htmlFor="maintenance-key">
                  {t("MaintenanceSettingsPage.keyLabel")}
                </FormLabel>
                <Input
                  id="maintenance-key"
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={8192}
                  value={key}
                  isDisabled={busy || !status.configured}
                  placeholder={t("MaintenanceSettingsPage.keyPlaceholder")}
                  onChange={(event) => setKey(event.target.value)}
                />
              </FormControl>
              <HStack mt={3} justify="flex-end">
                <Button
                  size="sm"
                  variant="outline"
                  isDisabled={busy || !status.configured}
                  onClick={() => handleActivate(true)}
                >
                  {t("MaintenanceSettingsPage.import")}
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  colorScheme={primaryColor}
                  isLoading={busy}
                  isDisabled={!status.configured || !key.trim()}
                >
                  {t("MaintenanceSettingsPage.activate")}
                </Button>
              </HStack>
            </Box>
          )}
          {!loading &&
            ((status && !status.accountUuid) || verificationFailed) && (
              <Button
                size="sm"
                alignSelf="flex-start"
                onClick={() => router.push("/accounts")}
              >
                {t("MaintenanceSettingsPage.openAccounts")}
              </Button>
            )}
          {!loading && (!status || (status.identity && !draft)) && (
            <Button size="sm" alignSelf="flex-start" onClick={handleLoad}>
              {t("MaintenanceSettingsPage.retry")}
            </Button>
          )}
        </VStack>
      </Card>
      {!loading && status?.identity && draft && (
        <Card p={4}>
          <VStack align="stretch" spacing={4}>
            <Alert status="info" borderRadius="md" fontSize="sm">
              <AlertIcon />
              {t("MaintenanceSettingsPage.localDraftNotice")}
            </Alert>
            <Tabs colorScheme={primaryColor} size="sm" isLazy>
              <TabList flexWrap="wrap">
                {["server", "modpack", "announcement", "preview"].map((tab) => (
                  <Tab key={tab}>
                    {t(`MaintenanceSettingsPage.tabs.${tab}`)}
                  </Tab>
                ))}
              </TabList>
              <TabPanels>
                <TabPanel px={0}>
                  <SimpleGrid columns={{ base: 1, xl: 2 }} spacing={4}>
                    {textField("serverName", 120)}
                    {textField(
                      "serverAddress",
                      255,
                      t("MaintenanceSettingsPage.addressPlaceholder")
                    )}
                    {textField("minecraftVersion", 64)}
                    <FormControl>
                      <FormLabel fontSize="sm" htmlFor="campus-loader">
                        {t("MaintenanceSettingsPage.fields.loader")}
                      </FormLabel>
                      <Select
                        id="campus-loader"
                        size="sm"
                        value={draft.loader}
                        isDisabled={busy}
                        onChange={(event) =>
                          handleDraftChange(
                            "loader",
                            event.target.value as CampusDraft["loader"]
                          )
                        }
                      >
                        <option value="none">
                          {t("MaintenanceSettingsPage.noLoader")}
                        </option>
                        <option value="fabric">Fabric</option>
                        <option value="forge">Forge</option>
                        <option value="neoforge">NeoForge</option>
                        <option value="quilt">Quilt</option>
                      </Select>
                    </FormControl>
                    {textField("loaderVersion", 64)}
                    {(["currentRound", "nextRound"] as const).map((field) => (
                      <FormControl key={field}>
                        <FormLabel fontSize="sm" htmlFor={`campus-${field}`}>
                          {t(`MaintenanceSettingsPage.fields.${field}`)}
                        </FormLabel>
                        <Input
                          id={`campus-${field}`}
                          type="number"
                          size="sm"
                          min={1}
                          max={9999}
                          value={draft[field] ?? ""}
                          isDisabled={busy}
                          onChange={(event) =>
                            handleDraftChange(
                              field,
                              event.target.value
                                ? Number(event.target.value)
                                : null
                            )
                          }
                        />
                      </FormControl>
                    ))}
                  </SimpleGrid>
                </TabPanel>
                <TabPanel px={0}>
                  <VStack align="stretch" spacing={4}>
                    {textField("modpackVersion", 64)}
                    {textField("modpackUrl", 2048, "https://…")}
                    {textField("modpackSha256", 64)}
                    <Button
                      id="campus-inspect-pack"
                      size="sm"
                      alignSelf="flex-start"
                      isDisabled={busy}
                      onClick={handleInspectPack}
                    >
                      {t("MaintenanceSettingsPage.inspectPack")}
                    </Button>
                    <Text fontSize="sm" className="secondary-text">
                      {t("MaintenanceSettingsPage.modpackDescription")}
                    </Text>
                  </VStack>
                </TabPanel>
                <TabPanel px={0}>
                  <VStack align="stretch" spacing={4}>
                    <FormControl>
                      <FormLabel fontSize="sm" htmlFor="campus-round-state">
                        {t("MaintenanceSettingsPage.fields.roundState")}
                      </FormLabel>
                      <Select
                        id="campus-round-state"
                        size="sm"
                        value={draft.roundState}
                        isDisabled={busy}
                        onChange={(event) =>
                          handleDraftChange(
                            "roundState",
                            event.target.value as CampusDraft["roundState"]
                          )
                        }
                      >
                        {(["auto", "active", "ended"] as const).map((value) => (
                          <option key={value} value={value}>
                            {t(`MaintenanceSettingsPage.roundStates.${value}`)}
                          </option>
                        ))}
                      </Select>
                    </FormControl>
                    <FormControl>
                      <FormLabel fontSize="sm" htmlFor="campus-offline-since">
                        {t("MaintenanceSettingsPage.fields.offlineSince")}
                      </FormLabel>
                      <Input
                        id="campus-offline-since"
                        type="datetime-local"
                        size="sm"
                        value={
                          draft.offlineSince
                            ? new Date(
                                Date.parse(draft.offlineSince) -
                                  new Date(
                                    draft.offlineSince
                                  ).getTimezoneOffset() *
                                    60000
                              )
                                .toISOString()
                                .slice(0, 16)
                            : ""
                        }
                        isDisabled={busy}
                        onChange={(event) => {
                          const timestamp = event.target.value
                            ? Date.parse(event.target.value)
                            : Number.NaN;
                          handleDraftChange(
                            "offlineSince",
                            Number.isFinite(timestamp)
                              ? new Date(timestamp).toISOString()
                              : null
                          );
                        }}
                      />
                      <Text fontSize="xs" mt={1} className="secondary-text">
                        {t("MaintenanceSettingsPage.offlineSinceDescription")}
                      </Text>
                    </FormControl>
                    <FormControl display="flex" alignItems="center">
                      <FormLabel
                        mb={0}
                        fontSize="sm"
                        htmlFor="campus-maintenance"
                      >
                        {t("MaintenanceSettingsPage.fields.maintenance")}
                      </FormLabel>
                      <Switch
                        id="campus-maintenance"
                        colorScheme={primaryColor}
                        isChecked={draft.maintenance}
                        isDisabled={busy}
                        onChange={(event) =>
                          handleDraftChange("maintenance", event.target.checked)
                        }
                      />
                    </FormControl>
                    <FormControl>
                      <FormLabel fontSize="sm" htmlFor="campus-announcement">
                        {t("MaintenanceSettingsPage.fields.announcement")}
                      </FormLabel>
                      <Textarea
                        id="campus-announcement"
                        value={draft.announcement}
                        maxLength={4000}
                        minH="160px"
                        isDisabled={busy}
                        onChange={(event) =>
                          handleDraftChange("announcement", event.target.value)
                        }
                      />
                    </FormControl>
                  </VStack>
                </TabPanel>
                <TabPanel px={0}>
                  <VStack align="stretch" spacing={3}>
                    <Text fontSize="sm" className="secondary-text">
                      {t("MaintenanceSettingsPage.previewDescription")}
                    </Text>
                    <Text fontSize="sm" fontWeight="semibold">
                      {t("MaintenanceSettingsPage.playerConfigUrl")}
                    </Text>
                    {CAMPUS_CONFIG_URLS.map((url) => (
                      <Input
                        key={url}
                        size="sm"
                        value={url}
                        isReadOnly
                        aria-label={`${t("MaintenanceSettingsPage.playerConfigUrl")} ${url.includes("raw.githubusercontent.com") ? "GitHub" : "GitLab"}`}
                      />
                    ))}
                    <HStack flexWrap="wrap">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleCopyConfigUrl}
                      >
                        {t("MaintenanceSettingsPage.copyConfigUrl")}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleOpenConfigPage}
                      >
                        {t("MaintenanceSettingsPage.openConfigPage")}
                      </Button>
                    </HStack>
                    <Text fontSize="xs" className="secondary-text">
                      {t("MaintenanceSettingsPage.publishInstructions")}
                    </Text>
                    <Text
                      as="pre"
                      fontFamily="mono"
                      fontSize="xs"
                      whiteSpace="pre-wrap"
                      overflowWrap="anywhere"
                      p={3}
                      bg="blackAlpha.50"
                      borderRadius="md"
                      maxH="360px"
                      overflowY="auto"
                      userSelect="text"
                    >
                      {JSON.stringify(draft, null, 2)}
                    </Text>
                  </VStack>
                </TabPanel>
              </TabPanels>
            </Tabs>
            <HStack justify="space-between" flexWrap="wrap" gap={2}>
              <Text fontSize="xs" className="secondary-text" aria-live="polite">
                {t(
                  dirty
                    ? "MaintenanceSettingsPage.unsaved"
                    : "MaintenanceSettingsPage.localOnly"
                )}
              </Text>
              <HStack flexWrap="wrap">
                <Button
                  size="sm"
                  variant="outline"
                  isDisabled={busy}
                  onClick={handlePreview}
                >
                  {t("MaintenanceSettingsPage.applyPreview")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  isDisabled={busy}
                  onClick={handleExport}
                >
                  {t("MaintenanceSettingsPage.export")}
                </Button>
                <Button
                  size="sm"
                  colorScheme={primaryColor}
                  isLoading={busy}
                  isDisabled={!dirty}
                  onClick={handleSave}
                >
                  {t("MaintenanceSettingsPage.save")}
                </Button>
              </HStack>
            </HStack>
          </VStack>
        </Card>
      )}
      {!loading && status?.identity && (
        <MaintenanceCommunityPanel onError={handleError} />
      )}
    </>
  );
};

const MaintenanceSettingsPage = () => {
  const { config } = useLauncherConfig();
  return <MaintenanceWorkspace key={config.states.shared.selectedPlayerId} />;
};

export default MaintenanceSettingsPage;
