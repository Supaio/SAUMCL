import {
  Alert,
  AlertIcon,
  Badge,
  Box,
  Button,
  Card,
  Checkbox,
  FormControl,
  FormLabel,
  HStack,
  Heading,
  Input,
  Select,
  SimpleGrid,
  Spinner,
  Tab,
  TabList,
  TabPanel,
  TabPanels,
  Tabs,
  Text,
  Textarea,
  VStack,
} from "@chakra-ui/react";
import { save } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { LuExternalLink, LuGift, LuPlus, LuTrash2 } from "react-icons/lu";
import { useToast } from "@/contexts/toast";
import { CommunityDraft, CommunityLink, RewardOffer } from "@/models/community";
import { CommunityService } from "@/services/community";
import {
  officialRewardUrl,
  validCommunityLink,
  validReward,
} from "@/utils/community";

const SCAN_INTERVAL = 6 * 60 * 60 * 1000;

const MaintenanceCommunityPanel = ({
  onError,
}: {
  onError: (error: unknown) => void;
}) => {
  const { t } = useTranslation();
  const toast = useToast();
  const [draft, setDraft] = useState<CommunityDraft | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [linkId, setLinkId] = useState("");
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [reload, setReload] = useState(0);
  const stateRef = useRef({ draft, busy, dirty });
  stateRef.current = { draft, busy, dirty };
  const reward = draft?.rewards.find((item) => item.offer.id === selectedId);
  const link = draft?.links.find((item) => item.id === linkId);
  const notify = (key: string) =>
    toast({ title: t(`MaintenanceCommunity.${key}`), status: "success" });

  const handleCollect = useCallback(async () => {
    if (
      stateRef.current.busy ||
      stateRef.current.dirty ||
      document.visibilityState === "hidden"
    )
      return;
    setBusy(true);
    try {
      const result = await CommunityService.collectCandidates();
      setDraft(result);
      setSelectedId((current) =>
        result.rewards.some((item) => item.offer.id === current)
          ? current
          : ((
              result.rewards.find((item) => item.status === "pending") ??
              result.rewards[0]
            )?.offer.id ?? "")
      );
    } catch (error) {
      onError(error);
    } finally {
      setBusy(false);
    }
  }, [onError]);

  useEffect(() => {
    let active = true;
    setBusy(true);
    const load = async () => {
      try {
        let result = await CommunityService.retrieveDraft();
        if (!active) return;
        setDraft(result);
        const due =
          !result.lastCollectedAt ||
          Date.now() - Date.parse(result.lastCollectedAt) >= SCAN_INTERVAL;
        if (due && document.visibilityState !== "hidden") {
          try {
            result = await CommunityService.collectCandidates();
          } catch (error) {
            if (active) onError(error);
          }
        }
        if (active) {
          setDraft(result);
          setSelectedId(
            (
              result.rewards.find((item) => item.status === "pending") ??
              result.rewards[0]
            )?.offer.id ?? ""
          );
          setLinkId(result.links[0]?.id ?? "");
        }
      } catch (error) {
        if (active) onError(error);
      } finally {
        if (active) setBusy(false);
      }
    };
    void load();
    const checkDue = () => {
      const current = stateRef.current;
      if (
        current.draft &&
        (!current.draft.lastCollectedAt ||
          Date.now() - Date.parse(current.draft.lastCollectedAt) >=
            SCAN_INTERVAL)
      )
        void handleCollect();
    };
    const timer = setInterval(checkDue, 30 * 60 * 1000);
    document.addEventListener("visibilitychange", checkDue);
    return () => {
      active = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", checkDue);
    };
  }, [handleCollect, onError, reload]);

  const updateOffer = (patch: Partial<RewardOffer>) => {
    if (!draft || !reward) return;
    setDraft({
      ...draft,
      rewards: draft.rewards.map((item) =>
        item.offer.id === selectedId
          ? {
              ...item,
              offer: { ...item.offer, ...patch },
              status: "pending",
              reviewedAt: null,
            }
          : item
      ),
    });
    setDirty(true);
  };
  const updateLink = (patch: Partial<CommunityLink>) => {
    if (!draft) return;
    setDraft({
      ...draft,
      links: draft.links.map((item) =>
        item.id === linkId ? { ...item, ...patch } : item
      ),
    });
    setDirty(true);
  };
  const validDraft = (next: CommunityDraft) =>
    next.rewards.every((item) =>
      validReward(item.offer, item.status === "approved")
    ) && next.links.every(validCommunityLink);
  const persist = async (next: CommunityDraft) => {
    if (!validDraft(next)) {
      onError("INVALID_DRAFT");
      return false;
    }
    await CommunityService.saveDraft(next);
    setDraft(next);
    setDirty(false);
    return true;
  };
  const handleSave = async () => {
    if (!draft) return;
    setBusy(true);
    try {
      if (await persist(draft)) notify("saved");
    } catch (error) {
      onError(error);
    } finally {
      setBusy(false);
    }
  };
  const handleReview = async (status: "approved" | "rejected") => {
    if (!draft || !reward) return;
    if (status === "approved" && !validReward(reward.offer, true)) {
      toast({
        title: t("MaintenanceCommunity.incomplete"),
        description: t("MaintenanceCommunity.reviewHint"),
        status: "warning",
      });
      return;
    }
    setBusy(true);
    try {
      const next: CommunityDraft = {
        ...draft,
        rewards: draft.rewards.map((item) =>
          item.offer.id === selectedId
            ? { ...item, status, reviewedAt: new Date().toISOString() }
            : item
        ),
      };
      if (await persist(next))
        notify(status === "approved" ? "approvedSaved" : "rejectedSaved");
    } catch (error) {
      onError(error);
    } finally {
      setBusy(false);
    }
  };
  const handlePreview = async (clear = false) => {
    if (!draft) return;
    setBusy(true);
    try {
      await CommunityService.applyPreview(clear ? null : draft);
      notify(clear ? "previewCleared" : "previewApplied");
    } catch (error) {
      onError(error);
    } finally {
      setBusy(false);
    }
  };
  const handleExport = async () => {
    if (!draft) return;
    setBusy(true);
    try {
      const path = await save({
        defaultPath: "community.json",
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!path) return;
      await CommunityService.exportFeed(draft, path);
      notify("exported");
    } catch (error) {
      onError(error);
    } finally {
      setBusy(false);
    }
  };
  const handleOpenRules = async () => {
    if (!reward || !officialRewardUrl(reward.offer.sourceUrl)) return;
    try {
      await openUrl(reward.offer.sourceUrl);
    } catch {
      toast({ title: t("Community.openFailed"), status: "error" });
    }
  };
  const handleAddReward = () => {
    if (!draft) return;
    const id = crypto.randomUUID();
    setDraft({
      ...draft,
      rewards: [
        ...draft.rewards,
        {
          offer: {
            id,
            title: "",
            description: "",
            kind: "other",
            edition: "unknown",
            sourceUrl: "",
            claimUrl: "",
            startsAt: null,
            earnUntil: null,
            redeemUntil: null,
            requiresCode: false,
            noEndDate: false,
          },
          status: "pending",
          reviewedAt: null,
        },
      ],
    });
    setSelectedId(id);
    setDirty(true);
  };
  const handleAddLink = () => {
    if (!draft) return;
    const id = crypto.randomUUID();
    setDraft({
      ...draft,
      links: [
        ...draft.links,
        {
          id,
          section: "sau",
          kind: "qq",
          name: "",
          description: "",
          groupNumber: "",
          url: "",
          enabled: false,
        },
      ],
    });
    setLinkId(id);
    setDirty(true);
  };
  const offerInput = (
    key: "title" | "sourceUrl" | "claimUrl",
    maxLength: number
  ) =>
    reward && (
      <FormControl>
        <FormLabel fontSize="sm">{t(`Community.fields.${key}`)}</FormLabel>
        <Input
          size="sm"
          id={`reward-${key}`}
          value={reward.offer[key]}
          maxLength={maxLength}
          isDisabled={busy}
          onChange={(event) => updateOffer({ [key]: event.target.value })}
        />
      </FormControl>
    );

  return (
    <Card id="maintenance-community-panel" p={4}>
      <VStack align="stretch" spacing={4}>
        <HStack>
          <LuGift />
          <Heading size="sm">{t("MaintenanceCommunity.title")}</Heading>
          {busy && <Spinner size="sm" ml="auto" />}
        </HStack>
        <Alert status="info" borderRadius="md" fontSize="sm">
          <AlertIcon />
          {t("MaintenanceCommunity.localNotice")}
        </Alert>
        {!draft && !busy && (
          <Button size="sm" onClick={() => setReload((value) => value + 1)}>
            {t("MaintenanceSettingsPage.retry")}
          </Button>
        )}
        {draft && (
          <>
            <Tabs size="sm" colorScheme="blue" isLazy>
              <TabList>
                <Tab>
                  {t("MaintenanceCommunity.rewardsTab")}
                  <Badge ml={2}>
                    {
                      draft.rewards.filter((item) => item.status === "pending")
                        .length
                    }
                  </Badge>
                </Tab>
                <Tab>{t("FriendsPage.title")}</Tab>
              </TabList>
              <TabPanels>
                <TabPanel px={0}>
                  <VStack align="stretch" spacing={4}>
                    <Text fontSize="xs" className="secondary-text">
                      {t("MaintenanceCommunity.collectHint")}
                    </Text>
                    <HStack flexWrap="wrap" gap={2}>
                      <Button
                        size="sm"
                        id="collect-rewards"
                        isDisabled={busy || dirty}
                        title={
                          dirty
                            ? t("MaintenanceCommunity.saveBeforeCollect")
                            : undefined
                        }
                        onClick={() => void handleCollect()}
                      >
                        {t("MaintenanceCommunity.collect")}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        leftIcon={<LuPlus />}
                        isDisabled={busy || draft.rewards.length >= 200}
                        onClick={handleAddReward}
                      >
                        {t("MaintenanceCommunity.addReward")}
                      </Button>
                      <Text fontSize="xs" className="secondary-text">
                        {t("MaintenanceCommunity.lastCollected", {
                          date: draft.lastCollectedAt
                            ? new Date(draft.lastCollectedAt).toLocaleString()
                            : t("MaintenanceCommunity.never"),
                        })}
                      </Text>
                    </HStack>
                    {!draft.rewards.length ? (
                      <Text fontSize="sm" className="secondary-text">
                        {t("MaintenanceCommunity.inboxEmpty")}
                      </Text>
                    ) : (
                      <FormControl>
                        <FormLabel fontSize="sm">
                          {t("MaintenanceCommunity.chooseReward")}
                        </FormLabel>
                        <Select
                          size="sm"
                          id="reward-select"
                          value={selectedId}
                          isDisabled={busy}
                          onChange={(event) =>
                            setSelectedId(event.target.value)
                          }
                        >
                          {draft.rewards.map((item) => (
                            <option key={item.offer.id} value={item.offer.id}>
                              [{t(`MaintenanceCommunity.status.${item.status}`)}
                              ]{" "}
                              {item.offer.title ||
                                t("MaintenanceCommunity.untitled")}
                            </option>
                          ))}
                        </Select>
                      </FormControl>
                    )}
                    {reward && (
                      <>
                        <Alert status="warning" borderRadius="md" fontSize="xs">
                          <AlertIcon />
                          {t("MaintenanceCommunity.reviewHint")}
                        </Alert>
                        {offerInput("title", 200)}
                        <SimpleGrid columns={{ base: 1, lg: 2 }} spacing={3}>
                          <FormControl>
                            <FormLabel fontSize="sm">
                              {t("Community.fields.kind")}
                            </FormLabel>
                            <Select
                              size="sm"
                              id="reward-kind"
                              isDisabled={busy}
                              value={reward.offer.kind}
                              onChange={(event) =>
                                updateOffer({
                                  kind: event.target
                                    .value as RewardOffer["kind"],
                                })
                              }
                            >
                              {["cape", "skin", "addon", "other"].map(
                                (kind) => (
                                  <option key={kind} value={kind}>
                                    {t(`Community.kind.${kind}`)}
                                  </option>
                                )
                              )}
                            </Select>
                          </FormControl>
                          <FormControl>
                            <FormLabel fontSize="sm">
                              {t("Community.fields.edition")}
                            </FormLabel>
                            <Select
                              size="sm"
                              id="reward-edition"
                              isDisabled={busy}
                              value={reward.offer.edition}
                              onChange={(event) =>
                                updateOffer({
                                  edition: event.target
                                    .value as RewardOffer["edition"],
                                })
                              }
                            >
                              {[
                                "unknown",
                                "java",
                                "bedrock",
                                "both",
                                "other",
                              ].map((edition) => (
                                <option key={edition} value={edition}>
                                  {t(`Community.edition.${edition}`)}
                                </option>
                              ))}
                            </Select>
                          </FormControl>
                        </SimpleGrid>
                        <FormControl>
                          <FormLabel fontSize="sm">
                            {t("Community.fields.description")}
                          </FormLabel>
                          <Textarea
                            size="sm"
                            id="reward-description"
                            value={reward.offer.description}
                            isDisabled={busy}
                            maxLength={4000}
                            onChange={(event) =>
                              updateOffer({ description: event.target.value })
                            }
                          />
                        </FormControl>
                        {offerInput("sourceUrl", 2048)}
                        <Button
                          size="xs"
                          variant="outline"
                          alignSelf="flex-start"
                          rightIcon={<LuExternalLink />}
                          isDisabled={
                            busy || !officialRewardUrl(reward.offer.sourceUrl)
                          }
                          onClick={handleOpenRules}
                        >
                          {t("HomeRewardsCard.rules")}
                        </Button>
                        {offerInput("claimUrl", 2048)}
                        <Checkbox
                          id="reward-requiresCode"
                          size="sm"
                          isDisabled={busy}
                          isChecked={reward.offer.requiresCode}
                          onChange={(event) =>
                            updateOffer({
                              requiresCode: event.target.checked,
                              redeemUntil: event.target.checked
                                ? reward.offer.redeemUntil
                                : null,
                            })
                          }
                        >
                          {t("MaintenanceCommunity.requiresCode")}
                        </Checkbox>
                        <Checkbox
                          id="reward-noEndDate"
                          size="sm"
                          isDisabled={busy}
                          isChecked={reward.offer.noEndDate}
                          onChange={(event) =>
                            updateOffer({
                              noEndDate: event.target.checked,
                              earnUntil: null,
                              redeemUntil: null,
                            })
                          }
                        >
                          {t("MaintenanceCommunity.noEndDate")}
                        </Checkbox>
                        <SimpleGrid columns={{ base: 1, lg: 3 }} spacing={3}>
                          {(
                            ["startsAt", "earnUntil", "redeemUntil"] as const
                          ).map((key) => (
                            <FormControl key={key}>
                              <FormLabel fontSize="sm">
                                {t(`Community.fields.${key}`)}
                              </FormLabel>
                              <Input
                                id={`reward-${key}`}
                                size="sm"
                                placeholder="YYYY-MM-DD / 2026-10-31T23:59:59-07:00"
                                value={reward.offer[key] ?? ""}
                                isDisabled={
                                  busy ||
                                  (key !== "startsAt" &&
                                    reward.offer.noEndDate) ||
                                  (key === "redeemUntil" &&
                                    !reward.offer.requiresCode)
                                }
                                onChange={(event) =>
                                  updateOffer({
                                    [key]: event.target.value.trim() || null,
                                  })
                                }
                              />
                            </FormControl>
                          ))}
                        </SimpleGrid>
                        <Text fontSize="xs" className="secondary-text">
                          {t("MaintenanceCommunity.dateHint")}
                        </Text>
                        <HStack flexWrap="wrap" gap={2}>
                          <Badge
                            colorScheme={
                              reward.status === "approved" ? "green" : "gray"
                            }
                          >
                            {t(`MaintenanceCommunity.status.${reward.status}`)}
                          </Badge>
                          <Button
                            size="sm"
                            id="approve-reward"
                            colorScheme="green"
                            isDisabled={busy || reward.status === "approved"}
                            onClick={() => void handleReview("approved")}
                          >
                            {t("MaintenanceCommunity.approve")}
                          </Button>
                          <Button
                            size="sm"
                            id="reject-reward"
                            variant="ghost"
                            isDisabled={busy || reward.status === "rejected"}
                            onClick={() => void handleReview("rejected")}
                          >
                            {t("MaintenanceCommunity.reject")}
                          </Button>
                        </HStack>
                      </>
                    )}
                  </VStack>
                </TabPanel>
                <TabPanel px={0}>
                  <VStack align="stretch" spacing={4}>
                    <Text fontSize="sm" className="secondary-text">
                      {t("MaintenanceCommunity.linksHint")}
                    </Text>
                    <Button
                      size="sm"
                      alignSelf="flex-start"
                      leftIcon={<LuPlus />}
                      isDisabled={busy || draft.links.length >= 60}
                      onClick={handleAddLink}
                    >
                      {t("MaintenanceCommunity.addLink")}
                    </Button>
                    {draft.links.length > 0 && (
                      <Select
                        size="sm"
                        id="community-link-select"
                        value={linkId}
                        isDisabled={busy}
                        onChange={(event) => setLinkId(event.target.value)}
                      >
                        {draft.links.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name || t("MaintenanceCommunity.untitled")}
                          </option>
                        ))}
                      </Select>
                    )}
                    {link && (
                      <>
                        <FormControl>
                          <FormLabel fontSize="sm">
                            {t("MaintenanceCommunity.linkSection")}
                          </FormLabel>
                          <Select
                            size="sm"
                            value={link.section ?? "sau"}
                            isDisabled={busy}
                            onChange={(event) =>
                              updateLink({
                                section: event.target
                                  .value as CommunityLink["section"],
                              })
                            }
                          >
                            <option value="sau">
                              {t("FriendsPage.sections.sau")}
                            </option>
                            <option value="universities">
                              {t("FriendsPage.sections.universities")}
                            </option>
                          </Select>
                        </FormControl>
                        <FormControl>
                          <FormLabel fontSize="sm">
                            {t("MaintenanceCommunity.linkKind")}
                          </FormLabel>
                          <Select
                            size="sm"
                            value={link.kind}
                            isDisabled={busy}
                            onChange={(event) =>
                              updateLink({
                                kind: event.target
                                  .value as CommunityLink["kind"],
                              })
                            }
                          >
                            <option value="qq">
                              {t("FriendsPage.kind.qq")}
                            </option>
                            <option value="website">
                              {t("FriendsPage.kind.website")}
                            </option>
                          </Select>
                        </FormControl>
                        {(
                          ["name", "description", "groupNumber", "url"] as const
                        )
                          .filter(
                            (key) => key !== "groupNumber" || link.kind === "qq"
                          )
                          .map((key) => (
                            <FormControl key={key}>
                              <FormLabel fontSize="sm">
                                {t(`MaintenanceCommunity.linkFields.${key}`)}
                              </FormLabel>
                              <Input
                                id={`community-link-${key}`}
                                size="sm"
                                value={link[key]}
                                isDisabled={busy}
                                maxLength={
                                  key === "name"
                                    ? 120
                                    : key === "description"
                                      ? 1000
                                      : key === "groupNumber"
                                        ? 12
                                        : 2048
                                }
                                onChange={(event) =>
                                  updateLink({ [key]: event.target.value })
                                }
                              />
                            </FormControl>
                          ))}
                        <HStack justify="space-between">
                          <Checkbox
                            id="community-link-enabled"
                            size="sm"
                            isChecked={link.enabled}
                            isDisabled={busy}
                            onChange={(event) =>
                              updateLink({ enabled: event.target.checked })
                            }
                          >
                            {t("MaintenanceCommunity.linkEnabled")}
                          </Checkbox>
                          <Button
                            size="xs"
                            variant="ghost"
                            colorScheme="red"
                            leftIcon={<LuTrash2 />}
                            isDisabled={busy}
                            onClick={() => {
                              setDraft({
                                ...draft,
                                links: draft.links.filter(
                                  (item) => item.id !== linkId
                                ),
                              });
                              setLinkId(
                                draft.links.find((item) => item.id !== linkId)
                                  ?.id ?? ""
                              );
                              setDirty(true);
                            }}
                          >
                            {t("MaintenanceCommunity.removeLink")}
                          </Button>
                        </HStack>
                      </>
                    )}
                  </VStack>
                </TabPanel>
              </TabPanels>
            </Tabs>
            <Box>
              <Text fontSize="xs" className="secondary-text" mb={2}>
                {t(
                  dirty
                    ? "MaintenanceSettingsPage.unsaved"
                    : "MaintenanceCommunity.exportHint"
                )}
              </Text>
              <HStack flexWrap="wrap" gap={2}>
                <Button
                  size="sm"
                  id="save-community-draft"
                  colorScheme="blue"
                  isDisabled={busy || !dirty}
                  onClick={handleSave}
                >
                  {t("MaintenanceSettingsPage.save")}
                </Button>
                <Button
                  size="sm"
                  id="preview-community"
                  variant="outline"
                  isDisabled={busy || dirty}
                  onClick={() => void handlePreview()}
                >
                  {t("MaintenanceSettingsPage.applyPreview")}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  isDisabled={busy}
                  onClick={() => void handlePreview(true)}
                >
                  {t("MaintenanceCommunity.clearPreview")}
                </Button>
                <Button
                  size="sm"
                  id="export-community"
                  variant="outline"
                  isDisabled={busy || dirty}
                  onClick={handleExport}
                >
                  {t("MaintenanceCommunity.export")}
                </Button>
              </HStack>
            </Box>
          </>
        )}
      </VStack>
    </Card>
  );
};

export default MaintenanceCommunityPanel;
