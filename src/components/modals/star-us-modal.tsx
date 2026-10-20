import {
  Button,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  ModalProps,
  Text,
} from "@chakra-ui/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useTranslation } from "react-i18next";

const StarUsModal: React.FC<Omit<ModalProps, "children">> = ({ ...props }) => {
  const { t } = useTranslation();

  const handleStar = () => {
    openUrl("https://github.com/Supaio/SAUMCL");
    props.onClose();
  };

  return (
    <Modal
      autoFocus={false}
      size={{ base: "sm", lg: "md" }}
      returnFocusOnClose={false}
      {...props}
    >
      <ModalOverlay />
      <ModalContent borderRadius="md" overflow="hidden">
        <ModalHeader>🌟&nbsp;&nbsp;{t("StarUsModal.header.title")}</ModalHeader>
        <ModalCloseButton />
        <ModalBody mt={-1}>
          <Text color="gray.500">{t("StarUsModal.body")}</Text>
        </ModalBody>
        <ModalFooter>
          <Button variant="ghost" onClick={props.onClose}>
            {t("StarUsModal.button.later")}
          </Button>
          <Button colorScheme="orange" onClick={handleStar}>
            {t("StarUsModal.button.starUs")}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};

export default StarUsModal;
