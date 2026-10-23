import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { COW_LAUNCH_LIMIT } from "@/utils/cow-drop";

interface CowDropContextType {
  cowCount: number;
  cowCapacity: number;
  grayCowCount: number;
  clearRequest: number;
  isGameLaunchBlocked: boolean;
  setCowCount: (count: number) => void;
  setCowCapacity: (capacity: number) => void;
  clearCows: () => void;
  canLaunchGame: () => boolean;
  recordGrayCows: (count: number) => void;
}

const CowDropContext = createContext<CowDropContextType | undefined>(undefined);
const GRAY_COW_COUNT_KEY = "saumcl.grayCowCount";

export const CowDropProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const [cowCount, setCount] = useState(0);
  const [cowCapacity, setCowCapacity] = useState(0);
  const [clearRequest, setClearRequest] = useState(0);
  const [grayCowCount, setGrayCowCount] = useState(0);
  const countRef = useRef(0);
  const grayCountRef = useRef(0);

  useEffect(() => {
    try {
      const stored = Number(window.localStorage.getItem(GRAY_COW_COUNT_KEY));
      if (Number.isSafeInteger(stored) && stored >= 0) {
        grayCountRef.current = stored;
        setGrayCowCount(stored);
      }
    } catch {
      // Keep the current-session count when local storage is unavailable.
    }
  }, []);

  const recordGrayCows = useCallback((count: number) => {
    grayCountRef.current += count;
    setGrayCowCount(grayCountRef.current);
    try {
      window.localStorage.setItem(
        GRAY_COW_COUNT_KEY,
        String(grayCountRef.current)
      );
    } catch {
      // The in-memory record still works when persistence is unavailable.
    }
  }, []);

  const setCowCount = useCallback((count: number) => {
    countRef.current = count;
    setCount(count);
  }, []);
  const clearCows = useCallback(() => {
    setCowCount(0);
    setClearRequest((request) => request + 1);
  }, [setCowCount]);
  const canLaunchGame = useCallback(
    () => countRef.current <= COW_LAUNCH_LIMIT,
    []
  );

  return (
    <CowDropContext.Provider
      value={{
        cowCount,
        cowCapacity,
        grayCowCount,
        clearRequest,
        isGameLaunchBlocked: cowCount > COW_LAUNCH_LIMIT,
        setCowCount,
        setCowCapacity,
        clearCows,
        canLaunchGame,
        recordGrayCows,
      }}
    >
      {children}
    </CowDropContext.Provider>
  );
};

export const useCowDrop = (): CowDropContextType => {
  const context = useContext(CowDropContext);
  if (!context)
    throw new Error("useCowDrop must be used within CowDropProvider");
  return context;
};
