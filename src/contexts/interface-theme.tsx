import { GlobalStyle, ThemeProvider } from "@chakra-ui/react";
import { ReactNode, useEffect } from "react";
import { useLauncherConfig } from "@/contexts/config";
import chakraExtendTheme from "@/styles/chakra-theme";
import interfaceBTheme from "@/styles/interface-b-theme";

const InterfaceThemeProvider = ({ children }: { children: ReactNode }) => {
  const { config } = useLauncherConfig();
  const isB = config.appearance.theme.launchInterface === "b";

  useEffect(() => {
    if (isB) document.body.dataset.saumclInterface = "b";
    else delete document.body.dataset.saumclInterface;
    return () => {
      delete document.body.dataset.saumclInterface;
    };
  }, [isB]);

  // Keep the existing color-mode provider so settings and portal dialogs share it.
  return (
    <ThemeProvider theme={isB ? interfaceBTheme : chakraExtendTheme}>
      <GlobalStyle />
      {children}
    </ThemeProvider>
  );
};

export default InterfaceThemeProvider;
