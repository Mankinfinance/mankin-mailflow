/**
 * Brand-themed button — replaces the inline button styles used in the
 * dashboard and styleguide. Variant + size API matches the shadcn/ui
 * shape so a future `pnpm dlx shadcn add ...` add stays drop-in.
 *
 * Colours come from the OKLCH tokens defined in app/globals.css @theme.
 */
import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-md font-semibold whitespace-nowrap transition-colors disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40",
  {
    variants: {
      variant: {
        primary: "bg-brand text-surface hover:bg-brand-deep",
        accent: "bg-accent text-[oklch(22%_0.04_60)] hover:bg-accent-deep hover:text-surface",
        ghost: "border border-hairline bg-transparent text-ink hover:bg-paper-warm",
        danger: "bg-danger text-surface hover:opacity-90",
        link: "text-brand underline-offset-2 hover:underline",
      },
      size: {
        sm: "px-2.5 py-1.5 text-[12px]",
        md: "px-4.5 py-2.5 text-[14px]",
        lg: "px-5 py-3 text-[15px]",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  },
);

interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { buttonVariants };
