export const indevLauncherVersionLabel = (version: string): string | null => {
  const match = version.match(/^(\d+\.\d+\.\d+)-indev(\.gl)?$/);
  if (!match) return null;
  const number = match[1].replace(/\.0$/, "");
  return `Indev ${match[2] ? "GL " : ""}${number}`;
};

export const isIndevLauncherVersion = (version: string): boolean =>
  indevLauncherVersionLabel(version) !== null;
