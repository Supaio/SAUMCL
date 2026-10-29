// Adapted from shadcn/ui (MIT); see LICENSE.shadcn.md.
import { Slot as SlotRoot } from "@radix-ui/react-slot";
import { type VariantProps, cva } from "class-variance-authority";
import * as React from "react";
import { cn } from "@/utils/shadcn";

const badgeVariants = cva(
  "tw:inline-flex tw:w-fit tw:shrink-0 tw:items-center tw:justify-center tw:gap-1 tw:overflow-hidden tw:rounded-full tw:border tw:border-transparent tw:px-2 tw:py-0.5 tw:text-xs tw:font-medium tw:whitespace-nowrap tw:transition-[color,box-shadow] tw:focus-visible:border-ring tw:focus-visible:ring-[3px] tw:focus-visible:ring-ring/50 tw:aria-invalid:border-destructive tw:aria-invalid:ring-destructive/20 tw:dark:aria-invalid:ring-destructive/40 tw:[&>svg]:pointer-events-none tw:[&>svg]:size-3",
  {
    variants: {
      variant: {
        default:
          "tw:bg-primary tw:text-primary-foreground tw:[a&]:hover:bg-primary/90",
        secondary:
          "tw:bg-secondary tw:text-secondary-foreground tw:[a&]:hover:bg-secondary/90",
        destructive:
          "tw:bg-destructive tw:text-white tw:focus-visible:ring-destructive/20 tw:dark:bg-destructive/60 tw:dark:focus-visible:ring-destructive/40 tw:[a&]:hover:bg-destructive/90",
        outline:
          "tw:border-border tw:text-foreground tw:[a&]:hover:bg-accent tw:[a&]:hover:text-accent-foreground",
        ghost: "tw:[a&]:hover:bg-accent tw:[a&]:hover:text-accent-foreground",
        link: "tw:text-primary tw:underline-offset-4 tw:[a&]:hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? SlotRoot : "span";

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
