import React, { createContext, useCallback, useContext, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLauncherConfig } from "@/contexts/config";
import { useCowDrop } from "@/contexts/cow-drop";
import { useToast } from "@/contexts/toast";

interface SharedModalContextType {
  openSharedModal: (key: string, params?: any) => void;
  closeSharedModal: (key: string) => void;
  openGenericConfirmDialog: (params?: any) => void;
  modalStates: Record<string, { isOpen: boolean; params: any }>;
}

export const SharedModalContext = createContext<
  SharedModalContextType | undefined
>(undefined);

export const SharedModalContextProvider: React.FC<{
  children: React.ReactNode;
}> = ({ children }) => {
  const [modalStates, setModalStates] = useState<
    Record<string, { isOpen: boolean; params: any }>
  >({});
  const { config } = useLauncherConfig();
  const { canLaunchGame, clearCows } = useCowDrop();
  const toast = useToast();
  const { t } = useTranslation();

  const openSharedModal = useCallback(
    (key: string, params: any = {}) => {
      if (key === "launch") {
        if (!canLaunchGame()) {
          toast({
            id: "cow-launch-blocked",
            title: t("CowDropGame.launchBlocked"),
            status: "warning",
          });
          return;
        }
        clearCows();
      }
      setModalStates((prev) => ({
        ...prev,
        [key]: { isOpen: true, ...params },
      }));
      logger.info("Opened shared modal:", key, params);
    },
    [canLaunchGame, clearCows, toast, t]
  );

  const closeSharedModal = useCallback((key: string) => {
    setModalStates((prev) => {
      const { [key]: _, ...newStates } = prev;
      return newStates;
    });
  }, []);

  const openGenericConfirmDialog = useCallback(
    (params?: any) => {
      // If the user has previously selected "Don't show again", skip the dialog and call the OK callback directly
      if (
        params.suppressKey &&
        config.suppressedDialogs?.includes(params.suppressKey)
      ) {
        params?.onOKCallback?.();
        return;
      }
      openSharedModal("generic-confirm", {
        ...params,
      });
    },
    [config.suppressedDialogs, openSharedModal]
  );

  return (
    <SharedModalContext.Provider
      value={{
        openSharedModal,
        closeSharedModal,
        openGenericConfirmDialog,
        modalStates,
      }}
    >
      {children}
    </SharedModalContext.Provider>
  );
};

export const useSharedModals = (): SharedModalContextType => {
  const context = useContext(SharedModalContext);
  if (!context) {
    throw new Error(
      "useSharedModals must be used within a SharedModalContextProvider"
    );
  }
  return context;
};
