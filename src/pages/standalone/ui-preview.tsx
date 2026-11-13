import { useRouter } from "next/router";
import { useEffect } from "react";

const UiPreviewPage = () => {
  const router = useRouter();
  useEffect(() => {
    void router.replace("/launch");
  }, [router]);
  return null;
};

export default UiPreviewPage;
