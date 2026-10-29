// Adapted from shadcn/ui (MIT); see LICENSE.shadcn.md.
import { Slot as SlotRoot } from "@radix-ui/react-slot";
import { type VariantProps, cva } from "class-variance-authority";
import * as React from "react";
import { cn } from "@/utils/shadcn";

const buttonVariants = cva(
  "tw:inline-flex tw:shrink-0 tw:items-center tw:justify-center tw:gap-2 tw:rounded-md tw:text-sm tw:font-medium tw:whitespace-nowrap tw:transition-all tw:outline-none tw:focus-visible:border-ring tw:focus-visible:ring-[3px] tw:focus-visible:ring-ring/50 tw:disabled:pointer-events-none tw:disabled:opacity-50 tw:aria-invalid:border-destructive tw:aria-invalid:ring-destructive/20 tw:dark:aria-invalid:ring-destructive/40 tw:[&_svg]:pointer-events-none tw:[&_svg]:shrink-0 tw:[&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "tw:bg-primary tw:text-primary-foreground tw:hover:bg-primary/90",
        destructive:
          "tw:bg-destructive tw:text-white tw:hover:bg-destructive/90 tw:focus-visible:ring-destructive/20 tw:dark:bg-destructive/60 tw:dark:focus-visible:ring-destructive/40",
        outline:
          "tw:border tw:bg-background tw:shadow-xs tw:hover:bg-accent tw:hover:text-accent-foreground tw:dark:border-input tw:dark:bg-input/30 tw:dark:hover:bg-input/50",
        secondary:
          "tw:bg-secondary tw:text-secondary-foreground tw:hover:bg-secondary/80",
        ghost:
          "tw:hover:bg-accent tw:hover:text-accent-foreground tw:dark:hover:bg-accent/50",
        link: "tw:text-primary tw:underline-offset-4 tw:hover:underline",
      },
      size: {
        default: "tw:h-9 tw:px-4 tw:py-2 tw:has-[>svg]:px-3",
        xs: "tw:h-6 tw:gap-1 tw:rounded-md tw:px-2 tw:text-xs tw:has-[>svg]:px-1.5 tw:[&_svg:not([class*='size-'])]:size-3",
        sm: "tw:h-8 tw:gap-1.5 tw:rounded-md tw:px-3 tw:has-[>svg]:px-2.5",
        lg: "tw:h-10 tw:rounded-md tw:px-6 tw:has-[>svg]:px-4",
        icon: "tw:size-9",
        "icon-xs":
          "tw:size-6 tw:rounded-md tw:[&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "tw:size-8",
        "icon-lg": "tw:size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? SlotRoot : "button";

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
