import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

/**
 * Buttons (docs/design/design-system.md → Buttons).
 * One primary action per view. `success` and `destructive` are for decisive, final actions
 * (approve / delete); their outline siblings carry the same intent at lower emphasis.
 */
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-md border border-transparent bg-clip-padding font-medium whitespace-nowrap transition-[background-color,border-color,color,box-shadow,transform] duration-150 ease-standard outline-none select-none focus-visible:ring-3 focus-visible:ring-ring/40 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-busy:cursor-progress aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-xs hover:bg-primary-hover",
        secondary: "bg-secondary text-secondary-foreground hover:bg-accent aria-expanded:bg-accent",
        outline: "border-border-strong bg-card text-foreground shadow-xs hover:bg-muted aria-expanded:bg-muted",
        ghost: "text-foreground hover:bg-muted aria-expanded:bg-muted",
        success: "bg-success text-success-foreground shadow-xs hover:bg-success-hover focus-visible:ring-success/30",
        "success-outline": "border-success/35 bg-card text-success-fg shadow-xs hover:bg-success-soft focus-visible:ring-success/25",
        destructive: "bg-destructive text-destructive-foreground shadow-xs hover:bg-destructive-hover focus-visible:ring-destructive/30",
        "destructive-outline":
          "border-destructive/35 bg-card text-destructive-fg shadow-xs hover:bg-destructive-soft focus-visible:ring-destructive/25",
        "destructive-ghost": "text-destructive-fg hover:bg-destructive-soft focus-visible:ring-destructive/25",
        link: "border-0 text-primary-fg underline-offset-4 hover:underline",
      },
      size: {
        xs: "h-7 gap-1 px-2 text-xs has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        sm: "h-8 gap-1.5 px-3 text-caption has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5 [&_svg:not([class*='size-'])]:size-3.5",
        default: "h-9 gap-1.5 px-3.5 text-sm has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        lg: "h-10 gap-2 px-4 text-sm has-data-[icon=inline-end]:pr-3.5 has-data-[icon=inline-start]:pl-3.5",
        xl: "h-12 gap-2 px-5 text-md has-data-[icon=inline-end]:pr-4 has-data-[icon=inline-start]:pl-4",
        "icon-xs": "size-7 [&_svg:not([class*='size-'])]:size-3.5",
        "icon-sm": "size-8",
        icon: "size-9",
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
