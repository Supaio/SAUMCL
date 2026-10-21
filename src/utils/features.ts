// Intelligence and launcher extensions are disabled in the SAUMCL school build.
export const launcherFeatures = {
  intelligence: false,
  extensions: false,
};

export const isPausedFeatureRoute = (path: string) => {
  const pathname = path.split(/[?#]/)[0];
  const pausedRoutes = [
    ...(!launcherFeatures.intelligence ? ["/settings/intelligence"] : []),
    ...(!launcherFeatures.extensions
      ? ["/settings/extension", "/extension", "/standalone/extension"]
      : []),
  ];
  return pausedRoutes.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`)
  );
};
