import { BoxProps, HStack, Heading, Highlight, Image } from "@chakra-ui/react";
import styles from "@/styles/logo-title.module.css";

interface LogoTitleProps extends BoxProps {}

export const TitleShort: React.FC<LogoTitleProps> = (props) => {
  return (
    <Heading size="md" className={styles.title} {...props}>
      <Highlight query="L" styles={{ color: "blue.600", userSelect: "none" }}>
        SAUMCL
      </Highlight>
    </Heading>
  );
};

export const TitleFull: React.FC<LogoTitleProps> = (props) => {
  return (
    <Heading size="md" className={styles.title} {...props}>
      <Highlight query="L" styles={{ color: "blue.600", userSelect: "none" }}>
        SAU Minecraft Launcher
      </Highlight>
    </Heading>
  );
};

export const TitleFullWithLogo: React.FC<LogoTitleProps> = (props) => {
  return (
    <HStack>
      <Image src="/images/icons/saumcl.svg" alt="SAUMCL" boxSize="36px" />
      <TitleFull {...props} />
    </HStack>
  );
};
