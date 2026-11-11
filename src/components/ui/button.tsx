import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "outline";
type Size = "md" | "lg";

const VARIANT: Record<Variant, string> = {
  // Ink: the one main action of a view.
  primary: "bg-accent text-accent-foreground",
  // A white control on the grey page.
  secondary: "border border-border bg-surface hover:border-foreground",
  // Same weight, for use on white panels and dialogs.
  outline: "border border-border hover:border-foreground",
};

const SIZE: Record<Size, string> = {
  md: "h-9 px-3 text-sm",
  lg: "h-11 px-4 text-base",
};

type Props = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size };

/** The app's button. `type` defaults to "button" so it never submits a form by accident. */
export function Button({ variant = "secondary", size = "md", className = "", type = "button", ...rest }: Props) {
  return (
    <button
      type={type}
      className={`${SIZE[size]} ${VARIANT[variant]} rounded-md font-medium inline-flex items-center justify-center gap-2 disabled:opacity-40 ${className}`}
      {...rest}
    />
  );
}
