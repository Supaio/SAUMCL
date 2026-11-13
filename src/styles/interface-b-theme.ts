import { extendTheme } from "@chakra-ui/react";
import { mode } from "@chakra-ui/theme-tools";
import chakraExtendTheme from "@/styles/chakra-theme";

const surface = (props: any) => ({
  bg: mode("white", "gray.800")(props),
  color: mode("gray.900", "gray.100")(props),
  borderColor: mode("gray.200", "gray.700")(props),
});

const interfaceBTheme = extendTheme(chakraExtendTheme, {
  colors: {
    gray: {
      50: "#f8fafc",
      100: "#f0f3f8",
      200: "#e4e9f0",
      300: "#cbd5e1",
      400: "#94a3b8",
      500: "#64748b",
      600: "#475569",
      700: "#303b4c",
      800: "#1b2330",
      900: "#141a24",
    },
  },
  semanticTokens: {
    colors: {
      "chakra-body-bg": { _light: "#f5f7fb", _dark: "#141a24" },
      "chakra-body-text": { _light: "#192231", _dark: "#e4ebf7" },
      "chakra-border-color": { _light: "#e4e9f0", _dark: "#303b4c" },
      "chakra-subtle-bg": { _light: "#f0f3f8", _dark: "#242e3e" },
    },
  },
  components: {
    Button: {
      baseStyle: {
        borderRadius: "7px",
        fontWeight: "medium",
        transitionDuration: "120ms",
      },
      variants: {
        solid: (props: any) =>
          props.colorScheme === "gray"
            ? {
                ...surface(props),
                borderWidth: "1px",
                boxShadow: "0 1px 2px rgb(15 23 42 / 4%)",
                _hover: { bg: mode("gray.50", "gray.700")(props) },
                _active: { bg: mode("gray.100", "gray.600")(props) },
                _disabled: {
                  opacity: 0.45,
                  cursor: "not-allowed",
                  boxShadow: "none",
                },
              }
            : {},
        outline: (props: any) => ({
          borderColor: mode("gray.200", "gray.700")(props),
        }),
      },
    },
    Card: {
      baseStyle: (props: any) => ({
        container: {
          ...surface(props),
          borderRadius: "12px",
          borderWidth: "1px",
        },
      }),
      variants: {
        elevated: { container: { boxShadow: "0 1px 3px rgb(15 23 42 / 4%)" } },
        outline: { container: { boxShadow: "0 1px 2px rgb(15 23 42 / 3%)" } },
      },
    },
    Input: {
      variants: {
        outline: (props: any) => ({
          field: {
            ...surface(props),
            borderRadius: "7px",
            _hover: { borderColor: mode("gray.300", "gray.500")(props) },
            _focusVisible: {
              borderColor: "blue.500",
              boxShadow: "0 0 0 1px var(--chakra-colors-blue-500)",
            },
          },
        }),
      },
    },
    Select: {
      variants: {
        outline: (props: any) => ({
          field: { ...surface(props), borderRadius: "7px" },
        }),
      },
    },
    Textarea: {
      variants: {
        outline: (props: any) => ({ ...surface(props), borderRadius: "7px" }),
      },
    },
    NumberInput: {
      variants: {
        outline: (props: any) => ({
          field: { ...surface(props), borderRadius: "7px" },
        }),
      },
    },
    Menu: {
      baseStyle: (props: any) => ({
        list: {
          ...surface(props),
          borderRadius: "10px",
          p: 1.5,
          boxShadow: "0 8px 24px rgb(15 23 42 / 12%)",
        },
        item: { borderRadius: "6px" },
      }),
    },
    Popover: {
      baseStyle: (props: any) => ({
        content: {
          ...surface(props),
          borderRadius: "12px",
          boxShadow: "0 8px 24px rgb(15 23 42 / 12%)",
        },
      }),
    },
    Modal: {
      baseStyle: (props: any) => ({
        dialog: {
          ...surface(props),
          borderWidth: "1px",
          borderRadius: "14px",
          boxShadow: "0 18px 65px rgb(0 0 0 / 22%)",
        },
        header: {
          px: 5,
          pt: 4,
          pb: 3,
          fontWeight: "semibold",
          borderBottomWidth: "1px",
          borderColor: mode("gray.100", "gray.700")(props),
        },
        body: { px: 5, py: 4 },
        footer: { px: 5, pb: 4, pt: 3, gap: 2 },
      }),
    },
    Table: {
      variants: {
        simple: (props: any) => ({
          th: {
            color: mode("gray.500", "gray.400")(props),
            borderColor: mode("gray.200", "gray.700")(props),
            textTransform: "none",
            letterSpacing: "normal",
          },
          td: { borderColor: mode("gray.100", "gray.700")(props) },
        }),
      },
    },
    Tabs: { baseStyle: { tab: { fontWeight: "medium", borderRadius: "6px" } } },
    Tooltip: { baseStyle: { borderRadius: "6px", px: 2.5, py: 1.5 } },
  },
});

export default interfaceBTheme;
