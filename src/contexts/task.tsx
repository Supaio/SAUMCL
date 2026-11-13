import { ToastId, useToast as useChakraToast } from "@chakra-ui/react";
import { emit } from "@tauri-apps/api/event";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { useLauncherConfig } from "@/contexts/config";
import { useGlobalData } from "@/contexts/global-data";
import { useSharedModals } from "@/contexts/shared-modal";
import { useToast } from "@/contexts/toast";
import { OtherResourceType } from "@/enums/resource";
import { CurseForgeImportSettings } from "@/models/instance/misc";
import {
  CreatedPTaskEventStatus,
  FailedPTaskEventStatus,
  GTaskEventPayload,
  GTaskEventStatusEnums,
  InProgressPTaskEventStatus,
  PTaskEventPayload,
  PTaskEventStatusEnums,
  StartedPTaskEventStatus,
  TaskDesc,
  TaskDescStatusEnums,
  TaskGroupDesc,
  TaskParam,
} from "@/models/task";
import { ConfigService } from "@/services/config";
import {
  EXTENSION_REFRESH_EVENT,
  ExtensionService,
} from "@/services/extension";
import { InstanceService } from "@/services/instance";
import { RESOURCE_REFRESH_EVENT } from "@/services/resource";
import { TaskService } from "@/services/task";
import { launcherFeatures } from "@/utils/features";

interface TaskContextType {
  tasks: TaskGroupDesc[];
  generalPercent: number | undefined; // General progress percentage for all tasks
  handleCancelProgressiveTaskGroup: (taskGroup: string) => void;
  handleStopProgressiveTaskGroup: (taskGroup: string) => void;
  handleResumeProgressiveTaskGroup: (taskGroup: string) => void;
  handleClearHistoryTaskGroups: () => void;
  handleRetryProgressiveTaskGroup: (group: TaskGroupDesc) => void;
  installCurseForgeWhenDownloaded: (
    taskGroup: string,
    settings: CurseForgeImportSettings
  ) => void;
}

export const TaskContext = createContext<TaskContextType | undefined>(
  undefined
);

export const TaskContextProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const toast = useToast();
  const { close: closeToast } = useChakraToast();
  const { getInstanceList } = useGlobalData();
  const { config, getJavaInfos } = useLauncherConfig();
  const { openSharedModal, openGenericConfirmDialog } = useSharedModals();
  const [tasks, setTasks] = useState<TaskGroupDesc[]>([]);
  const [generalPercent, setGeneralPercent] = useState<number>();
  const { t } = useTranslation();
  const modLoaderLoadingToastRef = React.useRef<ToastId | null>(null);
  const optifineLoadingToastRef = React.useRef<ToastId | null>(null);
  const curseForgeInstalls = React.useRef(
    new Map<string, CurseForgeImportSettings>()
  );
  const retryingGroups = React.useRef(new Set<string>());

  const finishCurseForgeInstall = useCallback(
    async (settings: CurseForgeImportSettings) => {
      const {
        path,
        publishedRelease,
        name,
        description,
        iconSrc,
        gameDirectory,
        sourceDirectory,
      } = settings;
      try {
        await InstanceService.installCurseForgeZip(
          path,
          sourceDirectory,
          gameDirectory,
          name,
          description,
          iconSrc
        );
      } catch (error) {
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
        openSharedModal("import-modpack", {
          path,
          publishedRelease,
          previousSettings: settings,
        });
      }
    },
    [openSharedModal, t, toast]
  );

  const installCurseForgeWhenDownloaded = useCallback(
    (taskGroup: string, settings: CurseForgeImportSettings) => {
      if (curseForgeInstalls.current.has(taskGroup)) return;
      if (
        tasks.some(
          (task) =>
            task.taskGroup === taskGroup &&
            task.status === GTaskEventStatusEnums.Completed
        )
      ) {
        void finishCurseForgeInstall(settings);
      } else {
        curseForgeInstalls.current.set(taskGroup, settings);
      }
    },
    [finishCurseForgeInstall, tasks]
  );

  useEffect(() => {
    if (curseForgeInstalls.current.size === 0) return;
    for (const task of tasks) {
      if (task.status === GTaskEventStatusEnums.Completed) {
        const settings = curseForgeInstalls.current.get(task.taskGroup);
        if (settings) {
          curseForgeInstalls.current.delete(task.taskGroup);
          void finishCurseForgeInstall(settings);
        }
      }
    }
  }, [finishCurseForgeInstall, tasks]);

  const updateGroupInfo = useCallback((group: TaskGroupDesc) => {
    if (group.status === GTaskEventStatusEnums.Completed) {
      group.taskDescs.forEach((t) => {
        t.status = TaskDescStatusEnums.Completed;
        t.current = t.total; // Ensure current is set to total for completed tasks
      });
    }

    group.finishedCount = group.taskDescs.filter(
      (t) => t.status === TaskDescStatusEnums.Completed
    ).length;

    let knownTotalArr = group.taskDescs.filter((t) => t.total && t.total > 0);
    let knownTotal = knownTotalArr.reduce((acc, t) => acc + t.total, 0);
    let knownCurrent = knownTotalArr.reduce(
      (acc, t) => acc + (t.current || 0),
      0
    );
    let estimatedTotal;
    if (knownTotalArr.length > 0) {
      estimatedTotal =
        knownTotal +
        (group.taskDescs.length - knownTotalArr.length) *
          (knownTotal / knownTotalArr.length); // Estimate unknown task's size based on known tasks' average size
    } else {
      estimatedTotal = knownTotal; // Fallback when no known tasks exist
    }

    group.progress = estimatedTotal ? (knownCurrent * 100) / estimatedTotal : 0;

    group.estimatedTime = undefined;
    group.taskDescs.forEach((t) => {
      if (t.status === TaskDescStatusEnums.InProgress && t.estimatedTime) {
        if (
          !group.estimatedTime ||
          group.estimatedTime.secs < t.estimatedTime.secs
        ) {
          group.estimatedTime = t.estimatedTime;
        }
      }
      t.progress = t.total ? (t.current * 100) / t.total : 0;
    });
    group.taskDescs.sort((a, b) => {
      let level = (desc: TaskDesc) => {
        switch (desc.status) {
          case TaskDescStatusEnums.Failed:
            return 0;
          case TaskDescStatusEnums.InProgress:
            return 1;
          case TaskDescStatusEnums.Waiting:
            return 2;
          case TaskDescStatusEnums.Completed:
            return 4;
          default:
            return 3;
        }
      };
      return level(a) - level(b);
    });
  }, []);

  const handleRetrieveProgressTasks = useCallback(() => {
    TaskService.retrieveProgressiveTaskList().then((response) => {
      if (response.status === "success") {
        logger.info("Retrieved progressive tasks:", response.data);
        // info(JSON.stringify(response.data));
        setTasks((prevTasks) => {
          let tasks = response.data
            .map((group) => {
              let prevGroup = prevTasks?.find(
                (t) => t.taskGroup === group.taskGroup
              );
              if (prevGroup) return prevGroup;
              updateGroupInfo(group);
              return group;
            })
            .filter(
              (group) => group.status !== GTaskEventStatusEnums.Cancelled
            );
          tasks.sort((a, b) => {
            let { timestamp: aTime } = parseTaskGroup(a.taskGroup);
            let { timestamp: bTime } = parseTaskGroup(b.taskGroup);
            return bTime - aTime; // Sort by timestamp descending
          });
          return tasks;
        });
      } else {
        toast({
          title: response.message,
          description: response.details,
          status: "error",
        });
      }
    });
  }, [toast, updateGroupInfo]);

  useEffect(() => {
    handleRetrieveProgressTasks();
  }, [handleRetrieveProgressTasks]);

  const handleScheduleProgressiveTaskGroup = useCallback(
    (taskGroup: string, params: TaskParam[]) => {
      return TaskService.scheduleProgressiveTaskGroup(taskGroup, params).then(
        (response) => {
          // success toast will now be called by task context group listener
          if (response.status !== "success") {
            toast({
              title: response.message,
              description: response.details,
              status: "error",
            });
          }
          return response;
        }
      );
    },
    [toast]
  );

  const handleRetryProgressiveTaskGroup = useCallback(
    async (group: TaskGroupDesc) => {
      if (retryingGroups.current.has(group.taskGroup)) return;
      const retryGroup =
        "retry-" +
        parseTaskGroup(group.taskGroup).rawName.replace(/^retry-/, "");
      const pendingInstall = curseForgeInstalls.current.get(group.taskGroup);
      const params = group.taskDescs
        .filter((task) => task.status !== TaskDescStatusEnums.Completed)
        .map((task) => task.payload);
      if (params.length === 0) return;
      retryingGroups.current.add(group.taskGroup);
      try {
        const response = await handleScheduleProgressiveTaskGroup(
          retryGroup,
          params
        );
        if (response.status === "success" && pendingInstall) {
          curseForgeInstalls.current.delete(group.taskGroup);
          installCurseForgeWhenDownloaded(
            response.data.taskGroup,
            pendingInstall
          );
        }
      } finally {
        retryingGroups.current.delete(group.taskGroup);
      }
    },
    [handleScheduleProgressiveTaskGroup, installCurseForgeWhenDownloaded]
  );

  const handleCancelProgressiveTaskGroup = useCallback(
    (taskGroup: string) => {
      TaskService.cancelProgressiveTaskGroup(taskGroup).then((response) => {
        if (response.status !== "success") {
          toast({
            title: response.message,
            description: response.details,
            status: "error",
          });
        }
      });
    },
    [toast]
  );

  const handleStopProgressiveTaskGroup = useCallback(
    (taskGroup: string) => {
      TaskService.stopProgressiveTaskGroup(taskGroup).then((response) => {
        if (response.status !== "success") {
          toast({
            title: response.message,
            description: response.details,
            status: "error",
          });
        }
      });
    },
    [toast]
  );

  const handleResumeProgressiveTaskGroup = useCallback(
    (taskGroup: string) => {
      TaskService.resumeProgressiveTaskGroup(taskGroup).then((response) => {
        if (response.status !== "success") {
          toast({
            title: response.message,
            description: response.details,
            status: "error",
          });
        }
      });
    },
    [toast]
  );

  const isActiveGroup = (t: TaskGroupDesc) =>
    t.status === GTaskEventStatusEnums.Started ||
    t.status === GTaskEventStatusEnums.Stopped;

  const handleClearHistoryTaskGroups = useCallback(() => {
    setTasks((prev) => {
      prev
        .filter((t) => !isActiveGroup(t))
        .forEach((group) => {
          curseForgeInstalls.current.delete(group.taskGroup);
          TaskService.deleteProgressiveTaskGroup(group.taskGroup);
        });
      return prev.filter(isActiveGroup);
    });
  }, []);

  useEffect(() => {
    const unlisten = TaskService.onProgressiveTaskUpdate(
      (payload: PTaskEventPayload) => {
        // info(
        //   `Received task update: ${payload.id}, status: ${payload.event.status}`
        // );
        setTasks((prevTasks) => {
          const group = prevTasks?.find(
            (t) => t.taskGroup === payload.taskGroup
          );

          switch (payload.event.status) {
            case PTaskEventStatusEnums.Created: {
              if (group) {
                if (group.taskDescs.some((t) => t.taskId === payload.id)) {
                  // info(
                  //   `Task ${payload.id} already exists in group ${payload.taskGroup}`
                  // );
                } else if (
                  group.taskDescs.some(
                    (t) =>
                      t.payload.dest ===
                      (payload.event as CreatedPTaskEventStatus).desc.payload
                        .dest
                  )
                ) {
                  // It' a retrial task emitted from the backend
                  group.taskDescs = group.taskDescs.map((t) => {
                    if (
                      t.payload.dest ===
                      (payload.event as CreatedPTaskEventStatus).desc.payload
                        .dest
                    ) {
                      t = (payload.event as CreatedPTaskEventStatus).desc;
                    }
                    return t;
                  });
                } else {
                  group.taskDescs.unshift(payload.event.desc);
                  // info(`Added task ${payload.id} to group ${payload.taskGroup}`);
                  updateGroupInfo(group);
                }
              } else {
                // info(`Creating new task group ${payload.taskGroup}`);
                // Create a new task group if it doesn't exist
                let newGroup: TaskGroupDesc = {
                  status: GTaskEventStatusEnums.Started,
                  taskGroup: payload.taskGroup,
                  taskDescs: [payload.event.desc],
                };
                updateGroupInfo(newGroup);
                return [newGroup, ...(prevTasks || [])];
              }
              break;
            }

            case PTaskEventStatusEnums.Started: {
              if (!group) return prevTasks;
              group.taskDescs = group.taskDescs.map((t) => {
                if (t.taskId === payload.id) {
                  t.status = TaskDescStatusEnums.InProgress;
                  t.total = (payload.event as StartedPTaskEventStatus).total;
                }
                return t;
              });
              updateGroupInfo(group);
              break;
            }

            case PTaskEventStatusEnums.Completed: {
              if (!group) return prevTasks;
              group.taskDescs = group.taskDescs.map((t) => {
                if (t.taskId === payload.id) {
                  t.status = TaskDescStatusEnums.Completed;
                  t.current = t.total;
                }
                return t;
              });
              // info(`Task ${payload.id} completed in group ${payload.taskGroup}`);
              updateGroupInfo(group);
              break;
            }

            case PTaskEventStatusEnums.Stopped: {
              if (!group) return prevTasks;
              group.taskDescs = group.taskDescs.map((t) => {
                if (t.taskId === payload.id) {
                  t.status = TaskDescStatusEnums.Stopped;
                }
                return t;
              });
              updateGroupInfo(group);
              break;
            }

            case PTaskEventStatusEnums.Cancelled: {
              if (!group) return prevTasks;
              group.taskDescs = group.taskDescs.map((t) => {
                if (t.taskId === payload.id) {
                  t.status = TaskDescStatusEnums.Cancelled;
                }
                return t;
              });
              updateGroupInfo(group);
              // info(`Task ${payload.id} cancelled in group ${payload.taskGroup}`);
              break;
            }

            case PTaskEventStatusEnums.InProgress: {
              if (!group) return prevTasks;
              group.taskDescs = group.taskDescs.map((t) => {
                if (t.taskId === payload.id) {
                  t.current = (
                    payload.event as InProgressPTaskEventStatus
                  ).current;
                  t.status = TaskDescStatusEnums.InProgress;
                  t.estimatedTime = (
                    payload.event as InProgressPTaskEventStatus
                  ).estimatedTime;
                  t.speed = (payload.event as InProgressPTaskEventStatus).speed;
                }
                return t;
              });
              updateGroupInfo(group);
              // info(
              //   `Task ${payload.id} in progress in group ${payload.taskGroup}`
              // );
              break;
            }

            case PTaskEventStatusEnums.Failed: {
              logger.error(
                `Task ${payload.id} failed in group ${payload.taskGroup}: ${
                  (payload.event as FailedPTaskEventStatus).reason
                }`
              );
              if (!group) return prevTasks;
              group.taskDescs = group.taskDescs.map((t) => {
                if (t.taskId === payload.id) {
                  t.status = TaskDescStatusEnums.Failed;
                  t.reason = (payload.event as FailedPTaskEventStatus).reason;
                }
                return t;
              });
              updateGroupInfo(group);
              // info(`Task ${payload.id} failed in group ${payload.taskGroup}`);
              break;
            }

            default:
              break;
          }

          return [...prevTasks];
        });
      }
    );

    return () => {
      unlisten();
    };
  }, [t, toast, updateGroupInfo]);

  useEffect(() => {
    const unlisten = TaskService.onTaskGroupUpdate(
      (payload: GTaskEventPayload) => {
        logger.info(`Received task group update: ${payload.event}`);
        const { name, params } = parseTaskGroup(payload.taskGroup);
        setTasks((prevTasks) => {
          let newTasks = prevTasks.map((task) => {
            if (task.taskGroup === payload.taskGroup) {
              task.status = payload.event;
              if (payload.event === GTaskEventStatusEnums.Completed) {
                task.taskDescs.forEach((t) => {
                  if (
                    t.status === TaskDescStatusEnums.Waiting ||
                    t.status === TaskDescStatusEnums.InProgress
                  ) {
                    t.status = TaskDescStatusEnums.Completed;
                    t.current = t.total;
                  } else if (
                    t.status === TaskDescStatusEnums.Failed ||
                    (t.status === TaskDescStatusEnums.Cancelled &&
                      name === "curseforge-files")
                  ) {
                    task.status = GTaskEventStatusEnums.Failed;
                    payload.event = GTaskEventStatusEnums.Failed;
                  }
                });
              }
            }
            return task;
          });

          toast({
            status:
              payload.event === GTaskEventStatusEnums.Failed
                ? "error"
                : "success",
            title: t(
              `Services.task.onTaskGroupUpdate.status.${payload.event}`,
              {
                param: t(`DownloadTasksPage.task.${name}`, params),
              }
            ),
          });

          if (payload.event === GTaskEventStatusEnums.Completed) {
            switch (name) {
              case "game-client":
              case "change-mod-loader":
                getInstanceList(true);
                break;
              case "change-optifine":
                getInstanceList(true);
                break;
              case "game-client-w-java":
                getInstanceList(true);
                getJavaInfos(true);
                break;
              case "forge-libraries":
              case "cleanroom-libraries":
              case "neoforge-libraries":
                if (params.param || params.param1) {
                  const instanceId = params.param || params.param1;
                  let instanceName = getInstanceList()?.find(
                    (i) => i.id === instanceId
                  )?.name;
                  if (modLoaderLoadingToastRef.current) return newTasks;
                  modLoaderLoadingToastRef.current = toast({
                    title: t(
                      "Services.instance.finishModLoaderInstall.loading",
                      {
                        instanceName,
                      }
                    ),
                    status: "loading",
                  });
                  InstanceService.finishModLoaderInstall(instanceId).then(
                    (response) => {
                      if (modLoaderLoadingToastRef.current) {
                        closeToast(modLoaderLoadingToastRef.current);
                        modLoaderLoadingToastRef.current = null;
                      }
                      if (response.status === "success") {
                        getInstanceList(true);
                        toast({
                          title: response.message,
                          status: "success",
                        });
                      } else {
                        toast({
                          title: response.message,
                          description: response.details,
                          status: "error",
                        });
                      }
                    }
                  );
                }
                break;
              case "optifine-libraries":
                if (params.param || params.param1) {
                  const instanceId = params.param || params.param1;
                  let instanceName = getInstanceList()?.find(
                    (i) => i.id === instanceId
                  )?.name;
                  if (optifineLoadingToastRef.current) return newTasks;
                  optifineLoadingToastRef.current = toast({
                    title: t(
                      "Services.instance.finishOptiFineLoaderInstall.loading",
                      {
                        instanceName,
                      }
                    ),
                    status: "loading",
                  });
                  InstanceService.finishOptiFineLoaderInstall(instanceId).then(
                    (response) => {
                      if (optifineLoadingToastRef.current) {
                        closeToast(optifineLoadingToastRef.current);
                        optifineLoadingToastRef.current = null;
                      }
                      if (response.status === "success") {
                        getInstanceList(true);
                        toast({
                          title: response.message,
                          status: "success",
                        });
                      } else {
                        toast({
                          title: response.message,
                          description: response.details,
                          status: "error",
                        });
                      }
                    }
                  );
                }
                break;
              case "mod":
              case "mod-update":
                emit(RESOURCE_REFRESH_EVENT, OtherResourceType.Mod);
                break;
              case "resourcepack":
                emit(RESOURCE_REFRESH_EVENT, OtherResourceType.ResourcePack);
                break;
              case "shader":
                emit(RESOURCE_REFRESH_EVENT, OtherResourceType.ShaderPack);
                break;
              case "modpack": {
                let group = newTasks.find(
                  (t) => t.taskGroup === payload.taskGroup
                );
                if (group && group.taskDescs.length > 0) {
                  const projectId = Number(params.param1);
                  const fileId = Number(params.param2);
                  openSharedModal("import-modpack", {
                    path: group.taskDescs[0].payload.dest,
                    publishedRelease:
                      Number.isSafeInteger(projectId) &&
                      projectId > 0 &&
                      Number.isSafeInteger(fileId) &&
                      fileId > 0
                        ? [projectId, fileId]
                        : undefined,
                  });
                }
                break;
              }
              case "launcher-update": {
                let group = newTasks.find(
                  (t) => t.taskGroup === payload.taskGroup
                );
                if (group && group.taskDescs.length > 0) {
                  const isWinInstaller =
                    config.basicInfo.osType === "windows" &&
                    !config.basicInfo.isPortable;
                  openGenericConfirmDialog({
                    title: t("RestartForUpdateConfirmDialog.title"),
                    body: t(
                      `RestartForUpdateConfirmDialog.${isWinInstaller ? "bodyWinInstaller" : "body"}`
                    ),
                    btnOK: t(
                      `RestartForUpdateConfirmDialog.button.${isWinInstaller ? "install" : "restart"}`
                    ),
                    btnCancel: t("RestartForUpdateConfirmDialog.button.later"),
                    onOKCallback: () => {
                      ConfigService.installLauncherUpdate(
                        group.taskDescs[0].payload.filename || "",
                        true
                      ).then((response) => {
                        if (response.status !== "success") {
                          toast({
                            title: response.message,
                            description: response.details,
                            status: "error",
                          });
                        }
                      });
                    },
                    onCancelCallback: () => {
                      ConfigService.installLauncherUpdate(
                        group.taskDescs[0].payload.filename || "",
                        false
                      ).then((response) => {
                        if (response.status !== "success") {
                          toast({
                            title: response.message,
                            description: response.details,
                            status: "error",
                          });
                        }
                      });
                    },
                  });
                }
                break;
              }
              case "extension-update": {
                if (!launcherFeatures.extensions) break;
                let group = newTasks.find(
                  (t) => t.taskGroup === payload.taskGroup
                );
                const task = group?.taskDescs[0];
                const expectedIdentifier = params.param1;
                const newVersion = params.param2 || "";

                if (task && expectedIdentifier) {
                  openGenericConfirmDialog({
                    title: t("ExtensionUpdateConfirmDialog.title"),
                    body: t("ExtensionUpdateConfirmDialog.body", {
                      identifier: expectedIdentifier,
                      version: newVersion,
                      src: task.payload.src,
                    }),
                    onOKCallback: () => {
                      ExtensionService.addExtension(
                        task.payload.dest,
                        expectedIdentifier
                      ).then((response) => {
                        if (response.status === "success") {
                          toast({
                            title: response.message,
                            status: "success",
                          });
                          emit(EXTENSION_REFRESH_EVENT);
                        } else {
                          toast({
                            title: response.message,
                            description: response.details,
                            status: "error",
                          });
                        }
                      });
                    },
                  });
                }
                break;
              }
              case "mojang-java":
                getJavaInfos(true);
                break;
              default:
                break;
            }
          }

          return newTasks;
        });
      }
    );
    return () => {
      unlisten();
    };
  }, [
    t,
    toast,
    closeToast,
    getInstanceList,
    updateGroupInfo,
    getJavaInfos,
    openSharedModal,
    openGenericConfirmDialog,
    config.basicInfo.osType,
    config.basicInfo.isPortable,
  ]);

  useEffect(() => {
    if (!tasks || !tasks.length) setGeneralPercent(undefined);
    else {
      let filteredTasks = tasks.filter(
        (t) => t.status === GTaskEventStatusEnums.Started
      );

      if (filteredTasks.length === 0) setGeneralPercent(undefined);
      else {
        setGeneralPercent(
          filteredTasks.reduce(
            (acc, group) => acc + (group.progress ?? 0) / filteredTasks.length,
            0
          )
        );
      }
    }
  }, [tasks]);

  return (
    <TaskContext.Provider
      value={{
        tasks,
        generalPercent,
        handleCancelProgressiveTaskGroup,
        handleStopProgressiveTaskGroup,
        handleResumeProgressiveTaskGroup,
        handleClearHistoryTaskGroups,
        handleRetryProgressiveTaskGroup,
        installCurseForgeWhenDownloaded,
      }}
    >
      {children}
    </TaskContext.Provider>
  );
};

export const useTaskContext = (): TaskContextType => {
  const context = useContext(TaskContext);
  if (!context) {
    throw new Error("useTaskContext must be used within a TaskContextProvider");
  }
  return context;
};

export const parseTaskGroup = (
  taskGroup: string
): {
  name: string;
  params: Record<string, string>;
  timestamp: number;
  isRetry: boolean;
  rawName: string;
} => {
  const lastAtIndex = taskGroup.lastIndexOf("@");
  let rawName: string;
  let timestamp: number;

  if (lastAtIndex === -1) {
    rawName = taskGroup;
    timestamp = Date.now();
  } else {
    rawName = taskGroup.substring(0, lastAtIndex);
    timestamp = parseInt(taskGroup.substring(lastAtIndex + 1));
  }

  const [name, paramString] = rawName.split("?");
  const params = paramString ? paramString.split("&") : [];

  return {
    name: name.replace(/^retry-/, ""),
    params:
      params.length === 1
        ? { param: params[0] }
        : Object.fromEntries(
            params.map((param, index) => [`param${index + 1}`, param])
          ),
    isRetry: name.startsWith("retry-"),
    timestamp: timestamp,
    rawName,
  };
};
