import {
  Alert,
  AlertIcon,
  Button,
  Center,
  HStack,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  ModalProps,
  Text,
  VStack,
} from "@chakra-ui/react";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { t } from "i18next";
import { useRouter } from "next/router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BeatLoader } from "react-spinners";
import {
  OptionItemGroup,
  OptionItemGroupProps,
} from "@/components/common/option-item";
import { InstanceBasicSettings } from "@/components/instance-basic-settings";
import {
  gameTypesToIcon,
  loaderTypesToIcon,
} from "@/components/modals/create-instance-modal";
import { useLauncherConfig } from "@/contexts/config";
import { useTaskContext } from "@/contexts/task";
import { useToast } from "@/contexts/toast";
import {
  CurseForgeImportSettings,
  CurseForgeImportStatus,
  ModpackMetaInfo,
} from "@/models/instance/misc";
import {
  ModLoaderResourceInfo,
  defaultModLoaderResourceInfo,
} from "@/models/resource";
import { InstanceService } from "@/services/instance";
import { ResourceService } from "@/services/resource";
import { isDirNameInvalid, sanitizeFileName } from "@/utils/string";

interface ImportModpackModalProps extends Omit<ModalProps, "children"> {
  path: string;
  publishedRelease?: [number, number];
  previousSettings?: CurseForgeImportSettings;
}

const ImportModpackModal: React.FC<ImportModpackModalProps> = ({
  path,
  publishedRelease,
  previousSettings,
  ...modalProps
}) => {
  const { config } = useLauncherConfig();
  const router = useRouter();
  const toast = useToast();
  const { installCurseForgeWhenDownloaded } = useTaskContext();
  const primaryColor = config.appearance.theme.primaryColor;
  const { onClose } = modalProps;

  const [modpack, setModpack] = useState<ModpackMetaInfo>();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [iconSrc, setIconSrc] = useState("");
  const [gameDirectory, setGameDirectory] = useState(
    previousSettings?.gameDirectory ?? config.localGameDirectories[0]
  );
  const [isPageLoading, setIsPageLoading] = useState(true);
  const [isBtnLoading, setIsBtnLoading] = useState(false);
  const [sourceDirectory, setSourceDirectory] = useState<string>();
  const [fileStatus, setFileStatus] = useState<CurseForgeImportStatus>();
  const [waitingForFiles, setWaitingForFiles] = useState(false);
  const [checkFailed, setCheckFailed] = useState(false);
  const [checkRevision, setCheckRevision] = useState(0);
  const [preparingDownload, setPreparingDownload] = useState(false);
  const [directDownloadFailed, setDirectDownloadFailed] = useState(false);
  const [showImportOptions, setShowImportOptions] = useState(false);
  const installing = useRef(false);
  const isCurseForge = modpack?.modpackSource === "CurseForge";
  const filesReady =
    !!fileStatus && fileStatus.availableFiles === fileStatus.requiredFiles;
  const canInstall = Boolean(gameDirectory && isDirNameInvalid(name) === 0);

  const showCurseForgeError = useCallback(
    (error: unknown) => {
      toast({
        status: "error",
        title: t("ImportModpackModal.curseforge.errorTitle"),
        description: t(
          `ImportModpackModal.curseforge.errors.${String(error)}`,
          {
            defaultValue: t("ImportModpackModal.curseforge.errors.other"),
          }
        ),
      });
    },
    [toast]
  );

  useEffect(() => {
    if (!modalProps.isOpen || !isCurseForge || isBtnLoading || filesReady)
      return;
    let current = true;
    let timer: ReturnType<typeof setTimeout>;
    const check = async () => {
      try {
        const result = await InstanceService.checkCurseForgeImport(
          path,
          sourceDirectory
        );
        if (!current) return;
        setCheckFailed(false);
        setFileStatus(result);
        if (waitingForFiles && result.availableFiles < result.requiredFiles) {
          timer = setTimeout(check, 2500);
        }
      } catch {
        if (!current) return;
        setFileStatus(undefined);
        setCheckFailed(true);
        setWaitingForFiles(false);
      }
    };
    void check();
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [
    modalProps.isOpen,
    isCurseForge,
    isBtnLoading,
    filesReady,
    path,
    sourceDirectory,
    waitingForFiles,
    checkRevision,
  ]);

  const handleDownloadInLauncher = async () => {
    if (preparingDownload || !gameDirectory || !canInstall) return;
    setPreparingDownload(true);
    setDirectDownloadFailed(false);
    setWaitingForFiles(false);
    try {
      const result = await InstanceService.downloadCurseForgeFiles(
        path,
        sourceDirectory,
        publishedRelease
      );
      if (result.taskGroup) {
        installCurseForgeWhenDownloaded(result.taskGroup, {
          path,
          publishedRelease,
          name,
          description,
          iconSrc,
          gameDirectory,
          sourceDirectory,
        });
        onClose();
        if (router.pathname !== "/downloads") void router.push("/downloads");
      } else {
        setDirectDownloadFailed(result.remaining > 0);
        setWaitingForFiles(result.remaining === 0);
        setCheckRevision((revision) => revision + 1);
      }
    } catch (error) {
      setDirectDownloadFailed(true);
      showCurseForgeError(error);
    } finally {
      setPreparingDownload(false);
    }
  };

  const downloadCurseForgeFiles = async (usePrism: boolean) => {
    try {
      if (usePrism) {
        await InstanceService.openCurseForgeZipInPrism(path);
      } else {
        const fileName = path.split(/[\\/]/).pop() || "";
        // Exported CurseForge ZIPs don't normally carry their own published file ID.
        const publishedFile = [
          {
            fileName: "All-the-Mods-11-0.14.0-beta.zip",
            name: "All the Mods 11",
            version: "0.14.0-beta",
            installUrl:
              "https://www.curseforge.com/minecraft/modpacks/all-the-mods-11/install/9426887",
          },
          {
            fileName: "Creative-Drawers-Producer-2-Beta-v2.3.3.zip",
            name: "Creative Drawers Producer 2",
            version: "Beta v2.3.3",
            installUrl:
              "https://www.curseforge.com/minecraft/modpacks/creative-drawers-producer-2/install/9368438",
          },
        ].find(
          (release) =>
            release.fileName.toLowerCase() === fileName.toLowerCase() &&
            release.name === modpack?.name &&
            release.version === modpack.version
        );
        const search = new URLSearchParams({
          class: "modpacks",
          page: "1",
          pageSize: "20",
          sortBy: "relevancy",
          search: modpack?.name ?? "",
        });
        await openUrl(
          publishedFile?.installUrl ??
            `https://www.curseforge.com/minecraft/search?${search}`
        );
      }
      setWaitingForFiles(true);
    } catch (error) {
      showCurseForgeError(error);
    }
  };

  const modpackInfoGroup: OptionItemGroupProps[] = useMemo(() => {
    if (!modpack) return [];
    return [
      {
        title: t("ImportModpackModal.label.modpackInfo"),
        items: [
          {
            title: t("ImportModpackModal.label.modpackName"),
            children: modpack.name,
          },
          {
            title: t("ImportModpackModal.label.modpackVersion"),
            children: modpack.version || "-",
          },
          {
            title: t("ImportModpackModal.label.author"),
            children: modpack.author || "-",
          },
          {
            title: t("ImportModpackModal.label.modLoader"),
            children: modpack.modLoader
              ? `${modpack.modLoader.loaderType} ${modpack.modLoader.version} ${
                  modpack.modLoader.branch
                    ? `(${modpack.modLoader.branch})`
                    : ""
                }`
              : "-",
          },
          {
            title: t("ImportModpackModal.label.gameVersion"),
            children: modpack.clientVersion,
          },
        ],
      },
    ];
  }, [modpack]);

  const handleImportModpack = useCallback(async () => {
    if (
      !modpack ||
      isDirNameInvalid(name) !== 0 ||
      !gameDirectory ||
      installing.current
    )
      return;
    installing.current = true;
    try {
      setIsBtnLoading(true);
      if (isCurseForge) {
        await InstanceService.installCurseForgeZip(
          path,
          sourceDirectory,
          gameDirectory,
          name,
          description,
          iconSrc
        );
        onClose();
        router.push("/downloads");
        return;
      }
      // first get client resource info
      const versionResp = await ResourceService.fetchGameVersionSpecific(
        modpack.clientVersion
      );
      if (versionResp.status !== "success") {
        toast({
          title: versionResp.message,
          description: versionResp.details,
          status: "error",
        });
        return;
      }
      const clientResourceInfo = versionResp.data;

      // then install modpack through `create_instance`
      const createResp = await InstanceService.createInstance(
        gameDirectory,
        name,
        description,
        iconSrc,
        clientResourceInfo,
        modpack.modLoader
          ? ({
              loaderType: modpack.modLoader.loaderType,
              version: modpack.modLoader.version,
              branch: modpack.modLoader.branch,
              description: "",
            } as ModLoaderResourceInfo)
          : defaultModLoaderResourceInfo,
        undefined,
        path,
        undefined,
        undefined,
        modpack.version
      );
      if (createResp.status === "success") {
        onClose();
        router.push("/downloads");
      } else {
        toast({
          title: createResp.message,
          description: createResp.details,
          status: "error",
        });
      }
    } catch (error) {
      if (isCurseForge) {
        setWaitingForFiles(false);
        setFileStatus(undefined);
        setCheckRevision((revision) => revision + 1);
        showCurseForgeError(error);
      } else {
        logger.error("Error creating instance:", error);
      }
    } finally {
      installing.current = false;
      setIsBtnLoading(false);
    }
  }, [
    description,
    gameDirectory,
    iconSrc,
    isCurseForge,
    onClose,
    modpack,
    name,
    path,
    router,
    showCurseForgeError,
    sourceDirectory,
    toast,
  ]);

  useEffect(() => {
    if (modalProps.isOpen && waitingForFiles && filesReady && canInstall) {
      void handleImportModpack();
    }
  }, [
    modalProps.isOpen,
    waitingForFiles,
    filesReady,
    canInstall,
    handleImportModpack,
  ]);

  useEffect(() => {
    let current = true;
    setIsPageLoading(true);
    setModpack(undefined);
    setFileStatus(undefined);
    setSourceDirectory(previousSettings?.sourceDirectory);
    setWaitingForFiles(false);
    setCheckFailed(false);
    setDirectDownloadFailed(false);
    setShowImportOptions(false);
    InstanceService.retrieveModpackMetaInfo(path)
      .then((response) => {
        if (!current) return;
        if (response.status === "success") {
          setModpack(response.data);
          setName(
            previousSettings?.name ??
              sanitizeFileName(
                response.data.modpackSource === "CurseForge" &&
                  response.data.version
                  ? `${response.data.name} ${response.data.version}`
                  : response.data.name
              )
          );
          setDescription(
            previousSettings?.description ?? response.data.description ?? ""
          );
          setIconSrc(
            previousSettings?.iconSrc ??
              (response.data.modLoader
                ? loaderTypesToIcon[response.data.modLoader.loaderType]
                : gameTypesToIcon["release"])
          );
        } else {
          toast({
            title: response.message,
            description: response.details,
            status: "error",
          });
          onClose();
        }
      })
      .catch((error) => {
        logger.error("Error fetching modpack info:", error);
      })
      .finally(() => {
        if (current) setIsPageLoading(false);
      });
    return () => {
      current = false;
    };
  }, [path, previousSettings, toast, onClose]);

  return (
    <Modal
      scrollBehavior="inside"
      size={{ base: "2xl", lg: "3xl", xl: "4xl" }}
      autoFocus={false}
      returnFocusOnClose={false}
      {...modalProps}
      closeOnEsc={!isBtnLoading && !preparingDownload}
      closeOnOverlayClick={!isBtnLoading && !preparingDownload}
    >
      <ModalOverlay />
      <ModalContent h="100%">
        <ModalHeader>{t("ImportModpackModal.header.title")}</ModalHeader>
        <ModalCloseButton isDisabled={isBtnLoading || preparingDownload} />
        <ModalBody h="100%">
          {isPageLoading ? (
            <Center h="100%">
              <BeatLoader size={16} color="gray" />
            </Center>
          ) : (
            <VStack w="100%" spacing={4}>
              {isCurseForge && (
                <VStack align="stretch" w="100%" spacing={2}>
                  <Alert
                    status={
                      filesReady
                        ? "success"
                        : checkFailed || directDownloadFailed
                          ? "warning"
                          : "info"
                    }
                    borderRadius="md"
                  >
                    <AlertIcon />
                    <VStack align="start" spacing={1}>
                      <Text fontWeight="medium">
                        {fileStatus
                          ? t("ImportModpackModal.curseforge.progress", {
                              found: fileStatus.availableFiles,
                              total: fileStatus.requiredFiles,
                            })
                          : t(
                              checkFailed
                                ? "ImportModpackModal.curseforge.checkFailed"
                                : "ImportModpackModal.curseforge.scanning"
                            )}
                      </Text>
                      {!filesReady && (
                        <Text fontSize="sm">
                          {t(
                            directDownloadFailed
                              ? "ImportModpackModal.curseforge.downloadIncomplete"
                              : waitingForFiles
                                ? "ImportModpackModal.curseforge.waiting"
                                : "ImportModpackModal.curseforge.downloadHelp"
                          )}
                        </Text>
                      )}
                    </VStack>
                  </Alert>
                  {!filesReady && !preparingDownload && (
                    <Button
                      size="sm"
                      variant="ghost"
                      alignSelf="start"
                      onClick={() =>
                        setShowImportOptions((visible) => !visible)
                      }
                    >
                      {t("ImportModpackModal.curseforge.otherOptions")}
                    </Button>
                  )}
                  {!filesReady && showImportOptions && !preparingDownload && (
                    <HStack flexWrap="wrap" spacing={2}>
                      {fileStatus?.prismAvailable && (
                        <Button
                          size="sm"
                          colorScheme={primaryColor}
                          onClick={() => downloadCurseForgeFiles(true)}
                        >
                          {t("ImportModpackModal.curseforge.openPrism")}
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => downloadCurseForgeFiles(false)}
                      >
                        {t("ImportModpackModal.curseforge.openCurseForge")}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={async () => {
                          try {
                            const selected = await open({
                              directory: true,
                              multiple: false,
                            });
                            if (typeof selected === "string") {
                              setFileStatus(undefined);
                              setSourceDirectory(selected);
                              setWaitingForFiles(true);
                              setCheckRevision((revision) => revision + 1);
                            }
                          } catch (error) {
                            showCurseForgeError(error);
                          }
                        }}
                      >
                        {t("ImportModpackModal.curseforge.chooseSource")}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          setCheckRevision((revision) => revision + 1)
                        }
                      >
                        {t("General.refresh")}
                      </Button>
                    </HStack>
                  )}
                </VStack>
              )}
              <InstanceBasicSettings
                name={name}
                setName={setName}
                description={description}
                setDescription={setDescription}
                iconSrc={iconSrc}
                setIconSrc={setIconSrc}
                gameDirectory={gameDirectory}
                setGameDirectory={setGameDirectory}
              />
              {modpackInfoGroup.map((group, index) => (
                <OptionItemGroup
                  title={group.title}
                  items={group.items}
                  key={index}
                  w="100%"
                />
              ))}
            </VStack>
          )}
        </ModalBody>
        <ModalFooter>
          <Button
            colorScheme={primaryColor}
            onClick={() =>
              isCurseForge && !filesReady
                ? handleDownloadInLauncher()
                : handleImportModpack()
            }
            isLoading={isBtnLoading || isPageLoading || preparingDownload}
            isDisabled={
              isCurseForge && (!canInstall || (!fileStatus && !checkFailed))
            }
          >
            {t(
              isCurseForge
                ? filesReady
                  ? "ImportModpackModal.curseforge.install"
                  : "ImportModpackModal.curseforge.downloadAndInstall"
                : "General.import"
            )}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};

export default ImportModpackModal;
