import { Box } from "@chakra-ui/react";
import { useRouter } from "next/router";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Section } from "@/components/common/section";
import ResourceDownloader from "@/components/resource-downloader";
import { OtherResourceType } from "@/enums/resource";

export const ResourcePage = () => {
  const router = useRouter();
  const { t } = useTranslation();
  const resourceType = router.query.type as OtherResourceType;

  useEffect(() => {
    if (resourceType === OtherResourceType.World) {
      router.replace("/discover/resource?type=mod");
    }
  }, [resourceType, router]);

  if (resourceType === OtherResourceType.World) return null;

  return (
    <Section
      title={t(`DiscoverLayout.discoverDomainList.${resourceType}`)}
      w="100%"
      h="100%"
      display="flex"
      flexDir="column"
    >
      <Box
        flex="1"
        bg="chakra-body-bg"
        borderWidth="1px"
        borderRadius="lg"
        boxShadow="sm"
        pt={2}
        px={1}
      >
        <ResourceDownloader
          resourceType={resourceType}
          displayInModal={false}
        />
      </Box>
    </Section>
  );
};

export default ResourcePage;
