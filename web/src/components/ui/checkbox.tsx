import { forwardRef, type ButtonHTMLAttributes } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface CheckboxProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onChange"> {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}

export const Checkbox = forwardRef<HTMLButtonElement, CheckboxProps>(
  function Checkbox({ checked, className, disabled, id, onCheckedChange, ...props }, ref) {
    return (
      <button
        aria-checked={checked}
        className={cn(
          "inline-flex h-4 w-4 shrink-0 items-center justify-center border transition-colors cursor-pointer",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-midground/30",
          "disabled:cursor-not-allowed disabled:opacity-50",
          checked
            ? "bg-midground text-background border-midground"
            : "bg-background border-midground/30 text-transparent",
          className,
        )}
        disabled={disabled}
        id={id}
        onClick={() => onCheckedChange(!checked)}
        ref={ref}
        role="checkbox"
        type="button"
        {...props}
      >
        <Check aria-hidden className="h-3 w-3" />
      </button>
    );
  },
);
