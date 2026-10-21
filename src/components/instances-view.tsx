import {
  Box,
  BoxProps,
  HStack,
  Icon,
  Image,
  Input,
  InputGroup,
  InputLeftElement,
  InputRightElement,
  Radio,
  RadioGroup,
  Text,
  useColorModeValue,
} from "@chakra-ui/react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { FaStar } from "react-icons/fa6";
import { GoDotFill } from "react-icons/go";
import { LuSearch, LuX } from "react-icons/lu";
import { CommonIconButton } from "@/components/common/common-icon-button";
import Empty from "@/components/common/empty";
import {
  OptionItemGroup,
  OptionItemProps,
} from "@/components/common/option-item";
import { WrapCardGroup } from "@/components/common/wrap-card";
import InstanceMenu from "@/components/instance-menu";
import { useLauncherConfig } from "@/contexts/config";
import { isChakraColor } from "@/enums/misc";
import { InstanceSummary } from "@/models/instance/misc";
import { generateInstanceDesc, getInstanceIconSrc } from "@/utils/instance";
import { createTextSearch } from "@/utils/search";

interface InstancesViewProps extends BoxProps {
  instances: InstanceSummary[];
  selectedInstance: InstanceSummary | undefined;
  viewType: string;
  onSelectInstance?: (instance: InstanceSummary) => void;
  onSelectCallback?: () => void;
  withMenu?: boolean;
  searchable?: boolean;
}

const InstancesView: React.FC<InstancesViewProps> = ({
  instances,
  selectedInstance,
  viewType,
  onSelectInstance,
  onSelectCallback = () => {},
  withMenu = true,
  searchable = false,
  ...boxProps
}) => {
  const { config, update } = useLauncherConfig();
  const { t } = useTranslation();
  const primaryColor = config.appearance.theme.primaryColor;
  const searchBackground = useColorModeValue("white", "gray.800");
  const [query, setQuery] = useState("");
  const searchInstances = useMemo(
    () =>
      searchable
        ? createTextSearch(instances, (instance) => [
            instance.name,
            instance.description,
            generateInstanceDesc(instance),
            instance.id,
          ])
        : undefined,
    [instances, searchable]
  );
  const visibleInstances = searchInstances?.(query) ?? instances;

  const handleSelectInstance = (instance: InstanceSummary) => {
    if (onSelectInstance) {
      onSelectInstance(instance);
    } else {
      update("states.shared.selectedInstanceId", instance.id);
    }
    onSelectCallback();
  };

  const listItems: OptionItemProps[] = visibleInstances.map((instance) => ({
    title: instance.name,
    description: [generateInstanceDesc(instance), instance.description]
      .filter(Boolean)
      .join(", "),
    titleExtra: (instance.modpackVersion != null ||
      instance.starred ||
      isChakraColor(instance.tag)) && (
      <HStack spacing={1}>
        {instance.modpackVersion != null && (
          <Text fontSize="xs-sm" color="gray.500">
            {instance.modpackVersion.startsWith("v")
              ? instance.modpackVersion
              : `v${instance.modpackVersion}`}
          </Text>
        )}
        {instance.starred && <Icon as={FaStar} color="yellow.500" />}
        {isChakraColor(instance.tag) && (
          <Icon as={GoDotFill} color={`${instance.tag}.500`} />
        )}
      </HStack>
    ),
    maxTitleLines: 1,
    maxDescriptionLines: 2,
    titleLineWrap: false,
    prefixElement: (
      <HStack spacing={2.5}>
        <Radio
          value={instance.id}
          onClick={() => handleSelectInstance(instance)}
          colorScheme={primaryColor}
        />
        <Image
          boxSize="32px"
          src={getInstanceIconSrc(instance.iconSrc, instance.versionPath)}
          alt={instance.name}
          fallbackSrc="/images/icons/JEIcon_Release.png"
        />
      </HStack>
    ),
    ...(!withMenu && {
      isFullClickZone: true,
      onClick: () => handleSelectInstance(instance),
    }),
    children: withMenu ? (
      <InstanceMenu instance={instance} variant="buttonGroup" />
    ) : (
      <></>
    ),
  }));

  const gridItems = visibleInstances.map((instance) => ({
    cardContent: {
      title: (
        <HStack spacing={1} justify="center">
          {isChakraColor(instance.tag) && (
            <Icon as={GoDotFill} color={`${instance.tag}.500`} />
          )}
          <Text
            fontSize="xs-sm"
            className="ellipsis-text"
            fontWeight={
              selectedInstance?.id === instance.id ? "bold" : "normal"
            }
          >
            {instance.name}
          </Text>
        </HStack>
      ),
      description: generateInstanceDesc(instance) || String.fromCharCode(160),
      image: (
        <Image
          boxSize="36px"
          src={getInstanceIconSrc(instance.iconSrc, instance.versionPath)}
          alt={instance.name}
          fallbackSrc="/images/icons/JEIcon_Release.png"
        />
      ),
      extraContent: (
        <HStack spacing={0.5} position="absolute" top={0.5} right={1}>
          {instance.starred && <Icon as={FaStar} color="yellow.500" />}
          {withMenu && <InstanceMenu instance={instance} />}
        </HStack>
      ),
    },
    isSelected: selectedInstance?.id === instance.id,
    radioValue: instance.id,
    onSelect: () => handleSelectInstance(instance),
  }));

  return (
    <Box {...boxProps}>
      {searchable && (
        <Box position="sticky" top={0} zIndex={1} bg={searchBackground} p={2}>
          <InputGroup size="sm">
            <InputLeftElement pointerEvents="none">
              <Icon as={LuSearch} color="gray.500" />
            </InputLeftElement>
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("SelectInstanceModal.searchPlaceholder")}
              aria-label={t("SelectInstanceModal.searchPlaceholder")}
              focusBorderColor={`${primaryColor}.500`}
              pr={8}
            />
            {query && (
              <InputRightElement>
                <CommonIconButton
                  icon={LuX}
                  size="xs"
                  label={t("SelectInstanceModal.clearSearch")}
                  onClick={() => setQuery("")}
                />
              </InputRightElement>
            )}
          </InputGroup>
        </Box>
      )}
      {visibleInstances.length > 0 ? (
        <RadioGroup value={selectedInstance?.id}>
          {viewType === "list" ? (
            <OptionItemGroup items={listItems} />
          ) : (
            <WrapCardGroup items={gridItems} variant="radio" />
          )}
        </RadioGroup>
      ) : (
        <Empty withIcon={false} size="sm" />
      )}
    </Box>
  );
};

export default InstancesView;
