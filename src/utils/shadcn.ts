import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

const mergeClasses = extendTailwindMerge({ prefix: "tw" });

export const cn = (...inputs: ClassValue[]) => mergeClasses(clsx(inputs));
