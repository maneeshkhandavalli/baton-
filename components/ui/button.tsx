import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

/**
 * Buttons (docs/design/design-system.md → Buttons).
 * One primary action per view. The landing's pills: the primary is an ink pill, `outline` the hairline ghost pill.
 * `success` and `destructive` are for decisive, final actions (approve / delete); their outline siblings carry the
 * same intent at lower emphasis.
 */
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-full border border-transparent bg-clip-padding font-medium whitespace-nowrap transition-[background-color,border-color,color,box-shadow,transform] duration-150 ease-standard outline-none select-none focus-ring active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-busy:cursor-progress aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary font-semibold text-primary-foreground hover:bg-primary-hover",
        secondary: "bg-secondary text-secondary-foreground hover:bg-sunken aria-expanded:bg-sunken",
        outline: "border-border-strong bg-transparent text-foreground hover:border-foreground/40 hover:bg-card aria-expanded:bg-card",
        ghost: "text-foreground hover:bg-muted aria-expanded:bg-muted",
        success: "bg-success font-semibold text-success-foreground hover:bg-success-hover",
        "success-outline": "border-success/40 bg-transparent text-success-fg hover:bg-success-soft",
        destructive: "bg-destructive font-semibold text-destructive-foreground hover:bg-destructive-hover",
        "destructive-outline":
          "border-destructive/40 bg-transparent text-destructive-fg hover:bg-destructive-soft",
        "destructive-ghost": "text-destructive-fg hover:bg-destructive-soft",
        link: "rounded-sm border-0 text-foreground underline decoration-foreground/30 underline-offset-4 hover:decoration-foreground",
      },
      size: {
        xs: "h-7 gap-1 px-2 text-xs max-sm:h-10 max-sm:px-3 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        sm: "h-8 gap-1.5 px-3.5 text-caption max-sm:h-10 has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5 [&_svg:not([class*='size-'])]:size-3.5",
        default: "h-10 gap-1.5 px-4.5 text-sm has-data-[icon=inline-end]:pr-3.5 has-data-[icon=inline-start]:pl-3.5",
        lg: "h-11 gap-2 px-5 text-sm has-data-[icon=inline-end]:pr-4 has-data-[icon=inline-start]:pl-4",
        xl: "h-13 gap-2 px-6 text-md has-data-[icon=inline-end]:pr-4.5 has-data-[icon=inline-start]:pl-4.5",
        "icon-xs": "size-7 max-sm:size-10 [&_svg:not([class*='size-'])]:size-3.5",
        "icon-sm": "size-8 max-sm:size-10",
        icon: "size-10",
        "icon-lg": "size-10",
      },
    },
    compoundVariants: [{ variant: "link", className: "h-auto px-0 has-data-[icon=inline-end]:pr-0 has-data-[icon=inline-start]:pl-0" }],
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
